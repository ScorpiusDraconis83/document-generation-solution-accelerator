#!/bin/bash
set -euo pipefail

# ============================================================================
# build_and_deploy_images.sh
#
# Post-deployment script. Builds the frontend/backend images remotely in ACR
# (az acr build, no local Docker), updates the frontend App Service and restarts
# it, then recreates the backend Container Instance (ACI) on the new image.
#
# Usage: bash ./infra/scripts/build_and_deploy_images.sh [ResourceGroupName]
#   No argument -> config from the azd environment.
#   ResourceGroupName -> config from that RG's latest successful deployment.
#
# In WAF mode ACR public access is disabled, so the build agent can't push. The
# script temporarily opens the registry and re-locks it on exit (trap); pulls
# keep working over the private endpoint.
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

FRONTEND_IMAGE="content-gen-app"
BACKEND_IMAGE="content-gen-api"
TAG="latest"
FRONTEND_CONTEXT="${REPO_ROOT}/src/App"
FRONTEND_DOCKERFILE="${REPO_ROOT}/src/App/WebApp.Dockerfile"
BACKEND_CONTEXT="${REPO_ROOT}/src/backend"
BACKEND_DOCKERFILE="${REPO_ROOT}/src/backend/ApiApp.Dockerfile"

RESOURCE_GROUP=""
ACR_NAME=""
APP_SERVICE=""
CONTAINER_GROUP=""
ACR_LOGIN_SERVER=""

ACR_PUBLIC_ACCESS=""
ACR_OPENED_FOR_BUILD=false
NEW_BACKEND_URL=""

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

check_azure_auth() {
  echo "Checking Azure authentication..."
  if az account show >/dev/null 2>&1; then
    echo "Already authenticated with Azure."
  else
    echo "Authenticating with Azure CLI..."
    if ! az login --use-device-code; then
      echo "ERROR: Failed to authenticate with Azure." >&2
      exit 1
    fi
  fi
}

# Config from the azd environment. Parses `azd env get-values` without `eval` so
# any command substitution embedded in a value cannot execute here.
get_values_from_azd_env() {
  echo "Getting values from azd environment..."
  if ! command -v azd >/dev/null 2>&1; then
    echo "ERROR: azd is not installed and no resource group argument was provided." >&2
    return 1
  fi

  while IFS='=' read -r _key _val; do
    [ -z "${_key}" ] && continue
    _val="${_val%\"}"
    _val="${_val#\"}"
    case "${_key}" in
      AZURE_ENV_CONTAINER_REGISTRY_NAME) ACR_NAME="${_val}" ;;
      RESOURCE_GROUP_NAME)               RESOURCE_GROUP="${_val}" ;;
      APP_SERVICE_NAME)                  APP_SERVICE="${_val}" ;;
      CONTAINER_INSTANCE_NAME)           CONTAINER_GROUP="${_val}" ;;
    esac
  done < <(azd env get-values 2>/dev/null)

  if [ -z "${ACR_NAME}" ] || [ -z "${RESOURCE_GROUP}" ] || [ -z "${APP_SERVICE}" ] || [ -z "${CONTAINER_GROUP}" ]; then
    echo "ERROR: One or more required values could not be retrieved from the azd environment" \
         "(AZURE_ENV_CONTAINER_REGISTRY_NAME, RESOURCE_GROUP_NAME, APP_SERVICE_NAME, CONTAINER_INSTANCE_NAME)." >&2
    return 1
  fi
  return 0
}

# Config from the latest successful deployment's outputs in the given RG. ARM
# lower-cases the first token of each output name (APP_SERVICE_NAME ->
# apP_SERVICE_NAME), so extraction is case-insensitive.
get_values_from_az_deployment() {
  echo "Getting values from Azure deployment outputs..."
  RESOURCE_GROUP="$1"

  local deploymentName
  deploymentName="$(az deployment group list -g "${RESOURCE_GROUP}" \
    --query "sort_by([?properties.provisioningState=='Succeeded'], &properties.timestamp)[-1].name" -o tsv 2>/dev/null || true)"
  if [ -z "${deploymentName}" ]; then
    echo "ERROR: Could not find a successful deployment in resource group '${RESOURCE_GROUP}'." >&2
    return 1
  fi
  echo "Using deployment outputs from: ${deploymentName}"

  local outputs
  outputs="$(az deployment group show -g "${RESOURCE_GROUP}" -n "${deploymentName}" --query "properties.outputs" -o json 2>/dev/null || true)"

  extract_output() {
    echo "${outputs}" | grep -i -A 3 "\"$1\"" | grep '"value"' | head -n1 | sed 's/.*"value": *"\([^"]*\)".*/\1/' || true
  }

  ACR_NAME="$(extract_output AZURE_ENV_CONTAINER_REGISTRY_NAME)"
  APP_SERVICE="$(extract_output APP_SERVICE_NAME)"
  CONTAINER_GROUP="$(extract_output CONTAINER_INSTANCE_NAME)"

  if [ -z "${ACR_NAME}" ] || [ -z "${APP_SERVICE}" ] || [ -z "${CONTAINER_GROUP}" ]; then
    echo "ERROR: One or more required values could not be retrieved from deployment outputs." >&2
    return 1
  fi
  return 0
}

