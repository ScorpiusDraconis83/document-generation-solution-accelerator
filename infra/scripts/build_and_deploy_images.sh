#!/bin/bash
set -euo pipefail

# ============================================================================
# build_and_deploy_images.sh
# ----------------------------------------------------------------------------
# Builds the frontend and backend images remotely in ACR (az acr build - no
# local Docker needed), pushes them to the ACR created by `azd up`, updates the
# frontend App Service to the new image and restarts it, then recreates the
# backend Container Instance on the new image.
#
# Run AFTER `azd up`. Configuration is read from the azd environment.
#
# In private/WAF deployments the registry has public network access disabled, so
# the remote `az acr build` agent cannot authenticate to push. In that case this
# script temporarily enables public access (default action Allow) for the build,
# then re-locks the registry afterwards (trap on EXIT). Image pulls keep working
# over the private endpoint (App Service VNet image pull, ACI VNet injection).
# ============================================================================

# Load azd environment outputs into the shell. Parse without `eval` so that any
# command substitution embedded in a value cannot execute in this shell.
if command -v azd >/dev/null 2>&1; then
  while IFS='=' read -r _key _val; do
    [ -z "${_key}" ] && continue
    _val="${_val%\"}"
    _val="${_val#\"}"
    export "${_key}=${_val}"
  done < <(azd env get-values 2>/dev/null)
fi

ACR_NAME="${AZURE_ENV_CONTAINER_REGISTRY_NAME:-}"
RESOURCE_GROUP="${RESOURCE_GROUP_NAME:-}"
APP_SERVICE="${APP_SERVICE_NAME:-}"
CONTAINER_GROUP="${CONTAINER_INSTANCE_NAME:-}"

FRONTEND_IMAGE="content-gen-app"
BACKEND_IMAGE="content-gen-api"
TAG="latest"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

if [ -z "${ACR_NAME}" ] || [ -z "${RESOURCE_GROUP}" ] || [ -z "${APP_SERVICE}" ] || [ -z "${CONTAINER_GROUP}" ]; then
  echo "ERROR: Missing required azd environment values (AZURE_ENV_CONTAINER_REGISTRY_NAME, RESOURCE_GROUP_NAME, APP_SERVICE_NAME, CONTAINER_INSTANCE_NAME)." >&2
  exit 1
fi

ACR_LOGIN_SERVER="${ACR_NAME}.azurecr.io"

# In private/WAF mode the registry's public network access is disabled, so the
# remote build agent cannot authenticate to push. Temporarily open the registry
# for the build and re-lock it on exit (trap). Image pulls keep working over the
# private endpoint (App Service VNet image pull, ACI VNet injection).
ACR_PUBLIC_ACCESS="$(az acr show -n "${ACR_NAME}" --query publicNetworkAccess -o tsv)"
ACR_OPENED_FOR_BUILD=false

relock_acr() {
  if [ "${ACR_OPENED_FOR_BUILD}" = true ]; then
    echo "===== Re-locking ACR (disabling public network access) ====="
    az acr update -n "${ACR_NAME}" --public-network-enabled false --default-action Deny -o none --only-show-errors \
      || echo "WARNING: Failed to re-disable ACR public network access. Re-lock it manually: az acr update -n ${ACR_NAME} --public-network-enabled false --default-action Deny" >&2
  fi
}
trap relock_acr EXIT

if [ "${ACR_PUBLIC_ACCESS}" = "Disabled" ]; then
  echo "===== ACR public access is disabled (private/WAF mode) - temporarily enabling it for the build ====="
  az acr update -n "${ACR_NAME}" --public-network-enabled true --default-action Allow -o none --only-show-errors
  ACR_OPENED_FOR_BUILD=true
  echo "Waiting for the network rule change to propagate..."
  sleep 45
fi

# ===== Build & push frontend image =====
echo "===== Building Frontend Image (${FRONTEND_IMAGE}:${TAG}) ====="
az acr build --registry "${ACR_NAME}" --image "${FRONTEND_IMAGE}:${TAG}" \
  --file "${REPO_ROOT}/src/App/WebApp.Dockerfile" --platform linux "${REPO_ROOT}/src/App"

