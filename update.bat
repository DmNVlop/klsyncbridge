@echo off
setlocal enabledelayedexpansion
title KLSyncBridge — Actualización manual

set GITHUB_USER=DmNVlop
set GITHUB_REPO=klsyncbridge
set ZIP_URL=https://github.com/%GITHUB_USER%/%GITHUB_REPO%/archive/refs/heads/master.zip
set TMP_DIR=%~dp0temp_update
set ZIP_FILE=%TMP_DIR%\update.zip

echo.
echo ============================================================
echo   KLSyncBridge — Actualizacion manual
echo ============================================================
echo.

REM Detener servicio si está corriendo
echo [1/6] Deteniendo servicio Windows (si existe)...
sc stop klsyncbridge.exe >nul 2>&1
timeout /t 3 /nobreak >nul

REM Crear carpeta temporal
if exist "%TMP_DIR%" rmdir /s /q "%TMP_DIR%"
mkdir "%TMP_DIR%"

REM Descargar ZIP con PowerShell
echo [2/6] Descargando actualizacion desde GitHub...
powershell -NoProfile -NonInteractive -Command ^
  "try { Invoke-WebRequest -Uri '%ZIP_URL%' -OutFile '%ZIP_FILE%' -UseBasicParsing; Write-Host 'OK' } catch { Write-Host ('ERROR: ' + $_.Exception.Message); exit 1 }"
if %ERRORLEVEL% NEQ 0 (
  echo ERROR: No se pudo descargar la actualizacion.
  echo Verifica tu conexion a internet e intenta de nuevo.
  goto :cleanup_error
)

REM Extraer ZIP
echo [3/6] Extrayendo archivos...
powershell -NoProfile -NonInteractive -Command ^
  "Expand-Archive -Path '%ZIP_FILE%' -DestinationPath '%TMP_DIR%\extracted' -Force"
if %ERRORLEVEL% NEQ 0 (
  echo ERROR: No se pudo extraer el ZIP.
  goto :cleanup_error
)

REM Copiar archivos (preservar data/, logs/, .env, node_modules/)
echo [4/6] Copiando archivos nuevos...
for /d %%D in ("%TMP_DIR%\extracted\*") do set INNER=%%D

if not defined INNER (
  echo ERROR: No se encontro contenido en el ZIP.
  goto :cleanup_error
)

for %%F in (src public scripts docs) do (
  if exist "!INNER!\%%F" (
    if exist "%~dp0%%F" rmdir /s /q "%~dp0%%F"
    xcopy /e /i /q "!INNER!\%%F" "%~dp0%%F\" >nul
    echo    Copiado: %%F\
  )
)
for %%F in (package.json package-lock.json version.json .env.example) do (
  if exist "!INNER!\%%F" (
    copy /y "!INNER!\%%F" "%~dp0%%F" >nul
  )
)

REM Limpiar temp
rmdir /s /q "%TMP_DIR%" >nul 2>&1

REM npm install
echo [5/6] Instalando dependencias...
cd /d "%~dp0"
call npm install --omit=dev --silent
if %ERRORLEVEL% NEQ 0 (
  echo ERROR: npm install fallo.
  goto :error
)

REM Migraciones
echo [6/6] Aplicando migraciones de base de datos...
node scripts\setup.js
if %ERRORLEVEL% NEQ 0 (
  echo ADVERTENCIA: setup.js retorno un error. Verifica los logs.
)

REM Iniciar servicio
echo.
echo Iniciando servicio Windows...
sc start klsyncbridge.exe >nul 2>&1
if %ERRORLEVEL% EQU 0 (
  echo Servicio iniciado correctamente.
) else (
  echo El servicio no esta instalado o no se pudo iniciar.
  echo Puedes iniciarlo manualmente con: npm start
)

echo.
echo ============================================================
echo   Actualizacion completada exitosamente.
echo   Abre http://localhost:3847 para verificar la version.
echo ============================================================
echo.
pause
exit /b 0

:cleanup_error
  rmdir /s /q "%TMP_DIR%" >nul 2>&1
:error
  echo.
  echo ============================================================
  echo   La actualizacion fallo. No se modificaron los archivos.
  echo ============================================================
  echo.
  pause
  exit /b 1