# Open ACR public access for the remote build (WAF mode); flags it for re-lock.
enable_acr_public_access() {
  ACR_PUBLIC_ACCESS="$(az acr show -n "${ACR_NAME}" --query publicNetworkAccess -o tsv)"
  if [ "${ACR_PUBLIC_ACCESS}" = "Disabled" ]; then
    echo "===== ACR public access is disabled (private/WAF mode) - temporarily enabling it for the build ====="
    az acr update -n "${ACR_NAME}" --public-network-enabled true --default-action Allow -o none --only-show-errors
    ACR_OPENED_FOR_BUILD=true
    echo "Waiting for the network rule change to propagate..."
    sleep 45
  fi
}

# Re-lock the ACR if this script opened it (runs from the EXIT trap).
relock_acr() {
  if [ "${ACR_OPENED_FOR_BUILD}" = true ]; then
    echo "===== Re-locking ACR (disabling public network access) ====="
    az acr update -n "${ACR_NAME}" --public-network-enabled false --default-action Deny -o none --only-show-errors \
      || echo "WARNING: Failed to re-disable ACR public network access. Re-lock it manually: az acr update -n ${ACR_NAME} --public-network-enabled false --default-action Deny" >&2
  fi
}

# Build and push a single image remotely in ACR. Args: <imageRef> <dockerfile> <context>
build_and_push_image() {
  local imageRef="$1"
  local dockerfile="$2"
  local context="$3"
  echo "===== Building Image (${imageRef}) ====="
  az acr build --registry "${ACR_NAME}" --image "${imageRef}" \
    --file "${dockerfile}" --platform linux "${context}"
}

