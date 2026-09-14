[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$BackupDirectory,

    [switch]$PreflightOnly,
    [switch]$ConfirmEmptyTarget
)

$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $true
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..")).Path
$backupPath = (Resolve-Path -LiteralPath $BackupDirectory).Path
$envPath = Join-Path $projectRoot ".env.lan"
$baseCompose = Join-Path $projectRoot "infrastructure\compose.yaml"
$lanCompose = Join-Path $projectRoot "infrastructure\compose.lan.yaml"
$manifest = Get-Content -LiteralPath (Join-Path $backupPath "manifest.json") -Raw | ConvertFrom-Json
if ($manifest.format -ne 1 -or -not $manifest.sha256) {
    throw "Unsupported or incomplete handoff manifest."
}
$files = @("database.dump", "minio-data.tar.gz", "redis-data.tar.gz", "desktop-updates.tar.gz")
foreach ($file in $files) {
    $expectedHash = $manifest.sha256.$file
    $path = Join-Path $backupPath $file
    if ($expectedHash -notmatch '^[0-9a-fA-F]{64}$' -or
        -not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "Missing checksum or file for $file."
    }
    $actualHash = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
    if ($actualHash -ne $expectedHash) { throw "Backup checksum failed for $file." }
}

& (Join-Path $projectRoot "scripts\validate-environment.ps1") -Environment production `
    -EnvFile $envPath -NetworkMode lan
$values = @{}
foreach ($line in Get-Content -LiteralPath $envPath) {
    if ($line -match '^\s*([A-Z0-9_]+)=(.*)$') { $values[$matches[1]] = $matches[2] }
}
if ($values["POSTGRES_DB"] -ne $manifest.databaseName -or
    $values["POSTGRES_USER"] -ne $manifest.databaseUser -or
    $values["MINIO_BUCKET"] -ne $manifest.bucketName -or
    $values["YUKSALISH_S3_BUCKET"] -ne $manifest.bucketName) {
    throw "Destination database or bucket names differ from the backup."
}

$previousEnvFile = [Environment]::GetEnvironmentVariable("YUKSALISH_ENV_FILE", "Process")
$env:YUKSALISH_ENV_FILE = "../.env.lan"
Push-Location $projectRoot
try {
    & docker compose --env-file $envPath -f $baseCompose -f $lanCompose config --quiet
    if ($LASTEXITCODE -ne 0) { throw "LAN Compose configuration is invalid." }
    $containers = @(& docker compose --env-file $envPath -f $baseCompose -f $lanCompose ps -a -q)
    if ($LASTEXITCODE -ne 0) { throw "Cannot inspect destination containers." }
    if ($containers.Count -gt 0 -and $containers[0]) {
        throw "Destination Yuksalish containers already exist. Restore only to an empty project."
    }
    $volumeNames = @(
        "yuksalish-workspace_postgres-data",
        "yuksalish-workspace_minio-data",
        "yuksalish-workspace_redis-data",
        "yuksalish-workspace_desktop-updates",
        "yuksalish-workspace_lan-caddy-data",
        "yuksalish-workspace_lan-caddy-config"
    )
    $existingVolumes = @(& docker volume ls --format '{{.Name}}')
    if ($LASTEXITCODE -ne 0) { throw "Cannot inspect destination volumes." }
    foreach ($volume in $volumeNames) {
        if ($volume -in $existingVolumes) {
            throw "Destination volume '$volume' already exists. No data was overwritten."
        }
    }
    Write-Host "Preflight passed: all checksums match and the destination project is empty."
    if ($PreflightOnly) { return }
    if (-not $ConfirmEmptyTarget) { throw "Run with -ConfirmEmptyTarget after checking this is Bakhtiyor's empty server." }
    $confirmation = Read-Host "Type RESTORE to create the destination server"
    if ($confirmation -cne "RESTORE") { throw "Restore was cancelled." }

    $archives = [ordered]@{
        "minio-data.tar.gz" = "yuksalish-workspace_minio-data"
        "redis-data.tar.gz" = "yuksalish-workspace_redis-data"
        "desktop-updates.tar.gz" = "yuksalish-workspace_desktop-updates"
    }
    foreach ($archive in $archives.Keys) {
        $volume = $archives[$archive]
        & docker volume create $volume | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "Cannot create destination volume $volume." }
        & docker run --rm `
            --mount "type=volume,src=$volume,dst=/destination" `
            --mount "type=bind,src=$backupPath,dst=/backup,readonly" `
            alpine:3.22 tar -C /destination -xzf "/backup/$archive"
        if ($LASTEXITCODE -ne 0) { throw "Could not restore $archive. Do not retry into a nonempty project." }
    }

    & docker compose --env-file $envPath -f $baseCompose -f $lanCompose `
        up -d --wait postgres redis minio
    if ($LASTEXITCODE -ne 0) { throw "Data services did not become healthy." }
    $containerDump = "/tmp/yuksalish-handoff-$([guid]::NewGuid().ToString('N')).dump"
    try {
        & docker compose --env-file $envPath -f $baseCompose -f $lanCompose `
            cp (Join-Path $backupPath "database.dump") "postgres:$containerDump"
        if ($LASTEXITCODE -ne 0) { throw "Could not copy the database dump." }
        & docker compose --env-file $envPath -f $baseCompose -f $lanCompose `
            exec -T postgres pg_restore --exit-on-error --no-owner --no-acl `
            -U $values["POSTGRES_USER"] -d $values["POSTGRES_DB"] $containerDump
        if ($LASTEXITCODE -ne 0) { throw "Database restore failed. Do not retry into this nonempty project." }
    }
    finally {
        & docker compose --env-file $envPath -f $baseCompose -f $lanCompose `
            exec -T postgres rm -f -- $containerDump
    }
    $restoredUsers = & docker compose --env-file $envPath -f $baseCompose -f $lanCompose `
        exec -T postgres psql -U $values["POSTGRES_USER"] -d $values["POSTGRES_DB"] `
        -Atc "select count(*) from core_users"
    if ($LASTEXITCODE -ne 0 -or [int]$restoredUsers -ne [int]$manifest.userCount) {
        throw "Restored user count does not match the backup."
    }
    & docker compose --env-file $envPath -f $baseCompose -f $lanCompose up -d --build --wait
    if ($LASTEXITCODE -ne 0) { throw "Application services did not become healthy." }
    Write-Host "LAN server restored. Check HTTPS, account login, attachments and updates before cutover."
}
finally {
    Pop-Location
    if ($null -eq $previousEnvFile) { Remove-Item Env:YUKSALISH_ENV_FILE -ErrorAction SilentlyContinue }
    else { $env:YUKSALISH_ENV_FILE = $previousEnvFile }
}
