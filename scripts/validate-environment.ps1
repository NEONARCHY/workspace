[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("development", "staging", "production")]
    [string]$Environment,

    [Parameter(Mandatory = $true)]
    [string]$EnvFile,

    [switch]$AllowPlaceholders
)

$ErrorActionPreference = "Stop"

$resolvedFile = (Resolve-Path -LiteralPath $EnvFile).Path
$values = @{}
$lineNumber = 0

foreach ($line in Get-Content -LiteralPath $resolvedFile) {
    $lineNumber += 1
    $trimmed = $line.Trim()
    if ($trimmed.Length -eq 0 -or $trimmed.StartsWith("#")) {
        continue
    }

    $separator = $line.IndexOf("=")
    if ($separator -lt 1) {
        throw "Invalid environment entry at ${resolvedFile}:${lineNumber}."
    }

    $key = $line.Substring(0, $separator).Trim()
    $value = $line.Substring($separator + 1).Trim()
    if ($values.ContainsKey($key)) {
        throw "Duplicate environment key '$key' in $resolvedFile."
    }
    $values[$key] = $value
}

$requiredKeys = @(
    "POSTGRES_DB",
    "POSTGRES_USER",
    "POSTGRES_PASSWORD",
    "MINIO_ROOT_USER",
    "MINIO_ROOT_PASSWORD",
    "MINIO_BUCKET",
    "YUKSALISH_ENVIRONMENT",
    "YUKSALISH_DATABASE_URL",
    "YUKSALISH_AUTH_SIGNING_KEY",
    "YUKSALISH_AUTH_ENCRYPTION_KEY",
    "YUKSALISH_REDIS_URL",
    "YUKSALISH_S3_ENDPOINT",
    "YUKSALISH_S3_ACCESS_KEY",
    "YUKSALISH_S3_SECRET_KEY",
    "YUKSALISH_S3_BUCKET",
    "YUKSALISH_CORS_ORIGINS",
    "CLOUDFLARED_IMAGE",
    "CLOUDFLARE_TUNNEL_TOKEN"
)

$missingKeys = @($requiredKeys | Where-Object {
    -not $values.ContainsKey($_)
})
if ($missingKeys.Count -gt 0) {
    throw "Missing required keys in ${resolvedFile}: $($missingKeys -join ', ')."
}

if ($values["YUKSALISH_ENVIRONMENT"] -ne $Environment) {
    throw "YUKSALISH_ENVIRONMENT must equal '$Environment' in $resolvedFile."
}

if ($Environment -in @("staging", "production")) {
    $localOnlyKeys = @(
        "YUKSALISH_DATABASE_URL",
        "YUKSALISH_REDIS_URL",
        "YUKSALISH_S3_ENDPOINT",
        "YUKSALISH_CORS_ORIGINS"
    )
    foreach ($key in $localOnlyKeys) {
        if ($values[$key] -match "localhost|127\.0\.0\.1") {
            throw "Local-only value is forbidden for '$key' in $Environment."
        }
    }

    if (-not $AllowPlaceholders) {
        $protectedKeys = @(
            "POSTGRES_PASSWORD",
            "MINIO_ROOT_PASSWORD",
            "YUKSALISH_DATABASE_URL",
            "YUKSALISH_AUTH_SIGNING_KEY",
            "YUKSALISH_AUTH_ENCRYPTION_KEY",
            "YUKSALISH_S3_SECRET_KEY",
            "YUKSALISH_CORS_ORIGINS",
            "CLOUDFLARED_IMAGE",
            "CLOUDFLARE_TUNNEL_TOKEN"
        )
        foreach ($key in $protectedKeys) {
            $value = $values[$key]
            if ([string]::IsNullOrWhiteSpace($value) -or
                $value -match "change-me|replace-with|example\.invalid|local-only") {
                throw "Replace the placeholder for '$key' before using $Environment."
            }
        }
    }
}

Write-Output "Environment file is valid for ${Environment}: $resolvedFile"
