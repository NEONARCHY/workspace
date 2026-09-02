$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $true
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Python = Join-Path $ProjectRoot ".venv\Scripts\python.exe"

if (-not (Test-Path -LiteralPath $Python)) {
    python -m venv (Join-Path $ProjectRoot ".venv")
}

& $Python -m pip install --upgrade pip
& $Python -m pip install -r (Join-Path $ProjectRoot "requirements.lock.txt")
& $Python -m pip install --no-deps -e $ProjectRoot
Push-Location $ProjectRoot
try {
    pnpm install
}
finally {
    Pop-Location
}

Write-Host "Workspace dependencies installed."
