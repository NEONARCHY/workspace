[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$DestinationFile
)

$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $true
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..")).Path
$envPath = Join-Path $projectRoot ".env.lan"
$target = [System.IO.Path]::GetFullPath($DestinationFile)
if (Test-Path -LiteralPath $target) { throw "Certificate file already exists; refusing to overwrite it." }
$previousEnvFile = [Environment]::GetEnvironmentVariable("YUKSALISH_ENV_FILE", "Process")
$env:YUKSALISH_ENV_FILE = "../.env.lan"
Push-Location $projectRoot
try {
    & docker compose --env-file $envPath -f infrastructure/compose.yaml `
        -f infrastructure/compose.lan.yaml cp `
        lan-https:/data/caddy/pki/authorities/local/root.crt $target
    if ($LASTEXITCODE -ne 0) { throw "Could not export the Caddy root certificate." }
    $hash = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash
    Write-Host "Root certificate: $target"
    Write-Host "SHA-256 fingerprint (verify in person with each employee): $hash"
}
finally {
    Pop-Location
    if ($null -eq $previousEnvFile) { Remove-Item Env:YUKSALISH_ENV_FILE -ErrorAction SilentlyContinue }
    else { $env:YUKSALISH_ENV_FILE = $previousEnvFile }
}
