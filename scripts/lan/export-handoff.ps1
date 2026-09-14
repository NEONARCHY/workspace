[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$BackupDirectory,

    [string]$SourceEnvFile = ".env",

    [switch]$PreflightOnly,
    [switch]$ConfirmCutover
)

$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $true
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..")).Path
$composeFile = Join-Path $projectRoot "infrastructure\compose.yaml"
$envPath = (Resolve-Path -LiteralPath (Join-Path $projectRoot $SourceEnvFile)).Path
$backupPath = [System.IO.Path]::GetFullPath($BackupDirectory)
$repositoryPrefix = $projectRoot.TrimEnd('\') + '\'
if ($backupPath.Equals($projectRoot, [StringComparison]::OrdinalIgnoreCase) -or
    $backupPath.StartsWith($repositoryPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Choose a backup directory outside the Git repository."
}

$values = @{}
foreach ($line in Get-Content -LiteralPath $envPath) {
    if ($line -match '^\s*([A-Z0-9_]+)=(.*)$') { $values[$matches[1]] = $matches[2] }
}
foreach ($key in @("POSTGRES_DB", "POSTGRES_USER", "MINIO_BUCKET", "YUKSALISH_S3_BUCKET")) {
    if (-not $values[$key]) { throw "Missing $key in the source environment file." }
}
if ($values["MINIO_BUCKET"] -ne $values["YUKSALISH_S3_BUCKET"]) {
    throw "Source MinIO bucket names do not match."
}

Push-Location $projectRoot
try {
    $services = @(& docker compose --env-file $envPath -f $composeFile ps --services --status running)
    if ($LASTEXITCODE -ne 0) { throw "Cannot inspect the source Compose project." }
    foreach ($service in @("api", "gateway", "postgres", "redis", "minio", "worker", "scheduler")) {
        if ($service -notin $services) { throw "Source service '$service' is not running." }
    }
    $confirmedFactors = & docker compose --env-file $envPath -f $composeFile exec -T postgres `
        psql -U $values["POSTGRES_USER"] -d $values["POSTGRES_DB"] -Atc `
        "select count(*) from auth_totp_factors where confirmed_at is not null"
    if ($LASTEXITCODE -ne 0) { throw "Cannot check two-factor authentication state." }
    if ([int]$confirmedFactors -gt 0) {
        throw "Confirmed TOTP factors exist. Preserve the encryption key or plan an explicit reset before migrating."
    }
    $alembicVersion = & docker compose --env-file $envPath -f $composeFile exec -T postgres `
        psql -U $values["POSTGRES_USER"] -d $values["POSTGRES_DB"] -Atc `
        "select version_num from alembic_version"
    if ($LASTEXITCODE -ne 0 -or -not $alembicVersion) { throw "Cannot read the source migration revision." }
    $userCount = & docker compose --env-file $envPath -f $composeFile exec -T postgres `
        psql -U $values["POSTGRES_USER"] -d $values["POSTGRES_DB"] -Atc `
        "select count(*) from core_users"
    if ($LASTEXITCODE -ne 0) { throw "Cannot count source users." }
    $mandatory = & docker compose --env-file $envPath -f $composeFile exec -T postgres `
        psql -U $values["POSTGRES_USER"] -d $values["POSTGRES_DB"] -Atc `
        "select mandatory from workspace_update_policy where id = 1"
    if ($LASTEXITCODE -ne 0) { throw "Cannot check the current update policy." }
    if ($mandatory -eq "t") { throw "Disable mandatory desktop updates before the server cutover." }
    Write-Host "Source preflight passed: $userCount users, Alembic $alembicVersion, no confirmed TOTP factors."
    if ($PreflightOnly) { return }
    if (-not $ConfirmCutover) { throw "Run with -ConfirmCutover only when everyone has stopped writing data." }
    if (Test-Path -LiteralPath $backupPath) { throw "Backup directory already exists; choose a new path." }
    $parentPath = Split-Path -Parent $backupPath
    if (-not (Test-Path -LiteralPath $parentPath -PathType Container)) {
        throw "The backup parent directory does not exist."
    }
    $confirmation = Read-Host "This stops the current server. Type CUTOVER to continue"
    if ($confirmation -cne "CUTOVER") { throw "Cutover was cancelled." }

    New-Item -ItemType Directory -Path $backupPath -ErrorAction Stop | Out-Null
    & docker compose --env-file $envPath -f $composeFile stop gateway api worker scheduler
    if ($LASTEXITCODE -ne 0) { throw "Failed to stop application writers. The source may be partially stopped." }

    $containerDump = "/tmp/yuksalish-handoff-$([guid]::NewGuid().ToString('N')).dump"
    try {
        & docker compose --env-file $envPath -f $composeFile exec -T postgres `
            pg_dump -U $values["POSTGRES_USER"] -d $values["POSTGRES_DB"] `
            --format=custom --file=$containerDump
        if ($LASTEXITCODE -ne 0) { throw "PostgreSQL dump failed." }
        & docker compose --env-file $envPath -f $composeFile cp "postgres:$containerDump" `
            (Join-Path $backupPath "database.dump")
        if ($LASTEXITCODE -ne 0) { throw "Could not copy the PostgreSQL dump." }
    }
    finally {
        & docker compose --env-file $envPath -f $composeFile exec -T postgres rm -f -- $containerDump
    }
    & docker compose --env-file $envPath -f $composeFile stop postgres redis minio
    if ($LASTEXITCODE -ne 0) { throw "Failed to stop data services. The source may be partially stopped." }

    $archives = [ordered]@{
        "minio-data.tar.gz" = "yuksalish-workspace_minio-data"
        "redis-data.tar.gz" = "yuksalish-workspace_redis-data"
        "desktop-updates.tar.gz" = "yuksalish-workspace_desktop-updates"
    }
    foreach ($archive in $archives.Keys) {
        & docker run --rm `
            --mount "type=volume,src=$($archives[$archive]),dst=/source,readonly" `
            --mount "type=bind,src=$backupPath,dst=/backup" `
            alpine:3.22 tar -C /source -czf "/backup/$archive" .
        if ($LASTEXITCODE -ne 0) { throw "Failed to export $archive." }
    }

    $files = @("database.dump") + @($archives.Keys)
    $checksums = [ordered]@{}
    foreach ($file in $files) {
        $path = Join-Path $backupPath $file
        if (-not (Test-Path -LiteralPath $path -PathType Leaf) -or
            (Get-Item -LiteralPath $path).Length -eq 0) { throw "Missing or empty backup file: $file." }
        $checksums[$file] = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
    }
    $revision = (& git rev-parse HEAD).Trim()
    $manifest = [ordered]@{
        format = 1
        createdUtc = [DateTime]::UtcNow.ToString("o")
        sourceRevision = $revision
        alembicRevision = [string]$alembicVersion
        databaseName = $values["POSTGRES_DB"]
        databaseUser = $values["POSTGRES_USER"]
        bucketName = $values["MINIO_BUCKET"]
        userCount = [int]$userCount
        sha256 = $checksums
    }
    $json = $manifest | ConvertTo-Json -Depth 5
    [System.IO.File]::WriteAllText((Join-Path $backupPath "manifest.json"), $json,
        [System.Text.UTF8Encoding]::new($false))
    Write-Host "Handoff backup created at $backupPath. The source server remains STOPPED."
    Write-Host "The backup contains employee data. Transfer only on an encrypted drive; never put it in Git or chat."
}
finally {
    Pop-Location
}
