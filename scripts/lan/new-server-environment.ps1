[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ServerIp,

    [Parameter(Mandatory = $true)]
    [string]$BackupDirectory
)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..")).Path
$target = Join-Path $projectRoot ".env.lan"
if (Test-Path -LiteralPath $target) { throw ".env.lan already exists; refusing to overwrite secrets." }
$address = $null
if (-not [System.Net.IPAddress]::TryParse($ServerIp, [ref]$address) -or
    $address.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork) {
    throw "ServerIp must be a private IPv4 address."
}
$octets = $address.GetAddressBytes()
$private = $octets[0] -eq 10 -or
    ($octets[0] -eq 172 -and $octets[1] -ge 16 -and $octets[1] -le 31) -or
    ($octets[0] -eq 192 -and $octets[1] -eq 168)
if (-not $private) { throw "ServerIp must be an RFC 1918 private IPv4 address." }

$manifestPath = Join-Path $BackupDirectory "manifest.json"
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if ($manifest.format -ne 1 -or $manifest.bucketName -notmatch '^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$' -or
    $manifest.databaseName -notmatch '^[a-zA-Z_][a-zA-Z0-9_]*$' -or
    $manifest.databaseUser -notmatch '^[a-zA-Z_][a-zA-Z0-9_]*$') {
    throw "Backup manifest is not a supported Yuksalish handoff."
}

function New-Secret {
    $bytes = New-Object byte[] 32
    $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $generator.GetBytes($bytes) }
    finally { $generator.Dispose() }
    return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

$postgresPassword = New-Secret
$minioPassword = New-Secret
$signingKey = New-Secret
$encryptionKey = New-Secret
$databaseName = $manifest.databaseName
$databaseUser = $manifest.databaseUser
$bucket = $manifest.bucketName
$lines = @(
    "YUKSALISH_LAN_IP=$ServerIp",
    "POSTGRES_DB=$databaseName",
    "POSTGRES_USER=$databaseUser",
    "POSTGRES_PASSWORD=$postgresPassword",
    "MINIO_ROOT_USER=yuksalish_lan",
    "MINIO_ROOT_PASSWORD=$minioPassword",
    "MINIO_BUCKET=$bucket",
    "YUKSALISH_ENVIRONMENT=production",
    "YUKSALISH_DATABASE_URL=postgresql+asyncpg://${databaseUser}:${postgresPassword}@postgres:5432/$databaseName",
    "YUKSALISH_AUTH_SIGNING_KEY=$signingKey",
    "YUKSALISH_AUTH_ENCRYPTION_KEY=$encryptionKey",
    "YUKSALISH_PASSWORD_RESET_TTL_HOURS=2",
    "YUKSALISH_SEED_DEMO_DATA=false",
    "YUKSALISH_REDIS_URL=redis://redis:6379/0",
    "YUKSALISH_S3_ENDPOINT=minio:9000",
    "YUKSALISH_S3_ACCESS_KEY=yuksalish_lan",
    "YUKSALISH_S3_SECRET_KEY=$minioPassword",
    "YUKSALISH_S3_SECURE=false",
    "YUKSALISH_S3_BUCKET=$bucket",
    'YUKSALISH_CORS_ORIGINS=["null"]'
)
[System.IO.File]::WriteAllLines($target, $lines, [System.Text.UTF8Encoding]::new($false))
& (Join-Path $projectRoot "scripts\validate-environment.ps1") -Environment production `
    -EnvFile $target -NetworkMode lan
Write-Host "Created .env.lan with fresh secrets. Do not send it via Git or chat."
