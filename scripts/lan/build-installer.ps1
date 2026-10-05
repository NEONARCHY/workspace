[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ServerIp,

    [string]$PublicOrigin = "",

    [string]$DeploymentId = ""
)

$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $true
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..")).Path
$address = $null
if (-not [System.Net.IPAddress]::TryParse($ServerIp, [ref]$address) -or
    $address.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork) {
    throw "ServerIp must be the reserved private IPv4 address of the LAN server."
}
$origin = "https://${ServerIp}:8443"
$dualOrigin = -not [string]::IsNullOrWhiteSpace($PublicOrigin)
if ($dualOrigin) {
    if ($PublicOrigin -ne "https://workspace.opinions.uz") {
        throw "Only the reviewed public Workspace origin is supported."
    }
    $parsedDeploymentId = [Guid]::Empty
    if (-not [Guid]::TryParse($DeploymentId, [ref]$parsedDeploymentId) -or
        $parsedDeploymentId -eq [Guid]::Empty) {
        throw "A stable non-empty DeploymentId is required for a dual-network installer."
    }
    $DeploymentId = $parsedDeploymentId.ToString("D")
}
elseif (-not [string]::IsNullOrWhiteSpace($DeploymentId)) {
    throw "DeploymentId can only be supplied with PublicOrigin."
}
try {
    $response = Invoke-WebRequest -Uri "$origin/api/v1/health/ready" -UseBasicParsing -TimeoutSec 10
    if ($response.StatusCode -ne 200) { throw "LAN API health check failed." }
    if ($dualOrigin) {
        $lanHealth = $response.Content | ConvertFrom-Json
        if ($lanHealth.status -ne "ready" -or $lanHealth.deployment_id -ne $DeploymentId) {
            throw "LAN readiness deployment ID does not match the installer configuration."
        }
    }
}
catch {
    throw "The LAN HTTPS server or its trusted certificate is unavailable: $($_.Exception.Message)"
}
if ($dualOrigin) {
    try {
        $publicResponse = Invoke-WebRequest -Uri "$PublicOrigin/api/v1/health/ready" -UseBasicParsing -TimeoutSec 10
        $publicHealth = $publicResponse.Content | ConvertFrom-Json
        if ($publicResponse.StatusCode -ne 200 -or $publicHealth.status -ne "ready" -or
            $publicHealth.deployment_id -ne $DeploymentId) {
            throw "The public route is not ready or reaches another deployment."
        }
    }
    catch {
        throw "The public HTTPS route must be ready before a dual-network installer is built: $($_.Exception.Message)"
    }
}

$previous = @{}
foreach ($name in @("VITE_API_BASE_URL", "VITE_LAN_API_BASE_URL", "VITE_DEPLOYMENT_ID")) {
    $previous[$name] = [Environment]::GetEnvironmentVariable($name, "Process")
}
Push-Location $projectRoot
try {
    $env:VITE_API_BASE_URL = if ($dualOrigin) { $PublicOrigin } else { $origin }
    if ($dualOrigin) {
        $env:VITE_LAN_API_BASE_URL = $origin
        $env:VITE_DEPLOYMENT_ID = $DeploymentId
    }
    else {
        Remove-Item Env:VITE_LAN_API_BASE_URL -ErrorAction SilentlyContinue
        Remove-Item Env:VITE_DEPLOYMENT_ID -ErrorAction SilentlyContinue
    }
    & pnpm --filter @yuksalish/desktop dist:win
    if ($LASTEXITCODE -ne 0) { throw "Windows installer build failed." }
    $version = (Get-Content apps/desktop/package.json -Raw | ConvertFrom-Json).version
    $installer = Join-Path $projectRoot "apps\desktop\release\Yuksalish-Workspace-Setup-$version.exe"
    if (-not (Test-Path -LiteralPath $installer -PathType Leaf)) {
        throw "Expected installer was not produced: $installer"
    }
    $hash = (Get-FileHash -LiteralPath $installer -Algorithm SHA512).Hash
    Write-Host "Installer: $installer"
    Write-Host "SHA-512: $hash"
    if ($dualOrigin) {
        Write-Host "Built for LAN $origin and public $PublicOrigin, deployment $DeploymentId."
    }
    else { Write-Host "Built for API origin $origin." }
    Write-Host "Install this build manually once on each employee PC."
}
finally {
    Pop-Location
    foreach ($name in $previous.Keys) {
        [Environment]::SetEnvironmentVariable($name, $previous[$name], "Process")
    }
}
