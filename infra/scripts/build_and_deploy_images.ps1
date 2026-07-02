<#
.SYNOPSIS
    Builds the frontend and backend images remotely in ACR (az acr build - no
    local Docker needed), pushes them to the ACR created by `azd up`, updates the
    frontend App Service to the new image and restarts it, then recreates the
    backend Container Instance on the new image.

.DESCRIPTION
    Run AFTER `azd up`. Configuration is read from the azd environment.
#>

$ErrorActionPreference = 'Stop'

function Invoke-Az {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$AzArgs)
    & az @AzArgs
    if ($LASTEXITCODE -ne 0) { throw "az $($AzArgs -join ' ') failed with exit code $LASTEXITCODE" }
}

# Load azd environment outputs into the process environment.
if (Get-Command azd -ErrorAction SilentlyContinue) {
    foreach ($line in (azd env get-values 2>$null)) {
        if ($line -match '^\s*([A-Za-z0-9_]+)="?(.*?)"?\s*$') {
            Set-Item -Path "Env:$($Matches[1])" -Value $Matches[2]
        }
    }
}

$AcrName        = $env:AZURE_ENV_CONTAINER_REGISTRY_NAME
$ResourceGroup  = $env:RESOURCE_GROUP_NAME
$AppService     = $env:APP_SERVICE_NAME
$ContainerGroup = $env:CONTAINER_INSTANCE_NAME

$FrontendImage = 'content-gen-app'
$BackendImage  = 'content-gen-api'
$Tag           = 'latest'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot  = (Resolve-Path (Join-Path $ScriptDir '..\..')).Path

if (-not $AcrName -or -not $ResourceGroup -or -not $AppService -or -not $ContainerGroup) {
    throw "Missing required azd environment values (AZURE_ENV_CONTAINER_REGISTRY_NAME, RESOURCE_GROUP_NAME, APP_SERVICE_NAME, CONTAINER_INSTANCE_NAME)."
}

$AcrLoginServer = "$AcrName.azurecr.io"

# ===== Build & push frontend image =====
Write-Host "===== Building Frontend Image ($FrontendImage`:$Tag) =====" -ForegroundColor Yellow
Invoke-Az acr build --registry $AcrName --image "$FrontendImage`:$Tag" `
    --file (Join-Path $RepoRoot 'src\App\WebApp.Dockerfile') --platform linux (Join-Path $RepoRoot 'src\App')

# ===== Build & push backend image =====
Write-Host "===== Building Backend Image ($BackendImage`:$Tag) =====" -ForegroundColor Yellow
Invoke-Az acr build --registry $AcrName --image "$BackendImage`:$Tag" `
    --file (Join-Path $RepoRoot 'src\backend\ApiApp.Dockerfile') --platform linux (Join-Path $RepoRoot 'src\backend')

# ===== Update frontend App Service image (managed-identity ACR pull) =====
Write-Host "===== Updating Frontend App Service ($AppService) =====" -ForegroundColor Yellow
$UamiRid  = az webapp identity show -g $ResourceGroup -n $AppService --query "userAssignedIdentities | keys(@) | [0]" -o tsv
$ClientId = az identity show --ids $UamiRid --query clientId -o tsv

Invoke-Az webapp config container set -g $ResourceGroup -n $AppService `
    --container-image-name "$AcrLoginServer/$FrontendImage`:$Tag" `
    --container-registry-url "https://$AcrLoginServer" --output none
    --only-show-errors | Out-Null

$WebappId = az webapp show -g $ResourceGroup -n $AppService --query id -o tsv
# Invoke-Az resource update --ids "$WebappId/config/web" `
#     --set properties.acrUseManagedIdentityCreds=true `
#     --set properties.acrUserManagedIdentityID=$ClientId --output none

Write-Host "Restarting Frontend App Service..." -ForegroundColor Yellow
Invoke-Az webapp restart -g $ResourceGroup -n $AppService --output none

# ===== Recreate backend Container Instance with the new image =====
# ACI cannot update a container group's image in place, and a restart reuses the
# originally deployed (hello-world) image. So we capture the existing container
# group's configuration and recreate it pointing at the new ACR image.
Write-Host "===== Recreating Backend Container Instance ($ContainerGroup) =====" -ForegroundColor Yellow

$Aci = az container show -g $ResourceGroup -n $ContainerGroup -o json | ConvertFrom-Json
if (-not $Aci) { throw "Could not read existing container group '$ContainerGroup'." }

$AciCpu      = $Aci.containers[0].resources.requests.cpu
$AciMemory   = $Aci.containers[0].resources.requests.memoryInGb
$AciPort     = $Aci.containers[0].ports[0].port
$AciOsType   = $Aci.osType
$AciRestart  = $Aci.restartPolicy
$AciDnsLabel = $Aci.ipAddress.dnsNameLabel
$AciSubnetId = if ($Aci.subnetIds) { $Aci.subnetIds[0].id } else { $null }
$AciUami     = @($Aci.identity.userAssignedIdentities.PSObject.Properties.Name)[0]
$AciEnvVars  = $Aci.containers[0].environmentVariables | ForEach-Object { "$($_.name)=$($_.value)" }

$CreateArgs = @(
    'container', 'create',
    '--resource-group', $ResourceGroup,
    '--name', $ContainerGroup,
    '--image', "$AcrLoginServer/$BackendImage`:$Tag",
    '--cpu', $AciCpu,
    '--memory', $AciMemory,
    '--ports', $AciPort,
    '--os-type', $AciOsType,
    '--restart-policy', $AciRestart,
    '--assign-identity', $AciUami,
    '--acr-identity', $AciUami,
    '--registry-login-server', $AcrLoginServer
)
if ($AciSubnetId) {
    $CreateArgs += @('--subnet', $AciSubnetId)
} else {
    $CreateArgs += @('--ip-address', 'Public', '--dns-name-label', $AciDnsLabel)
}
$CreateArgs += '--environment-variables'
$CreateArgs += $AciEnvVars

Invoke-Az @CreateArgs --output none

Write-Host ""
Write-Host "===== Done =====" -ForegroundColor Green
Write-Host "Frontend image: $AcrLoginServer/$FrontendImage`:$Tag" -ForegroundColor Cyan
Write-Host "Backend image:  $AcrLoginServer/$BackendImage`:$Tag" -ForegroundColor Cyan
