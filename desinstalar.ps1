#Requires -Version 3.0
$ErrorActionPreference = 'Stop'

# Auto-elevar a Administrador
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "Relanzando como Administrador..." -ForegroundColor Yellow
    $psArgs = '-NoProfile -ExecutionPolicy Bypass -File "{0}"' -f $MyInvocation.MyCommand.Path
    Start-Process powershell.exe -ArgumentList $psArgs -Verb RunAs
    exit
}

$Host.UI.RawUI.WindowTitle = 'KLSyncBridge - Desinstalacion'
Set-Location $PSScriptRoot

Write-Host ""
Write-Host "========================================================" -ForegroundColor White
Write-Host "  KLSyncBridge - Desinstalacion" -ForegroundColor White
Write-Host "========================================================" -ForegroundColor White
Write-Host ""
Write-Host "Los datos de configuracion y logs NO se borran."
Write-Host "Solo se elimina el servicio Windows."
Write-Host ""
$confirm = Read-Host "Continuar? (S/N)"
if ($confirm -notmatch '^[Ss]$') {
    Write-Host "Cancelado."
    Read-Host "Presione Enter para salir"
    exit 0
}
Write-Host ""

Write-Host "--------------------------------------------------------"
Write-Host " Desinstalando servicio Windows..."
Write-Host "--------------------------------------------------------"
$ErrorActionPreference = 'SilentlyContinue'
& node scripts/uninstall-service.js
$svcExit = $LASTEXITCODE
$ErrorActionPreference = 'Stop'
if ($svcExit -ne 0) {
    Write-Host "[WARN] El script de desinstalacion retorno codigo $svcExit (puede ser normal si el servicio ya no existia)." -ForegroundColor Yellow
}
Write-Host ""

# Eliminar accesos directos
$desktop = "$env:USERPROFILE\Desktop\KLSyncBridge.url"
$startMenu = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\KLSyncBridge"

if (Test-Path $desktop) {
    Remove-Item $desktop -Force
    Write-Host "[OK] Acceso directo del Escritorio eliminado." -ForegroundColor Green
}
if (Test-Path $startMenu) {
    Remove-Item $startMenu -Recurse -Force
    Write-Host "[OK] Acceso directo del Menu Inicio eliminado." -ForegroundColor Green
}

Write-Host ""
Write-Host "========================================================" -ForegroundColor Green
Write-Host "  Desinstalacion completada" -ForegroundColor Green
Write-Host ""
Write-Host "  Los datos en data\ y logs\ se conservan."
Write-Host "  Para borrado total, eliminar esta carpeta completa."
Write-Host "========================================================" -ForegroundColor Green
Write-Host ""
Read-Host "Presione Enter para salir"
