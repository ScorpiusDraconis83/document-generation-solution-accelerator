<#
.SYNOPSIS
    Post-deployment script. Builds the frontend/backend images remotely in ACR
    (az acr build, no local Docker), updates the frontend App Service and restarts
    it, then recreates the backend Container Instance (ACI) on the new image.

.DESCRIPTION
    No ResourceGroupName -> config from the azd environment.
    ResourceGroupName -> config from that RG's latest successful deployment.

    In WAF mode ACR public access is disabled, so the build agent can't push. The
    script temporarily opens the registry and re-locks it (finally); pulls keep
    working over the private endpoint.

.PARAMETER ResourceGroupName
    Optional. Resolve config from this RG's latest deployment outputs instead of azd.
#>
param(
    [Parameter(Position = 0)]
    [string]$ResourceGroupName = ''
)

$ErrorActionPreference = 'Stop'

$FrontendImage = 'content-gen-app'
$BackendImage  = 'content-gen-api'
$Tag           = 'latest'

$ScriptDir          = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot           = (Resolve-Path (Join-Path $ScriptDir '..\..')).Path
$FrontendContext    = Join-Path $RepoRoot 'src\App'
$FrontendDockerfile = Join-Path $RepoRoot 'src\App\WebApp.Dockerfile'
$BackendContext     = Join-Path $RepoRoot 'src\backend'
$BackendDockerfile  = Join-Path $RepoRoot 'src\backend\ApiApp.Dockerfile'

$script:ResourceGroup   = ''
$script:AcrName         = ''
$script:AppService      = ''
$script:ContainerGroup  = ''
$script:AcrLoginServer  = ''

$script:AcrPublicAccess   = ''
$script:AcrOpenedForBuild = $false
$script:NewBackendUrl = $null

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# Run az and throw on non-zero exit so failures surface immediately.
function Invoke-Az {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$AzArgs)
    & az @AzArgs
    if ($LASTEXITCODE -ne 0) { throw "az $($AzArgs -join ' ') failed with exit code $LASTEXITCODE" }
}

function Confirm-AzureAuth {
    Write-Host 'Checking Azure authentication...'
    az account show 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) {
        Write-Host 'Already authenticated with Azure.'
    } else {
        Write-Host 'Authenticating with Azure CLI...'
        az login --use-device-code | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Failed to authenticate with Azure.' }
    }
}

# Config from the azd environment (default path).
function Get-ConfigFromAzdEnv {
    Write-Host 'Getting values from azd environment...'
    if (-not (Get-Command azd -ErrorAction SilentlyContinue)) {
        Write-Warning 'azd is not installed and no resource group argument was provided.'
        return $false
    }

    foreach ($line in (azd env get-values 2>$null)) {
        if ($line -match '^\s*([A-Za-z0-9_]+)="?(.*?)"?\s*$') {
            switch ($Matches[1]) {
                'AZURE_ENV_CONTAINER_REGISTRY_NAME' { $script:AcrName = $Matches[2] }
                'RESOURCE_GROUP_NAME'               { $script:ResourceGroup = $Matches[2] }
                'APP_SERVICE_NAME'                  { $script:AppService = $Matches[2] }
                'CONTAINER_INSTANCE_NAME'           { $script:ContainerGroup = $Matches[2] }
            }
        }
    }

    if (-not $script:AcrName -or -not $script:ResourceGroup -or -not $script:AppService -or -not $script:ContainerGroup) {
        Write-Warning ('One or more required values could not be retrieved from the azd environment ' +
            '(AZURE_ENV_CONTAINER_REGISTRY_NAME, RESOURCE_GROUP_NAME, APP_SERVICE_NAME, CONTAINER_INSTANCE_NAME).')
        return $false
    }
    return $true
}

