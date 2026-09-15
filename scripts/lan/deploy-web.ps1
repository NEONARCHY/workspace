[CmdletBinding()]
param(
    [string]$EnvFile = ".env.lan"
)

$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $true
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..")).Path
$resolvedEnvFile = if ([System.IO.Path]::IsPathRooted($EnvFile)) {
    (Resolve-Path -LiteralPath $EnvFile).Path
} else {
    (Resolve-Path -LiteralPath (Join-Path $projectRoot $EnvFile)).Path
}
$composeBase = Join-Path $projectRoot "infrastructure\compose.yaml"
$composeLan = Join-Path $projectRoot "infrastructure\compose.lan.yaml"
$previousEnvFile = $env:YUKSALISH_ENV_FILE
$previousBuildId = $env:YUKSALISH_WEB_BUILD_ID

Push-Location $projectRoot
try {
    & (Join-Path $projectRoot "scripts\validate-environment.ps1") `
        -Environment production -NetworkMode lan -EnvFile $resolvedEnvFile | Out-Host
    docker info --format '{{.ServerVersion}}' | Out-Null
    $env:YUKSALISH_ENV_FILE = $resolvedEnvFile
    $env:YUKSALISH_WEB_BUILD_ID = (git rev-parse HEAD).Trim()
    $compose = @(
        "compose", "--env-file", $resolvedEnvFile,
        "-f", $composeBase, "-f", $composeLan
    )

    & docker @compose config --quiet
    & docker @compose build web api
    & docker @compose up -d --no-build --wait api web gateway lan-https
    # gateway mounts its Nginx config from the repository. Reload it so a changed
    # route is active even when Compose does not recreate an already-running service.
    & docker @compose exec -T gateway nginx -s reload

    $lanIpLine = Get-Content -LiteralPath $resolvedEnvFile |
        Where-Object { $_ -match '^YUKSALISH_LAN_IP=' } | Select-Object -First 1
    if (-not $lanIpLine) { throw "YUKSALISH_LAN_IP is missing." }
    $lanIp = $lanIpLine.Substring("YUKSALISH_LAN_IP=".Length).Trim()
    $baseUrl = "https://${lanIp}:8443"
    $ready = Invoke-WebRequest -UseBasicParsing "$baseUrl/api/v1/health/ready" -TimeoutSec 30
    if ($ready.StatusCode -ne 200) { throw "API readiness returned $($ready.StatusCode)." }
    $webResponse = Invoke-WebRequest -UseBasicParsing "$baseUrl/" -TimeoutSec 30
    if ($webResponse.StatusCode -ne 200 -or $webResponse.Content -notmatch '<div id="root"></div>') {
        throw "Web home page did not return the Workspace application shell."
    }
    Write-Host "Yuksalish Web is healthy: $baseUrl/"
}
finally {
    Pop-Location
    $env:YUKSALISH_ENV_FILE = $previousEnvFile
    $env:YUKSALISH_WEB_BUILD_ID = $previousBuildId
}
