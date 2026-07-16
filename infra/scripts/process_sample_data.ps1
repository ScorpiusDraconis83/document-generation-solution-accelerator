<#
.SYNOPSIS
    Installs the post-deploy Python dependency and runs scripts/post_deploy.py to
    load the sample data into the deployed application.

.DESCRIPTION
    Run AFTER build_and_deploy_images.ps1 has completed (the application images
    must be built, pushed and running first). Configuration is read from the azd
    environment.
#>

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot  = (Resolve-Path (Join-Path $ScriptDir '..\..')).Path

# Load azd environment outputs into the process environment.
if (Get-Command azd -ErrorAction SilentlyContinue) {
    foreach ($line in (azd env get-values 2>$null)) {
        if ($line -match '^\s*([A-Za-z0-9_]+)="?(.*?)"?\s*$') {
            Set-Item -Path "Env:$($Matches[1])" -Value $Matches[2]
        }
    }
}

# Resolve the Python executable (python on Windows, python3 on some systems).
$python = (Get-Command python -ErrorAction SilentlyContinue) ?? (Get-Command python3 -ErrorAction SilentlyContinue)
if (-not $python) { throw "Python is not installed or not on PATH." }
$python = $python.Source

Write-Host "===== Installing post-deploy dependencies =====" -ForegroundColor Yellow
& $python -m pip install -r (Join-Path $RepoRoot 'scripts\requirements-post-deploy.txt') --quiet | Out-Null
if ($LASTEXITCODE -ne 0) { throw "pip install failed with exit code $LASTEXITCODE" }

Write-Host "===== Loading sample data =====" -ForegroundColor Yellow
& $python (Join-Path $RepoRoot 'scripts\post_deploy.py') --skip-tests
if ($LASTEXITCODE -ne 0) { throw "post_deploy.py failed with exit code $LASTEXITCODE" }

Write-Host ""
Write-Host "===== Done =====" -ForegroundColor Green
