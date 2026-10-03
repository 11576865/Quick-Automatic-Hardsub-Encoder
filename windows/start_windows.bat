@echo off
setlocal
cd /d "%~dp0"
start "Quick Hardsub - Windows Native Bridge" powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0native-bridge.ps1"
exit /b 0