# ===== Build & push backend image =====
echo "===== Building Backend Image (${BACKEND_IMAGE}:${TAG}) ====="
az acr build --registry "${ACR_NAME}" --image "${BACKEND_IMAGE}:${TAG}" \
  --file "${REPO_ROOT}/src/backend/ApiApp.Dockerfile" --platform linux "${REPO_ROOT}/src/backend"

# ===== Recreate backend Container Instance with the new image (done FIRST) =====
# ACI cannot update a container group's image in place, and a restart reuses the
# originally deployed (hello-world) image. So we capture the existing container
# group's configuration and recreate it pointing at the new ACR image. We do this
# before touching the frontend so the new private IP is known up-front and the
# frontend only needs a single restart.
echo "===== Recreating Backend Container Instance (${CONTAINER_GROUP}) ====="

ACI_CPU="$(az container show -g "${RESOURCE_GROUP}" -n "${CONTAINER_GROUP}" --query "containers[0].resources.requests.cpu" -o tsv)"
ACI_MEMORY="$(az container show -g "${RESOURCE_GROUP}" -n "${CONTAINER_GROUP}" --query "containers[0].resources.requests.memoryInGb" -o tsv)"
ACI_PORT="$(az container show -g "${RESOURCE_GROUP}" -n "${CONTAINER_GROUP}" --query "containers[0].ports[0].port" -o tsv)"
ACI_OS_TYPE="$(az container show -g "${RESOURCE_GROUP}" -n "${CONTAINER_GROUP}" --query "osType" -o tsv)"
ACI_RESTART="$(az container show -g "${RESOURCE_GROUP}" -n "${CONTAINER_GROUP}" --query "restartPolicy" -o tsv)"
ACI_DNS_LABEL="$(az container show -g "${RESOURCE_GROUP}" -n "${CONTAINER_GROUP}" --query "ipAddress.dnsNameLabel" -o tsv)"
ACI_SUBNET_ID="$(az container show -g "${RESOURCE_GROUP}" -n "${CONTAINER_GROUP}" --query "subnetIds[0].id" -o tsv 2>/dev/null || true)"
ACI_UAMI="$(az container show -g "${RESOURCE_GROUP}" -n "${CONTAINER_GROUP}" --query "identity.userAssignedIdentities | keys(@) | [0]" -o tsv)"

# Capture env vars as NAME=VALUE (handles values containing '=' such as the
# Application Insights connection string, since az create splits on the first '=').
ENV_VARS=()
while IFS= read -r line; do
  [ -n "${line}" ] && ENV_VARS+=("${line}")
done < <(az container show -g "${RESOURCE_GROUP}" -n "${CONTAINER_GROUP}" \
  --query "containers[0].environmentVariables[].join('=', [name, value])" -o tsv)

CREATE_ARGS=(
  container create
  --resource-group "${RESOURCE_GROUP}"
  --name "${CONTAINER_GROUP}"
  --image "${ACR_LOGIN_SERVER}/${BACKEND_IMAGE}:${TAG}"
  --cpu "${ACI_CPU}"
  --memory "${ACI_MEMORY}"
  --ports "${ACI_PORT}"
  --os-type "${ACI_OS_TYPE}"
  --restart-policy "${ACI_RESTART}"
  --assign-identity "${ACI_UAMI}"
  --acr-identity "${ACI_UAMI}"
  --registry-login-server "${ACR_LOGIN_SERVER}"
)
if [ -n "${ACI_SUBNET_ID}" ]; then
  CREATE_ARGS+=(--subnet "${ACI_SUBNET_ID}")
else
  CREATE_ARGS+=(--ip-address Public --dns-name-label "${ACI_DNS_LABEL}")
fi
CREATE_ARGS+=(--environment-variables "${ENV_VARS[@]}")

az "${CREATE_ARGS[@]}" -o none

# In private/WAF mode the ACI has a private IP and no FQDN. Recreating it above
# assigns a NEW private IP, so the frontend's BACKEND_URL (baked at deploy time)
# is now stale. Read the new IP so we can set BACKEND_URL before the single
# frontend restart below. (Public mode keeps its stable dns-label FQDN.)
NEW_BACKEND_URL=""
if [ -n "${ACI_SUBNET_ID}" ]; then
  NEW_IP="$(az container show -g "${RESOURCE_GROUP}" -n "${CONTAINER_GROUP}" --query "ipAddress.ip" -o tsv)"
  if [ -n "${NEW_IP}" ]; then
    NEW_BACKEND_URL="http://${NEW_IP}:${ACI_PORT}"
  else
    echo "WARNING: Could not determine the new ACI private IP; frontend BACKEND_URL not updated." >&2
  fi
