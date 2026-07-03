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

# ===== Build & push frontend image =====
echo "===== Building Frontend Image (${FRONTEND_IMAGE}:${TAG}) ====="
az acr build --registry "${ACR_NAME}" --image "${FRONTEND_IMAGE}:${TAG}" \
  --file "${REPO_ROOT}/src/App/WebApp.Dockerfile" --platform linux "${REPO_ROOT}/src/App"

# ===== Build & push backend image =====
echo "===== Building Backend Image (${BACKEND_IMAGE}:${TAG}) ====="
az acr build --registry "${ACR_NAME}" --image "${BACKEND_IMAGE}:${TAG}" \
  --file "${REPO_ROOT}/src/backend/ApiApp.Dockerfile" --platform linux "${REPO_ROOT}/src/backend"

# ===== Update frontend App Service image (managed-identity ACR pull) =====
echo "===== Updating Frontend App Service (${APP_SERVICE}) ====="
UAMI_RID="$(az webapp identity show -g "${RESOURCE_GROUP}" -n "${APP_SERVICE}" \
  --query "userAssignedIdentities | keys(@) | [0]" -o tsv)"
CLIENT_ID="$(az identity show --ids "${UAMI_RID}" --query clientId -o tsv)"

az webapp config container set -g "${RESOURCE_GROUP}" -n "${APP_SERVICE}" \
  --container-image-name "${ACR_LOGIN_SERVER}/${FRONTEND_IMAGE}:${TAG}" \
  --container-registry-url "https://${ACR_LOGIN_SERVER}" -o none --only-show-errors

WEBAPP_ID="$(az webapp show -g "${RESOURCE_GROUP}" -n "${APP_SERVICE}" --query id -o tsv)"
az resource update --ids "${WEBAPP_ID}/config/web" \
  --set properties.acrUseManagedIdentityCreds=true \
  --set properties.acrUserManagedIdentityID="${CLIENT_ID}" -o none

echo "Restarting Frontend App Service..."
az webapp restart -g "${RESOURCE_GROUP}" -n "${APP_SERVICE}" -o none

# ===== Recreate backend Container Instance with the new image =====
# ACI cannot update a container group's image in place, and a restart reuses the
# originally deployed (hello-world) image. So we capture the existing container
# group's configuration and recreate it pointing at the new ACR image.
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

echo ""
echo "===== Done ====="
echo "Frontend image: ${ACR_LOGIN_SERVER}/${FRONTEND_IMAGE}:${TAG}"
echo "Backend image:  ${ACR_LOGIN_SERVER}/${BACKEND_IMAGE}:${TAG}"
