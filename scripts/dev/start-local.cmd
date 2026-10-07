@echo off
cd /d "%~dp0..\.."
node scripts\dev\local-workspace.mjs start --detach --wait
if errorlevel 1 (
  pause
  exit /b 1
)
start "" "https://localhost:5173"