# Config from the latest successful deployment's outputs in the given RG.
# PowerShell property access is case-insensitive, so ARM's lower-cased first token
# (e.g. apP_SERVICE_NAME) still matches.
function Get-ConfigFromDeployment {
    param([string]$Rg)
    Write-Host 'Getting values from Azure deployment outputs...'
    $script:ResourceGroup = $Rg

    $deploymentName = az deployment group list -g $Rg `
        --query "sort_by([?properties.provisioningState=='Succeeded'], &properties.timestamp)[-1].name" -o tsv 2>$null
    if (-not $deploymentName) {
        Write-Warning "Could not find a successful deployment in resource group '$Rg'."
        return $false
    }
    Write-Host "Using deployment outputs from: $deploymentName"

    $outputsJson = az deployment group show -g $Rg -n $deploymentName --query 'properties.outputs' -o json 2>$null
    if (-not $outputsJson) {
        Write-Warning 'Could not read deployment outputs.'
        return $false
    }
    $outputs = $outputsJson | ConvertFrom-Json

    $script:AcrName        = $outputs.AZURE_ENV_CONTAINER_REGISTRY_NAME.value
    $script:AppService     = $outputs.APP_SERVICE_NAME.value
    $script:ContainerGroup = $outputs.CONTAINER_INSTANCE_NAME.value

    if (-not $script:AcrName -or -not $script:AppService -or -not $script:ContainerGroup) {
        Write-Warning 'One or more required values could not be retrieved from deployment outputs.'
        return $false
    }
    return $true
}

# Open ACR public access for the remote build (WAF mode); flags it for re-lock.
function Enable-AcrPublicAccess {
    $script:AcrPublicAccess = Invoke-Az acr show -n $script:AcrName --query publicNetworkAccess --output tsv
    if ($script:AcrPublicAccess -eq 'Disabled') {
        Write-Host '===== ACR public access is disabled (private/WAF mode) - temporarily enabling it for the build =====' -ForegroundColor Yellow
        Invoke-Az acr update -n $script:AcrName --public-network-enabled true --default-action Allow --output none --only-show-errors
        $script:AcrOpenedForBuild = $true
        Write-Host 'Waiting for the network rule change to propagate...' -ForegroundColor Yellow
        Start-Sleep -Seconds 45
    }
}

# Re-lock the ACR if this script opened it (called from finally).
function Restore-AcrPublicAccess {
    if ($script:AcrOpenedForBuild) {
        Write-Host '===== Re-locking ACR (disabling public network access) =====' -ForegroundColor Yellow
        az acr update -n $script:AcrName --public-network-enabled false --default-action Deny --output none --only-show-errors
        if ($LASTEXITCODE -ne 0) {
            Write-Warning "Failed to re-disable ACR public network access. Re-lock it manually: az acr update -n $($script:AcrName) --public-network-enabled false --default-action Deny"
        }
    }
}

# Build and push a single image remotely in ACR.
function Build-AndPushImage {
    param(
        [string]$ImageRef,
        [string]$Dockerfile,
        [string]$Context
    )
    Write-Host "===== Building Image ($ImageRef) =====" -ForegroundColor Yellow
    Invoke-Az acr build --registry $script:AcrName --image $ImageRef `
        --file $Dockerfile --platform linux $Context
}

