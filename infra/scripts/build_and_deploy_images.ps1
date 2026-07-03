<#
.SYNOPSIS
    Builds the frontend and backend images remotely in ACR (az acr build - no
    local Docker needed), pushes them to the ACR created by `azd up`, updates the
    frontend App Service to the new image and restarts it, then recreates the
    backend Container Instance on the new image.

.DESCRIPTION
    Run AFTER `azd up`. Configuration is read from the azd environment.

    In private/WAF deployments the registry has public network access disabled, so
    the remote `az acr build` agent cannot authenticate to push. In that case this
    script temporarily enables public access (default action Allow) for the build,
    then re-locks the registry afterwards. Image pulls keep working over the private
    endpoint (App Service VNet image pull, ACI VNet injection).
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

# In private/WAF mode the registry's public network access is disabled. Temporarily
# open it so the remote build agent can push, and re-lock it in the finally block.
$AcrPublicAccess   = Invoke-Az acr show -n $AcrName --query publicNetworkAccess --output tsv
$AcrOpenedForBuild = $false

try {
    if ($AcrPublicAccess -eq 'Disabled') {
        Write-Host "===== ACR public access is disabled (private/WAF mode) - temporarily enabling it for the build =====" -ForegroundColor Yellow
        Invoke-Az acr update -n $AcrName --public-network-enabled true --default-action Allow --output none --only-show-errors
        $AcrOpenedForBuild = $true
        Write-Host "Waiting for the network rule change to propagate..." -ForegroundColor Yellow
        Start-Sleep -Seconds 45
    }

    # ===== Build & push frontend image =====
    Write-Host "===== Building Frontend Image ($FrontendImage`:$Tag) =====" -ForegroundColor Yellow
    Invoke-Az acr build --registry $AcrName --image "$FrontendImage`:$Tag" `
        --file (Join-Path $RepoRoot 'src\App\WebApp.Dockerfile') --platform linux (Join-Path $RepoRoot 'src\App')

    # ===== Build & push backend image =====
    Write-Host "===== Building Backend Image ($BackendImage`:$Tag) =====" -ForegroundColor Yellow
    Invoke-Az acr build --registry $AcrName --image "$BackendImage`:$Tag" `
        --file (Join-Path $RepoRoot 'src\backend\ApiApp.Dockerfile') --platform linux (Join-Path $RepoRoot 'src\backend')

    # ===== Recreate backend Container Instance with the new image (done FIRST) =====
    # ACI cannot update a container group's image in place, and a restart reuses the
    # originally deployed (hello-world) image. So we capture the existing container
    # group's configuration and recreate it pointing at the new ACR image. We do this
    # before touching the frontend so the new private IP is known up-front and the
    # frontend only needs a single restart.
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

    # In private/WAF mode the ACI has a private IP and no FQDN. Recreating it above
    # assigns a NEW private IP, so the frontend's BACKEND_URL (baked at deploy time)
    # is now stale. Read the new IP so we can set BACKEND_URL before the single
    # frontend restart below. (Public mode keeps its stable dns-label FQDN.)
    $NewBackendUrl = $null
    if ($AciSubnetId) {
        $NewAci = az container show -g $ResourceGroup -n $ContainerGroup -o json | ConvertFrom-Json
        $NewIp  = $NewAci.ipAddress.ip
        if ($NewIp) {
            $NewBackendUrl = "http://${NewIp}:$AciPort"
        } else {
            Write-Warning "Could not determine the new ACI private IP; frontend BACKEND_URL not updated."
        }
    }

    # ===== Update frontend App Service image (managed-identity ACR pull) =====
    Write-Host "===== Updating Frontend App Service ($AppService) =====" -ForegroundColor Yellow
    Invoke-Az webapp config container set -g $ResourceGroup -n $AppService `
        --container-image-name "$AcrLoginServer/$FrontendImage`:$Tag" `
        --container-registry-url "https://$AcrLoginServer" `
        --output none --only-show-errors

    # Point the frontend at the new ACI private IP (private/WAF mode) before restart.
    if ($NewBackendUrl) {
        Write-Host "===== Updating frontend BACKEND_URL to $NewBackendUrl =====" -ForegroundColor Yellow
        Invoke-Az webapp config appsettings set -g $ResourceGroup -n $AppService `
            --settings "BACKEND_URL=$NewBackendUrl" --output none --only-show-errors
    }

    # `webapp config container set` performs a partial write of config/web that only
    # sets the image + registry auth; it resets the managed-identity credentials bicep
    # configured for ACR pull. The ACR admin user is disabled in BOTH modes, so we must
    # always re-apply acrUseManagedIdentityCreds / acrUserManagedIdentityID or the next
    # restart fails with ACRTokenRetrievalFailure / ImagePullFailure.
    Write-Host "===== Restoring managed-identity ACR-pull config on frontend =====" -ForegroundColor Yellow
    $Uami     = Invoke-Az webapp identity show -g $ResourceGroup -n $AppService --query "userAssignedIdentities | keys(@) | [0]" --output tsv
    if (-not $Uami) { throw "Could not resolve user-assigned identity for web app '$AppService'." }
    $ClientId = Invoke-Az identity show --ids $Uami --query clientId --output tsv
    if (-not $ClientId) { throw "Could not resolve clientId for identity '$Uami'." }
    $WebId    = Invoke-Az webapp show -g $ResourceGroup -n $AppService --query id --output tsv
    if (-not $WebId) { throw "Could not resolve resource id for web app '$AppService'." }

    if ($AcrPublicAccess -eq 'Disabled') {
        # Private/WAF: additionally restore the VNet image-pull properties. The
        # vnetImagePullEnabled flag is a SITE-level property; the others live on
        # config/web. `az resource update` does not persist these reliably, so PATCH
        # via the ARM REST API.
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
        # Public (non-WAF): identical to the rc-acr-update-cg branch (proven path).
        Invoke-Az resource update --ids "$WebId/config/web" `
            --set properties.acrUseManagedIdentityCreds=true `
            --set properties.acrUserManagedIdentityID=$ClientId --output none
    }

    # Single frontend restart, now that image, BACKEND_URL and ACR-pull config are set.
    Write-Host "Restarting Frontend App Service..." -ForegroundColor Yellow
    Invoke-Az webapp restart -g $ResourceGroup -n $AppService --output none
}
finally {
    if ($AcrOpenedForBuild) {
        Write-Host "===== Re-locking ACR (disabling public network access) =====" -ForegroundColor Yellow
        az acr update -n $AcrName --public-network-enabled false --default-action Deny --output none --only-show-errors
        if ($LASTEXITCODE -ne 0) {
            Write-Warning "Failed to re-disable ACR public network access. Re-lock it manually: az acr update -n $AcrName --public-network-enabled false --default-action Deny"
        }
    }
}

Write-Host ""
Write-Host "===== Done =====" -ForegroundColor Green
Write-Host "Frontend image: $AcrLoginServer/$FrontendImage`:$Tag" -ForegroundColor Cyan
Write-Host "Backend image:  $AcrLoginServer/$BackendImage`:$Tag" -ForegroundColor Cyan
