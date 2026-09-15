@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy-web.ps1" %*
exit /b %errorlevel%