# Recreate the backend ACI on the new image. ACI can't swap an image in place and a
# restart reuses the original (hello-world) image, so we read the current group's
# config and recreate it. Done before the frontend so its new private IP (WAF mode)
# is known up-front and the frontend only restarts once.
function New-BackendContainerInstance {
    Write-Host "===== Recreating Backend Container Instance ($($script:ContainerGroup)) =====" -ForegroundColor Yellow

    $Aci = az container show -g $script:ResourceGroup -n $script:ContainerGroup -o json | ConvertFrom-Json
    if (-not $Aci) { throw "Could not read existing container group '$($script:ContainerGroup)'." }

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
        '--resource-group', $script:ResourceGroup,
        '--name', $script:ContainerGroup,
        '--image', "$($script:AcrLoginServer)/$BackendImage`:$Tag",
        '--cpu', $AciCpu,
        '--memory', $AciMemory,
        '--ports', $AciPort,
        '--os-type', $AciOsType,
        '--restart-policy', $AciRestart,
        '--assign-identity', $AciUami,
        '--acr-identity', $AciUami,
        '--registry-login-server', $script:AcrLoginServer
    )
    if ($AciSubnetId) {
        $CreateArgs += @('--subnet', $AciSubnetId)
    } else {
        $CreateArgs += @('--ip-address', 'Public', '--dns-name-label', $AciDnsLabel)
    }
    $CreateArgs += '--environment-variables'
    $CreateArgs += $AciEnvVars

    Invoke-Az @CreateArgs --output none

    # WAF mode: the recreated ACI gets a NEW private IP (no FQDN), so the frontend's
    # baked BACKEND_URL is stale. Capture the new IP to update it before the restart.
    if ($AciSubnetId) {
        $NewAci = az container show -g $script:ResourceGroup -n $script:ContainerGroup -o json | ConvertFrom-Json
        $NewIp  = $NewAci.ipAddress.ip
        if ($NewIp) {
            $script:NewBackendUrl = "http://${NewIp}:$AciPort"
        } else {
            Write-Warning 'Could not determine the new ACI private IP; frontend BACKEND_URL not updated.'
        }
    }
}

# Re-apply the managed-identity ACR-pull config on the frontend. `webapp config
# container set` partially rewrites config/web and drops the MI creds; the ACR admin
# user is disabled in both modes, so without re-applying
# acrUseManagedIdentityCreds/acrUserManagedIdentityID the next restart fails with
# ImagePullFailure. WAF mode also restores the VNet image-pull props via REST
# (vnetImagePullEnabled is site-level; the others live on config/web).
function Restore-FrontendAcrPullConfig {
    param(
        [string]$ClientId,
        [string]$WebId
    )
    Write-Host '===== Restoring managed-identity ACR-pull config on frontend =====' -ForegroundColor Yellow
    if ($script:AcrPublicAccess -eq 'Disabled') {
        $WebCfgBody = (@{ properties = @{
            acrUseManagedIdentityCreds = $true
            acrUserManagedIdentityID   = $ClientId
            vnetRouteAllEnabled        = $true
        }} | ConvertTo-Json -Compress)

        $Tmp1 = New-TemporaryFile; Set-Content -Path $Tmp1 -Value $WebCfgBody -Encoding utf8
        Invoke-Az rest --method patch `
            --uri "https://management.azure.com$WebId/config/web?api-version=2023-12-01" `
            --headers "Content-Type=application/json" --body "@$Tmp1" --output none --only-show-errors
        Remove-Item $Tmp1 -Force

        $SiteBody = '{"properties":{"vnetImagePullEnabled":true}}'
        $Tmp2 = New-TemporaryFile; Set-Content -Path $Tmp2 -Value $SiteBody -Encoding utf8
        Invoke-Az rest --method patch `
            --uri "https://management.azure.com$WebId`?api-version=2023-12-01" `
            --headers "Content-Type=application/json" --body "@$Tmp2" --output none --only-show-errors
        Remove-Item $Tmp2 -Force
    } else {
        # Public (non-WAF): proven rc-acr-update-cg path.
        Invoke-Az resource update --ids "$WebId/config/web" `
            --set properties.acrUseManagedIdentityCreds=true `
            --set properties.acrUserManagedIdentityID=$ClientId --output none
    }
}