# Recreate the backend ACI on the new image. ACI can't swap an image in place and
# a restart reuses the original (hello-world) image, so we read the current group's
# config and recreate it. Done before the frontend so its new private IP (WAF mode)
# is known up-front and the frontend only restarts once.
recreate_backend_aci() {
  echo "===== Recreating Backend Container Instance (${CONTAINER_GROUP}) ====="

  local aci_cpu aci_memory aci_port aci_os_type aci_restart aci_dns_label aci_subnet_id aci_uami
  aci_cpu="$(az container show -g "${RESOURCE_GROUP}" -n "${CONTAINER_GROUP}" --query "containers[0].resources.requests.cpu" -o tsv)"
  aci_memory="$(az container show -g "${RESOURCE_GROUP}" -n "${CONTAINER_GROUP}" --query "containers[0].resources.requests.memoryInGb" -o tsv)"
  aci_port="$(az container show -g "${RESOURCE_GROUP}" -n "${CONTAINER_GROUP}" --query "containers[0].ports[0].port" -o tsv)"
  aci_os_type="$(az container show -g "${RESOURCE_GROUP}" -n "${CONTAINER_GROUP}" --query "osType" -o tsv)"
  aci_restart="$(az container show -g "${RESOURCE_GROUP}" -n "${CONTAINER_GROUP}" --query "restartPolicy" -o tsv)"
  aci_dns_label="$(az container show -g "${RESOURCE_GROUP}" -n "${CONTAINER_GROUP}" --query "ipAddress.dnsNameLabel" -o tsv)"
  aci_subnet_id="$(az container show -g "${RESOURCE_GROUP}" -n "${CONTAINER_GROUP}" --query "subnetIds[0].id" -o tsv 2>/dev/null || true)"
  aci_uami="$(az container show -g "${RESOURCE_GROUP}" -n "${CONTAINER_GROUP}" --query "identity.userAssignedIdentities | keys(@) | [0]" -o tsv)"

  # Capture env vars as NAME=VALUE (values may contain '=', e.g. the App Insights
  # connection string; az create splits on the first '=').
  local env_vars=()
  while IFS= read -r line; do
    [ -n "${line}" ] && env_vars+=("${line}")
  done < <(az container show -g "${RESOURCE_GROUP}" -n "${CONTAINER_GROUP}" \
    --query "containers[0].environmentVariables[].join('=', [name, value])" -o tsv)

  local create_args=(
    container create
    --resource-group "${RESOURCE_GROUP}"
    --name "${CONTAINER_GROUP}"
    --image "${ACR_LOGIN_SERVER}/${BACKEND_IMAGE}:${TAG}"
    --cpu "${aci_cpu}"
    --memory "${aci_memory}"
    --ports "${aci_port}"
    --os-type "${aci_os_type}"
    --restart-policy "${aci_restart}"
    --assign-identity "${aci_uami}"
    --acr-identity "${aci_uami}"
    --registry-login-server "${ACR_LOGIN_SERVER}"
  )
  if [ -n "${aci_subnet_id}" ]; then
    create_args+=(--subnet "${aci_subnet_id}")
  else
    create_args+=(--ip-address Public --dns-name-label "${aci_dns_label}")
  fi
  create_args+=(--environment-variables "${env_vars[@]}")

  az "${create_args[@]}" -o none

  # WAF mode: the recreated ACI gets a NEW private IP (no FQDN), so the frontend's
  # baked BACKEND_URL is stale. Capture the new IP to update it before the restart.
  if [ -n "${aci_subnet_id}" ]; then
    local new_ip
    new_ip="$(az container show -g "${RESOURCE_GROUP}" -n "${CONTAINER_GROUP}" --query "ipAddress.ip" -o tsv)"
    if [ -n "${new_ip}" ]; then
      NEW_BACKEND_URL="http://${new_ip}:${aci_port}"
    else
      echo "WARNING: Could not determine the new ACI private IP; frontend BACKEND_URL not updated." >&2
    fi
  fi
}

# Re-apply the managed-identity ACR-pull config on the frontend. `webapp config
# container set` partially rewrites config/web and drops the MI creds; the ACR
# admin user is disabled in both modes, so without re-applying
# acrUseManagedIdentityCreds/acrUserManagedIdentityID the next restart fails with
# ImagePullFailure. WAF mode also restores the VNet image-pull props via REST
# (vnetImagePullEnabled is site-level; the others live on config/web).
# Args: <clientId> <webAppId>
restore_frontend_acr_pull_config() {
  local clientId="$1"
  local webAppId="$2"
  echo "===== Restoring managed-identity ACR-pull config on frontend ====="
  if [ "${ACR_PUBLIC_ACCESS}" = "Disabled" ]; then
    az rest --method patch \
      --uri "https://management.azure.com${webAppId}/config/web?api-version=2023-12-01" \
      --headers "Content-Type=application/json" \
      --body "{\"properties\":{\"acrUseManagedIdentityCreds\":true,\"acrUserManagedIdentityID\":\"${clientId}\",\"vnetRouteAllEnabled\":true}}" \
      -o none --only-show-errors
    az rest --method patch \
      --uri "https://management.azure.com${webAppId}?api-version=2023-12-01" \
      --headers "Content-Type=application/json" \
      --body '{"properties":{"vnetImagePullEnabled":true}}' \
      -o none --only-show-errors
  else
    # Public (non-WAF): proven rc-acr-update-cg path.
    az resource update --ids "${webAppId}/config/web" \
      --set properties.acrUseManagedIdentityCreds=true \
      --set properties.acrUserManagedIdentityID="${clientId}" -o none
  fi
}

