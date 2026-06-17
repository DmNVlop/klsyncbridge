@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul 2>&1

:: ============================================================
::  KLSyncBridge — Instalacion desde cero
::  Este archivo es el unico que necesitas descargar.
::  Detecta si hay un ZIP local junto a este archivo,
::  o lo descarga automaticamente desde GitHub.
:: ============================================================

set GITHUB_USER=DmNVlop
set GITHUB_REPO=klsyncbridge
set ZIP_URL=https://github.com/%GITHUB_USER%/%GITHUB_REPO%/archive/refs/heads/master.zip
set DEFAULT_INSTALL_DIR=C:\KLSyncBridge

:: ============================================================
::  AUTO-ELEVACION A ADMINISTRADOR
:: ============================================================
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo  Este instalador requiere permisos de Administrador.
    echo  Se solicitara confirmacion de UAC en un momento...
    echo.
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

title KLSyncBridge — Instalacion

cls
echo.
echo  ============================================================
echo    KLSyncBridge — Instalacion desde cero
echo  ============================================================
echo.
echo  Este asistente instalara KLSyncBridge como servicio Windows.
echo  El proceso realizara los siguientes pasos:
echo.
echo    1. Elegir ruta de instalacion
echo    2. Obtener los archivos del programa (local o GitHub)
echo    3. Extraer archivos en la ruta elegida
echo    4. Instalar dependencias y configurar el sistema
echo    5. Instalar y arrancar el servicio Windows
echo.
echo  Al finalizar podras acceder en: http://localhost:3847
echo.
echo  ============================================================
echo.
pause

:: ============================================================
::  PASO 1 — ELEGIR RUTA DE INSTALACION
:: ============================================================
cls
echo.
echo  ============================================================
echo    Paso 1/5 — Ruta de instalacion
echo  ============================================================
echo.
echo  Introduce la ruta donde se instalara KLSyncBridge.
echo  Deja en blanco y presiona Enter para usar la ruta por defecto.
echo.
echo    Por defecto: %DEFAULT_INSTALL_DIR%
echo.
echo  IMPORTANTE: Si la carpeta ya existe, los archivos del programa
echo  seran reemplazados. Los datos (base de datos, logs, configuracion)
echo  se conservaran intactos.
echo.
set /p INSTALL_DIR="  Ruta de instalacion [%DEFAULT_INSTALL_DIR%]: "
if "!INSTALL_DIR!"=="" set INSTALL_DIR=%DEFAULT_INSTALL_DIR%

echo.
echo  [INFO] Ruta seleccionada: !INSTALL_DIR!
echo.

:: Crear carpeta si no existe
if not exist "!INSTALL_DIR!" (
    echo  [INFO] La carpeta no existe. Creandola...
    mkdir "!INSTALL_DIR!" >nul 2>&1
    if %errorlevel% neq 0 (
        echo.
        echo  [ERROR] No se pudo crear la carpeta: !INSTALL_DIR!
        echo  Verifica que la ruta sea valida y tengas permisos suficientes.
        echo.
        pause
        exit /b 1
    )
    echo  [OK] Carpeta creada correctamente.
) else (
    echo  [INFO] La carpeta ya existe. Se usara directamente.
)
echo.

:: ============================================================
::  PASO 2 — OBTENER ARCHIVOS (ZIP LOCAL O DESCARGA)
:: ============================================================
cls
echo.
echo  ============================================================
echo    Paso 2/5 — Obtener archivos del programa
echo  ============================================================
echo.

set ZIP_FILE=
set ZIP_TEMP=

:: Buscar ZIP local junto a este setup.bat
:: Prioridad: klsyncbridge*.zip primero, luego master.zip (nombre por defecto de GitHub)
echo  [INFO] Buscando ZIP local junto a este archivo...
for %%F in ("%~dp0klsyncbridge*.zip") do (
    if exist "%%F" (
        set ZIP_FILE=%%F
    )
)
if not defined ZIP_FILE (
    if exist "%~dp0master.zip" set ZIP_FILE=%~dp0master.zip
)

