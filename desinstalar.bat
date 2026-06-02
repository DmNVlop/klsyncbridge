@echo off
:: Launcher universal - compatible con doble clic y PowerShell
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0desinstalar.ps1"
if %errorlevel% neq 0 pause