# Update the frontend to the new image + ACR-pull config + backend URL, then restart.
update_frontend_app() {
  echo "===== Updating Frontend App Service (${APP_SERVICE}) ====="
  local uami_rid client_id webapp_id
  uami_rid="$(az webapp identity show -g "${RESOURCE_GROUP}" -n "${APP_SERVICE}" \
    --query "userAssignedIdentities | keys(@) | [0]" -o tsv)"
  if [ -z "${uami_rid}" ]; then
    echo "ERROR: Could not resolve user-assigned identity for web app '${APP_SERVICE}'." >&2
    exit 1
  fi
  client_id="$(az identity show --ids "${uami_rid}" --query clientId -o tsv)"
  if [ -z "${client_id}" ]; then
    echo "ERROR: Could not resolve clientId for identity '${uami_rid}'." >&2
    exit 1
  fi

  az webapp config container set -g "${RESOURCE_GROUP}" -n "${APP_SERVICE}" \
    --container-image-name "${ACR_LOGIN_SERVER}/${FRONTEND_IMAGE}:${TAG}" \
    --container-registry-url "https://${ACR_LOGIN_SERVER}" -o none --only-show-errors

  webapp_id="$(az webapp show -g "${RESOURCE_GROUP}" -n "${APP_SERVICE}" --query id -o tsv)"
  if [ -z "${webapp_id}" ]; then
    echo "ERROR: Could not resolve resource id for web app '${APP_SERVICE}'." >&2
    exit 1
  fi

  # Point the frontend at the new ACI private IP (WAF mode) before restart.
  if [ -n "${NEW_BACKEND_URL}" ]; then
    echo "===== Updating frontend BACKEND_URL to ${NEW_BACKEND_URL} ====="
    az webapp config appsettings set -g "${RESOURCE_GROUP}" -n "${APP_SERVICE}" \
      --settings "BACKEND_URL=${NEW_BACKEND_URL}" -o none --only-show-errors
  fi

  restore_frontend_acr_pull_config "${client_id}" "${webapp_id}"

  echo "Restarting Frontend App Service..."
  az webapp restart -g "${RESOURCE_GROUP}" -n "${APP_SERVICE}" -o none
}

print_config() {
  echo ""
  echo "==============================================="
  echo "Values to be used:"
  echo "==============================================="
  echo "Resource Group:   ${RESOURCE_GROUP}"
  echo "ACR Name:         ${ACR_NAME}"
  echo "ACR Login Server: ${ACR_LOGIN_SERVER}"
  echo "App Service:      ${APP_SERVICE}"
  echo "Container Group:  ${CONTAINER_GROUP}"
  echo "Frontend Image:   ${FRONTEND_IMAGE}:${TAG}"
  echo "Backend Image:    ${BACKEND_IMAGE}:${TAG}"
  echo "==============================================="
  echo ""
}

# Always re-lock the ACR (if opened) on exit and preserve the exit code.
cleanup_on_exit() {
  local exit_code=$?
  relock_acr
  echo ""
  if [ ${exit_code} -ne 0 ]; then
    echo "Script failed (exit code ${exit_code})."
  fi
  exit ${exit_code}
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
main() {
  local resourceGroupArg=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      *)
        if [ -z "${resourceGroupArg}" ]; then
          resourceGroupArg="$1"
        fi
        shift
        ;;
    esac
  done

  echo "==============================================="
  echo "Build & Deploy Container Images"
  echo "==============================================="

  check_azure_auth

  # Config: azd environment by default, deployment outputs when a RG is given.
  if [ -z "${resourceGroupArg}" ]; then
    if ! get_values_from_azd_env; then
      echo "" >&2
      echo "Failed to get values from the azd environment." >&2
      echo "Provide a resource group name to resolve values from deployment outputs instead:" >&2
      echo "  Usage: $0 [ResourceGroupName]" >&2
      exit 1
    fi
  else
    if ! get_values_from_az_deployment "${resourceGroupArg}"; then
      echo "Failed to get values from deployment outputs." >&2
      exit 1
    fi
  fi

  ACR_LOGIN_SERVER="${ACR_NAME}.azurecr.io"

  print_config

  trap cleanup_on_exit EXIT
  enable_acr_public_access

  build_and_push_image "${FRONTEND_IMAGE}:${TAG}" "${FRONTEND_DOCKERFILE}" "${FRONTEND_CONTEXT}"
  build_and_push_image "${BACKEND_IMAGE}:${TAG}" "${BACKEND_DOCKERFILE}" "${BACKEND_CONTEXT}"

  # Recreate the backend ACI first (new IP up-front), then update/restart frontend once.
  recreate_backend_aci
  update_frontend_app

  echo ""
  echo "===== Done ====="
  echo "Frontend image: ${ACR_LOGIN_SERVER}/${FRONTEND_IMAGE}:${TAG}"
  echo "Backend image:  ${ACR_LOGIN_SERVER}/${BACKEND_IMAGE}:${TAG}"
}

main "$@"
