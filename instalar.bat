@echo off
:: Launcher universal - compatible con doble clic y PowerShell
:: Toda la logica esta en instalar.ps1
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0instalar.ps1"
if %errorlevel% neq 0 pause
