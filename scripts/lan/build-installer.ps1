[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ServerIp
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
try {
    $response = Invoke-WebRequest -Uri "$origin/api/v1/health/ready" -UseBasicParsing -TimeoutSec 10
    if ($response.StatusCode -ne 200) { throw "LAN API health check failed." }
}
catch {
    throw "The LAN HTTPS server or its trusted certificate is unavailable: $($_.Exception.Message)"
}

$previous = [Environment]::GetEnvironmentVariable("VITE_API_BASE_URL", "Process")
Push-Location $projectRoot
try {
    $env:VITE_API_BASE_URL = $origin
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
    Write-Host "Built for API origin $origin. Install this build manually once on each employee PC."
}
finally {
    Pop-Location
    if ($null -eq $previous) { Remove-Item Env:VITE_API_BASE_URL -ErrorAction SilentlyContinue }
    else { $env:VITE_API_BASE_URL = $previous }
}