if defined ZIP_FILE (
    echo  [OK] ZIP local encontrado: !ZIP_FILE!
    echo.
    echo  Se usara este archivo. No se realizara ninguna descarga.
) else (
    echo  [INFO] No se encontro ZIP local junto a setup.bat.
    echo.
    echo  Se descargara la version mas reciente desde GitHub:
    echo    %ZIP_URL%
    echo.
    echo  Asegurate de tener conexion a internet activa.
    echo  Si prefieres instalar sin internet, coloca el archivo ZIP
    echo  (master.zip o klsyncbridge*.zip) junto a este setup.bat
    echo  y vuelve a ejecutarlo. No necesitas renombrar el archivo.
    echo.
    pause

    set ZIP_TEMP=%TEMP%\klsyncbridge_setup.zip
    echo  [INFO] Descargando...
    powershell -NoProfile -NonInteractive -Command ^
        "try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri '%ZIP_URL%' -OutFile '!ZIP_TEMP!' -UseBasicParsing; Write-Host '[OK] Descarga completada.' } catch { Write-Host '[ERROR] ' + $_.Exception.Message; exit 1 }"
    if %errorlevel% neq 0 (
        echo.
        echo  [ERROR] No se pudo descargar el archivo desde GitHub.
        echo.
        echo  Posibles causas:
        echo    - Sin conexion a internet
        echo    - Firewall o proxy bloqueando la descarga
        echo    - Repositorio no disponible temporalmente
        echo.
        echo  Solucion: descarga el ZIP manualmente y colócalo junto
        echo  a este setup.bat, luego vuelve a ejecutar el instalador.
        echo.
        pause
        exit /b 1
    )
    set ZIP_FILE=!ZIP_TEMP!
)
echo.

:: ============================================================
::  PASO 3 — EXTRAER ARCHIVOS
:: ============================================================
cls
echo.
echo  ============================================================
echo    Paso 3/5 — Extrayendo archivos
echo  ============================================================
echo.
echo  [INFO] Destino: !INSTALL_DIR!
echo  [INFO] Origen ZIP: !ZIP_FILE!
echo.

set EXTRACT_TMP=%TEMP%\klsyncbridge_extract
if exist "%EXTRACT_TMP%" rmdir /s /q "%EXTRACT_TMP%" >nul 2>&1
mkdir "%EXTRACT_TMP%" >nul 2>&1

echo  [INFO] Extrayendo contenido del ZIP...
powershell -NoProfile -NonInteractive -Command ^
    "try { Expand-Archive -Path '!ZIP_FILE!' -DestinationPath '%EXTRACT_TMP%' -Force; Write-Host '[OK] Extraccion completada.' } catch { Write-Host '[ERROR] ' + $_.Exception.Message; exit 1 }"
if %errorlevel% neq 0 (
    echo.
    echo  [ERROR] No se pudo extraer el ZIP.
    echo  El archivo puede estar corrupto o incompleto.
    echo.
    if defined ZIP_TEMP if exist "!ZIP_TEMP!" del /f /q "!ZIP_TEMP!" >nul 2>&1
    pause
    exit /b 1
)

:: Encontrar la subcarpeta raiz dentro del ZIP (ej: klsyncbridge-master)
set INNER_DIR=
for /d %%D in ("%EXTRACT_TMP%\*") do (
    if not defined INNER_DIR set INNER_DIR=%%D
)

if not defined INNER_DIR (
    echo.
    echo  [ERROR] El ZIP no contiene la estructura esperada.
    echo  Verifica que el archivo descargado sea el correcto.
    echo.
    rmdir /s /q "%EXTRACT_TMP%" >nul 2>&1
    if defined ZIP_TEMP if exist "!ZIP_TEMP!" del /f /q "!ZIP_TEMP!" >nul 2>&1
    pause
    exit /b 1
)