fi

# ===== Update frontend App Service image (managed-identity ACR pull) =====
echo "===== Updating Frontend App Service (${APP_SERVICE}) ====="
UAMI_RID="$(az webapp identity show -g "${RESOURCE_GROUP}" -n "${APP_SERVICE}" \
  --query "userAssignedIdentities | keys(@) | [0]" -o tsv)"
if [ -z "${UAMI_RID}" ]; then
  echo "ERROR: Could not resolve user-assigned identity for web app '${APP_SERVICE}'." >&2
  exit 1
fi
CLIENT_ID="$(az identity show --ids "${UAMI_RID}" --query clientId -o tsv)"
if [ -z "${CLIENT_ID}" ]; then
  echo "ERROR: Could not resolve clientId for identity '${UAMI_RID}'." >&2
  exit 1
fi

az webapp config container set -g "${RESOURCE_GROUP}" -n "${APP_SERVICE}" \
  --container-image-name "${ACR_LOGIN_SERVER}/${FRONTEND_IMAGE}:${TAG}" \
  --container-registry-url "https://${ACR_LOGIN_SERVER}" -o none --only-show-errors

WEBAPP_ID="$(az webapp show -g "${RESOURCE_GROUP}" -n "${APP_SERVICE}" --query id -o tsv)"
if [ -z "${WEBAPP_ID}" ]; then
  echo "ERROR: Could not resolve resource id for web app '${APP_SERVICE}'." >&2
  exit 1
fi

# Point the frontend at the new ACI private IP (private/WAF mode) before restart.
if [ -n "${NEW_BACKEND_URL}" ]; then
  echo "===== Updating frontend BACKEND_URL to ${NEW_BACKEND_URL} ====="
  az webapp config appsettings set -g "${RESOURCE_GROUP}" -n "${APP_SERVICE}" \
    --settings "BACKEND_URL=${NEW_BACKEND_URL}" -o none --only-show-errors
fi

# `webapp config container set` performs a partial write of config/web that only
# sets the image + registry auth; it resets the managed-identity credentials bicep
# configured for ACR pull. The ACR admin user is disabled in BOTH modes, so we must
# always re-apply acrUseManagedIdentityCreds / acrUserManagedIdentityID or the next
# restart fails with ACRTokenRetrievalFailure / ImagePullFailure. In private/WAF mode
# we additionally restore the VNet image-pull properties (vnetImagePullEnabled is a
# SITE-level property; the others live on config/web) via the ARM REST API.
echo "===== Restoring managed-identity ACR-pull config on frontend ====="
if [ "${ACR_PUBLIC_ACCESS}" = "Disabled" ]; then
  az rest --method patch \
    --uri "https://management.azure.com${WEBAPP_ID}/config/web?api-version=2023-12-01" \
    --headers "Content-Type=application/json" \
    --body "{\"properties\":{\"acrUseManagedIdentityCreds\":true,\"acrUserManagedIdentityID\":\"${CLIENT_ID}\",\"vnetRouteAllEnabled\":true}}" \
    -o none --only-show-errors
  az rest --method patch \
    --uri "https://management.azure.com${WEBAPP_ID}?api-version=2023-12-01" \
    --headers "Content-Type=application/json" \
    --body '{"properties":{"vnetImagePullEnabled":true}}' \
    -o none --only-show-errors
else
  # Public (non-WAF): identical to the rc-acr-update-cg branch (proven path).
  az resource update --ids "${WEBAPP_ID}/config/web" \
    --set properties.acrUseManagedIdentityCreds=true \
    --set properties.acrUserManagedIdentityID="${CLIENT_ID}" -o none
fi

# Single frontend restart, now that image, BACKEND_URL and ACR-pull config are set.
echo "Restarting Frontend App Service..."
az webapp restart -g "${RESOURCE_GROUP}" -n "${APP_SERVICE}" -o none

echo ""
echo "===== Done ====="
echo "Frontend image: ${ACR_LOGIN_SERVER}/${FRONTEND_IMAGE}:${TAG}"
echo "Backend image:  ${ACR_LOGIN_SERVER}/${BACKEND_IMAGE}:${TAG}"