# Update the frontend to the new image + ACR-pull config + backend URL, then restart.
function Update-FrontendApp {
    Write-Host "===== Updating Frontend App Service ($($script:AppService)) =====" -ForegroundColor Yellow

    $Uami = Invoke-Az webapp identity show -g $script:ResourceGroup -n $script:AppService --query "userAssignedIdentities | keys(@) | [0]" --output tsv
    if (-not $Uami) { throw "Could not resolve user-assigned identity for web app '$($script:AppService)'." }
    $ClientId = Invoke-Az identity show --ids $Uami --query clientId --output tsv
    if (-not $ClientId) { throw "Could not resolve clientId for identity '$Uami'." }

    Invoke-Az webapp config container set -g $script:ResourceGroup -n $script:AppService `
        --container-image-name "$($script:AcrLoginServer)/$FrontendImage`:$Tag" `
        --container-registry-url "https://$($script:AcrLoginServer)" `
        --output none --only-show-errors

    $WebId = Invoke-Az webapp show -g $script:ResourceGroup -n $script:AppService --query id --output tsv
    if (-not $WebId) { throw "Could not resolve resource id for web app '$($script:AppService)'." }

    # Point the frontend at the new ACI private IP (WAF mode) before restart.
    if ($script:NewBackendUrl) {
        Write-Host "===== Updating frontend BACKEND_URL to $($script:NewBackendUrl) =====" -ForegroundColor Yellow
        Invoke-Az webapp config appsettings set -g $script:ResourceGroup -n $script:AppService `
            --settings "BACKEND_URL=$($script:NewBackendUrl)" --output none --only-show-errors
    }

    Restore-FrontendAcrPullConfig -ClientId $ClientId -WebId $WebId

    Write-Host 'Restarting Frontend App Service...' -ForegroundColor Yellow
    Invoke-Az webapp restart -g $script:ResourceGroup -n $script:AppService --output none
}

function Write-Config {
    Write-Host ''
    Write-Host '==============================================='
    Write-Host 'Values to be used:'
    Write-Host '==============================================='
    Write-Host "Resource Group:   $($script:ResourceGroup)"
    Write-Host "ACR Name:         $($script:AcrName)"
    Write-Host "ACR Login Server: $($script:AcrLoginServer)"
    Write-Host "App Service:      $($script:AppService)"
    Write-Host "Container Group:  $($script:ContainerGroup)"
    Write-Host "Frontend Image:   $FrontendImage`:$Tag"
    Write-Host "Backend Image:    $BackendImage`:$Tag"
    Write-Host '==============================================='
    Write-Host ''
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
Write-Host '==============================================='
Write-Host 'Build & Deploy Container Images'
Write-Host '==============================================='

Confirm-AzureAuth

# Config: azd environment by default, deployment outputs when a RG is given.
if (-not $ResourceGroupName) {
    if (-not (Get-ConfigFromAzdEnv)) {
        Write-Host ''
        Write-Host 'Failed to get values from the azd environment.'
        Write-Host 'Provide a resource group name to resolve values from deployment outputs instead:'
        Write-Host "  Usage: $($MyInvocation.MyCommand.Name) [ResourceGroupName]"
        exit 1
    }
} else {
    if (-not (Get-ConfigFromDeployment -Rg $ResourceGroupName)) {
        Write-Host 'Failed to get values from deployment outputs.'
        exit 1
    }
}

$script:AcrLoginServer = "$($script:AcrName).azurecr.io"

Write-Config

try {
    Enable-AcrPublicAccess

    Build-AndPushImage -ImageRef "$FrontendImage`:$Tag" -Dockerfile $FrontendDockerfile -Context $FrontendContext
    Build-AndPushImage -ImageRef "$BackendImage`:$Tag" -Dockerfile $BackendDockerfile -Context $BackendContext

    # Recreate the backend ACI first (new IP up-front), then update/restart frontend once.
    New-BackendContainerInstance
    Update-FrontendApp
}
finally {
    Restore-AcrPublicAccess
}

Write-Host ''
Write-Host '===== Done =====' -ForegroundColor Green
Write-Host "Frontend image: $($script:AcrLoginServer)/$FrontendImage`:$Tag" -ForegroundColor Cyan
Write-Host "Backend image:  $($script:AcrLoginServer)/$BackendImage`:$Tag" -ForegroundColor Cyan
