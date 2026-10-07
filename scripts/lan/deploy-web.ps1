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
    $runtimeLine = Get-Content -LiteralPath $resolvedEnvFile |
        Where-Object { $_ -match '^YUKSALISH_ENVIRONMENT=' } | Select-Object -First 1
    if (-not $runtimeLine) { throw "YUKSALISH_ENVIRONMENT is missing." }
    $runtimeEnvironment = $runtimeLine.Substring("YUKSALISH_ENVIRONMENT=".Length).Trim()
    if ($runtimeEnvironment -notin @("test", "production")) {
        throw "LAN deployment supports only test or production environments."
    }
    & (Join-Path $projectRoot "scripts\validate-environment.ps1") `
        -Environment $runtimeEnvironment -NetworkMode lan -EnvFile $resolvedEnvFile | Out-Host
    docker info --format '{{.ServerVersion}}' | Out-Null
    $env:YUKSALISH_ENV_FILE = $resolvedEnvFile
    $env:YUKSALISH_WEB_BUILD_ID = (git rev-parse HEAD).Trim()
    & (Join-Path $PSScriptRoot "prepare-release-note-order.ps1")
    $composeFiles = @($composeBase, $composeLan)
    $baseCompose = @(
        "compose", "--env-file", $resolvedEnvFile,
        "-f", $composeBase, "-f", $composeLan
    )
    $gatewayId = [string](& docker @baseCompose ps -a -q gateway | Select-Object -First 1)
    if ($LASTEXITCODE -ne 0) { throw "Could not inspect the existing gateway container." }
    if ($gatewayId.Trim()) {
        $labelsJson = & docker inspect --format '{{json .Config.Labels}}' $gatewayId.Trim()
        if ($LASTEXITCODE -ne 0) { throw "Could not inspect the gateway Compose configuration." }
        $labels = $labelsJson | ConvertFrom-Json
        $activeEnvFile = [string]$labels.'com.docker.compose.project.environment_file'
        if ($activeEnvFile -ne $resolvedEnvFile) {
            throw "The running gateway uses a different environment file. Stop before changing this stack."
        }
        $activeConfigFiles = [string]$labels.'com.docker.compose.project.config_files'
        if (-not $activeConfigFiles) { throw "The running gateway has no Compose file list." }
        $composeFiles = @($activeConfigFiles -split ',' | ForEach-Object {
            (Resolve-Path -LiteralPath $_).Path
        })
        if ($composeFiles.Count -lt 2 -or $composeFiles[0] -ne $composeBase -or
            $composeFiles[1] -ne $composeLan) {
            throw "The running gateway uses a different base Compose configuration."
        }
    }
    $compose = @("compose", "--env-file", $resolvedEnvFile)
    foreach ($composeFile in $composeFiles) { $compose += @("-f", $composeFile) }

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