echo  [INFO] Copiando archivos a: !INSTALL_DIR!
echo.
echo  Se copiaran: src\, public\, scripts\, docs\,
echo               package.json, package-lock.json,
echo               instalar.bat, instalar.ps1,
echo               desinstalar.bat, desinstalar.ps1,
echo               update.bat, version.json, .env.example
echo.
echo  Se conservaran sin tocar: data\, logs\, node_modules\, .env
echo.

for %%F in (src public scripts docs) do (
    if exist "!INNER_DIR!\%%F" (
        if exist "!INSTALL_DIR!\%%F" rmdir /s /q "!INSTALL_DIR!\%%F" >nul 2>&1
        xcopy /e /i /q "!INNER_DIR!\%%F" "!INSTALL_DIR!\%%F\" >nul
        echo  [OK] Copiado: %%F\
    )
)

for %%F in (package.json package-lock.json version.json .env.example instalar.bat instalar.ps1 desinstalar.bat desinstalar.ps1 update.bat) do (
    if exist "!INNER_DIR!\%%F" (
        copy /y "!INNER_DIR!\%%F" "!INSTALL_DIR!\%%F" >nul
        echo  [OK] Copiado: %%F
    )
)

:: Limpiar temporales
rmdir /s /q "%EXTRACT_TMP%" >nul 2>&1
if defined ZIP_TEMP if exist "!ZIP_TEMP!" del /f /q "!ZIP_TEMP!" >nul 2>&1

echo.
echo  [OK] Archivos copiados correctamente.
echo.

:: ============================================================
::  PASO 4 y 5 — INSTALAR DEPENDENCIAS + SERVICIO WINDOWS
:: ============================================================
cls
echo.
echo  ============================================================
echo    Pasos 4 y 5/5 — Instalacion de dependencias y servicio
echo  ============================================================
echo.
echo  A continuacion se ejecutara el instalador principal:
echo    !INSTALL_DIR!\instalar.ps1
echo.
echo  Este proceso realizara:
echo    - Verificar/instalar Node.js 24 LTS
echo    - Verificar/instalar Python y Visual C++ Build Tools
echo      (necesarios para compilar modulos nativos de SQLite)
echo    - Ejecutar npm install (descarga dependencias ~50-200 MB)
echo    - Generar clave de cifrado y crear usuario admin inicial
echo    - Instalar KLSyncBridge como servicio Windows
echo.
echo  Tiempo estimado: 5-20 minutos segun conexion y prerequisitos.
echo.
echo  NO cierres esta ventana durante el proceso.
echo.
pause

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "!INSTALL_DIR!\instalar.ps1"
set PS_EXIT=%errorlevel%

echo.
if %PS_EXIT% equ 0 (
    echo  ============================================================
    echo    Instalacion completada exitosamente.
    echo.
    echo    KLSyncBridge esta corriendo como servicio Windows.
    echo    Accede en: http://localhost:3847
    echo.
    echo    Credenciales iniciales:
    echo      Usuario: admin
    echo      Contrasena: (se genero durante la instalacion)
    echo      Ver pantalla anterior para la contrasena generada.
    echo  ============================================================
) else (
    echo  ============================================================
    echo    [ERROR] La instalacion no se completo correctamente.
    echo.
    echo    Codigo de error: %PS_EXIT%
    echo.
    echo    Revisa los mensajes anteriores para identificar el problema.
    echo    Soluciones comunes:
    echo      - Reiniciar el servidor y volver a ejecutar instalar.bat
    echo        desde la carpeta !INSTALL_DIR!
    echo      - Colocar prerequisitos en !INSTALL_DIR!\prereqs\
    echo        (ver prereqs\LEEME.txt para instrucciones)
    echo  ============================================================
)
echo.
pause
exit /b %PS_EXIT%
