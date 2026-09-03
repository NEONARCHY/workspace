$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $true

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$ComposeFile = Join-Path $ProjectRoot "infrastructure\compose.yaml"
$EnvFile = Join-Path $ProjectRoot ".env"
$Python = Join-Path $ProjectRoot ".venv\Scripts\python.exe"
$TestDatabase = "yuksalish_test"

if (-not (Test-Path -LiteralPath $EnvFile)) {
    throw "Create .env from .env.example before running the full quality gate."
}

function Read-EnvValue([string]$Name) {
    $Line = Get-Content -LiteralPath $EnvFile | Where-Object { $_ -match "^$Name=" } | Select-Object -First 1
    if (-not $Line) {
        throw "Missing $Name in .env."
    }
    return $Line.Substring($Name.Length + 1)
}

$PostgresUser = Read-EnvValue "POSTGRES_USER"
$PostgresPort = Read-EnvValue "POSTGRES_PORT"
$ContainerDatabaseUrl = Read-EnvValue "YUKSALISH_DATABASE_URL"

docker info --format '{{.ServerVersion}}' | Out-Null
docker compose --env-file $EnvFile -f $ComposeFile up -d --wait postgres | Out-Null

docker compose --env-file $EnvFile -f $ComposeFile exec -T postgres `
    dropdb -U $PostgresUser --if-exists --force $TestDatabase
docker compose --env-file $EnvFile -f $ComposeFile exec -T postgres `
    createdb -U $PostgresUser $TestDatabase

$TestDatabaseUrl = $ContainerDatabaseUrl `
    -replace '@postgres:5432/[^?]+', "@127.0.0.1:$PostgresPort/$TestDatabase"
$PreviousDatabaseUrl = $env:YUKSALISH_DATABASE_URL
$env:YUKSALISH_DATABASE_URL = $TestDatabaseUrl
try {
    & $Python -m alembic -c apps/api/alembic.ini upgrade head
}
finally {
    $env:YUKSALISH_DATABASE_URL = $PreviousDatabaseUrl
}
$env:YUKSALISH_TEST_DATABASE_URL = $TestDatabaseUrl

Write-Host "PostgreSQL test database is ready on loopback port $PostgresPort."
