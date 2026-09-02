$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $true
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Python = Join-Path $ProjectRoot ".venv\Scripts\python.exe"

if (-not (Test-Path -LiteralPath $Python)) {
    throw "Run scripts\bootstrap.ps1 first."
}

Push-Location $ProjectRoot
try {
    & $Python -m ruff check .
    & $Python -m mypy apps modules
    & $Python -m pytest
    & $Python -m bandit -q -r apps modules -x tests
    & $Python -m pip_audit
    pnpm check
    pnpm audit --audit-level low
}
finally {
    Pop-Location
}
