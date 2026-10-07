@echo off
cd /d "%~dp0..\.."
node scripts\dev\local-workspace.mjs stop
if errorlevel 1 pause
