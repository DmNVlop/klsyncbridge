#Requires -Version 3.0

$ErrorActionPreference = 'SilentlyContinue'

# ============================================================
# Auto-elevar a Administrador si es necesario
# ============================================================
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "Relanzando como Administrador..." -ForegroundColor Yellow
    $psArgs = '-NoProfile -ExecutionPolicy Bypass -File "{0}"' -f $MyInvocation.MyCommand.Path
    Start-Process powershell.exe -ArgumentList $psArgs -Verb RunAs
    exit
}

$ErrorActionPreference = 'Stop'
$Host.UI.RawUI.WindowTitle = 'KLSyncBridge - Instalacion'
Set-Location $PSScriptRoot

function Write-Step($msg) { Write-Host $msg -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "[OK] $msg" -ForegroundColor Green }
function Write-Info($msg) { Write-Host "[INFO] $msg" -ForegroundColor Yellow }
function Write-Err($msg)  { Write-Host "[ERROR] $msg" -ForegroundColor Red }
function Write-Warn($msg) { Write-Host "[WARN] $msg" -ForegroundColor Magenta }

function Show-Requisitos {
    Write-Host ""
    Write-Host "########################################################" -ForegroundColor Red
    Write-Host "  REQUISITOS PARA INSTALAR MANUALMENTE" -ForegroundColor Red
    Write-Host "########################################################" -ForegroundColor Red
    Write-Host ""
    Write-Host "  IMPORTANTE: Esta herramienta requiere Windows x64 (64-bit)."
    Write-Host ""
    Write-Host "  1. Node.js 24 LTS (x64)"
    Write-Host "     https://nodejs.org/en/download"
    Write-Host "     (Windows Installer .msi 64-bit)"
    Write-Host ""
    Write-Host "  2. Python 3.11 (x64)"
    Write-Host "     https://www.python.org/ftp/python/3.11.9/python-3.11.9-amd64.exe"
    Write-Host "     IMPORTANTE: marcar 'Add Python to PATH'"
    Write-Host ""
    Write-Host "  3. Visual C++ Build Tools 2022 (x64)"
    Write-Host "     https://aka.ms/vs/17/release/vs_buildtools.exe"
    Write-Host "     Workload: 'Desarrollo de escritorio con C++'"
    Write-Host ""
    Write-Host "  Instalar los 3, REINICIAR el servidor,"
    Write-Host "  luego volver a ejecutar instalar.bat como Administrador."
    Write-Host ""
    Write-Host "  ALTERNATIVA OFFLINE: colocar instaladores en prereqs\"
    Write-Host "  Ver prereqs\LEEME.txt para instrucciones detalladas."
    Write-Host ""
    Write-Host "########################################################" -ForegroundColor Red
    Write-Host ""
}

function Invoke-DownloadFile($url, $dest) {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing
}

function Ask-Confirmacion($pregunta) {
    Write-Host ""
    Write-Host "  $pregunta" -ForegroundColor Yellow
    Write-Host "  [S] Si, descargar de internet    [N] No, cancelar" -ForegroundColor White
    Write-Host ""
    $resp = $null
    while ($resp -notin @('S','N')) {
        $resp = (Read-Host "  Su eleccion (S/N)").Trim().ToUpper()
    }
    Write-Host ""
    return ($resp -eq 'S')
}

function Show-InstallSpinner($proc, $label) {
    $startTime = [DateTime]::Now
    $spinner = @('|','/','-','\')
    $i = 0
    while (-not $proc.HasExited) {
        $elapsed = [DateTime]::Now - $startTime
        $mins = [int]$elapsed.TotalMinutes
        $secs = $elapsed.Seconds
        Write-Host -NoNewline "`r  $($spinner[$i % 4])  $label... $($mins)m $($secs)s transcurridos    "
        $i++
        Start-Sleep -Seconds 1
    }
    $elapsed = [DateTime]::Now - $startTime
    Write-Host "`r  [OK] Completado en $([int]$elapsed.TotalMinutes)m $($elapsed.Seconds)s        "
    Write-Host ""
}

# ============================================================
# TEST DE VELOCIDAD DE CONEXION A INTERNET
# ============================================================
function Test-Internet {
    $ErrorActionPreference = 'SilentlyContinue'
    # Ping a 8.8.8.8 para verificar conectividad basica
    $pingOk = Test-Connection -ComputerName "8.8.8.8" -Count 1 -Quiet
    if (-not $pingOk) {
        $ErrorActionPreference = 'Stop'
        return @{ ok = $false; speed = 'sin conexion' }
    }

    # Medir velocidad descargando un archivo pequeno de Microsoft (~100KB)
    $testUrl = 'https://raw.githubusercontent.com/microsoft/vswhere/main/LICENSE.txt'
    $testFile = "$env:TEMP\klsb_speedtest.tmp"
    $startTime = [DateTime]::Now
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -Uri $testUrl -OutFile $testFile -UseBasicParsing -TimeoutSec 15 | Out-Null
        $elapsed = ([DateTime]::Now - $startTime).TotalSeconds
        $size = (Get-Item $testFile -ErrorAction SilentlyContinue).Length
        Remove-Item $testFile -Force -ErrorAction SilentlyContinue
        if ($elapsed -gt 0 -and $size -gt 0) {
            $kbps = [int](($size / $elapsed) / 1024)
            $speed = if ($kbps -gt 500) { 'rapida' } elseif ($kbps -gt 100) { 'normal' } else { 'lenta' }
            $ErrorActionPreference = 'Stop'
            return @{ ok = $true; speed = $speed; kbps = $kbps }
        }
    } catch { }
    Remove-Item $testFile -Force -ErrorAction SilentlyContinue
    $ErrorActionPreference = 'Stop'
    return @{ ok = $true; speed = 'desconocida'; kbps = 0 }
}

# ============================================================
# HEADER
# ============================================================
Write-Host ""
Write-Host "========================================================" -ForegroundColor White
Write-Host "  KLSyncBridge - Instalacion" -ForegroundColor White
Write-Host "========================================================" -ForegroundColor White
Write-Host ""
Write-Info "Directorio de trabajo: $PSScriptRoot"
Write-Host ""

# ============================================================
# VERIFICAR ARQUITECTURA x64 - OBLIGATORIO
# ============================================================
Write-Step "Verificando arquitectura del sistema..."
$arch = $env:PROCESSOR_ARCHITECTURE
$is64 = ($arch -eq 'AMD64') -or ($arch -eq 'EM64T') -or ([Environment]::Is64BitOperatingSystem)
if (-not $is64) {
    Write-Err "Sistema operativo de 32-bit detectado ($arch)."
    Write-Err "KLSyncBridge requiere Windows x64 (64-bit). No es compatible con sistemas de 32-bit."
    Write-Host ""
    Write-Host "  Esta herramienta utiliza modulos nativos (better-sqlite3) que" -ForegroundColor Red
    Write-Host "  solo tienen soporte para arquitecturas x64." -ForegroundColor Red
    Write-Host ""
    Read-Host "Presione Enter para salir"
    exit 1
}
Write-Ok "Arquitectura: x64 ($arch)"
Write-Host ""

# ============================================================
# VERIFICAR NODE.JS
# ============================================================
Write-Step "Verificando Node.js..."
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
    Write-Err "Node.js no esta instalado."
    Show-Requisitos
    Read-Host "Presione Enter para salir"
    exit 1
}
$nodeVer = & node --version 2>&1
# Verificar que Node sea x64
$ErrorActionPreference = 'SilentlyContinue'
$nodeArch = & node -e "process.stdout.write(process.arch)" 2>&1
$ErrorActionPreference = 'Stop'
if ($nodeArch -ne 'x64') {
    Write-Err "Node.js instalado es $nodeArch. Se requiere Node.js x64."
    Write-Err "Desinstale la version actual e instale Node.js 24 LTS (Windows x64 .msi)."
    Show-Requisitos
    Read-Host "Presione Enter para salir"
    exit 1
}
Write-Ok "Node.js: $nodeVer ($nodeArch)"
Write-Host ""

# ============================================================
# VERIFICAR INTERNET (para saber si modo offline o no)
# ============================================================
Write-Step "Verificando conexion a internet..."
$internet = Test-Internet
if (-not $internet.ok) {
    Write-Warn "Sin conexion a internet. Se usaran solo instaladores locales de prereqs\."
} elseif ($internet.speed -eq 'lenta') {
    Write-Warn "Conexion a internet LENTA detectada ($($internet.kbps) KB/s). Las descargas pueden tardar bastante."
    Write-Info "Consejo: coloque los instaladores en prereqs\ para evitar descargas."
} elseif ($internet.speed -eq 'normal') {
    Write-Ok "Conexion a internet disponible ($($internet.kbps) KB/s)."
} elseif ($internet.speed -eq 'rapida') {
    Write-Ok "Conexion a internet disponible ($($internet.kbps) KB/s)."
} else {
    Write-Ok "Conexion a internet disponible."
}
$hayInternet = $internet.ok
Write-Host ""

# ============================================================
# FUNCION: Instalar desde local o descargar
# ============================================================
function Install-Prerequisite {
    param(
        [string]$nombre,
        [string[]]$localPaths,
        [string]$downloadUrl,
        [string]$tempName,
        [string]$tamanoAprox
    )

    $installer = $null

    # 1. Buscar local primero
    foreach ($lp in $localPaths) {
        $full = Join-Path $PSScriptRoot $lp
        if (Test-Path $full) {
            Write-Ok "Instalador local encontrado: $lp"
            $installer = $full
            break
        }
    }

    # 2. No hay local - informar y preguntar
    if (-not $installer) {
        Write-Warn "$nombre no encontrado en prereqs\."
        Write-Host ""
        Write-Host "  Ubicaciones buscadas:" -ForegroundColor White
        foreach ($lp in $localPaths) { Write-Host "    prereqs\$lp" -ForegroundColor Gray }
        Write-Host ""
        Write-Host "  Ver prereqs\LEEME.txt para saber que descargar y donde colocarlo." -ForegroundColor White

        if (-not $hayInternet) {
            Write-Host ""
            Write-Err "Sin conexion a internet. No es posible descargar automaticamente."
            Write-Err "Coloque el instalador en prereqs\ y vuelva a ejecutar instalar.bat."
            Show-Requisitos
            Read-Host "Presione Enter para salir"
            exit 1
        }

        # Hay internet - preguntar
        $msg = "Descargar $nombre desde internet"
        if ($tamanoAprox) { $msg += " (~$tamanoAprox)" }
        $msg += "?"
        if ($internet.speed -eq 'lenta') {
            Write-Warn "ATENCION: Conexion lenta ($($internet.kbps) KB/s). La descarga puede tardar bastante."
        }

        $ok = Ask-Confirmacion $msg
        if (-not $ok) {
            Write-Err "Instalacion cancelada por el usuario."
            Write-Info "Coloque el instalador en prereqs\ y vuelva a ejecutar instalar.bat."
            Read-Host "Presione Enter para salir"
            exit 0
        }

        Write-Info "Descargando $nombre..."
        $dest = "$env:TEMP\$tempName"
        try {
            Invoke-DownloadFile $downloadUrl $dest
        } catch {
            Write-Err "No se pudo descargar $nombre`: $_"
            Show-Requisitos
            Read-Host "Presione Enter para salir"
            exit 1
        }
        $installer = $dest
        Write-Ok "Descarga completada."
    }

    return $installer
}

# ============================================================
# VERIFICAR / INSTALAR PYTHON
# ============================================================
Write-Step "Verificando Python (requerido para compilar modulos nativos)..."

$pythonExe = $null

# Buscar en PATH
foreach ($cmd in @('python', 'py')) {
    $found = Get-Command $cmd -ErrorAction SilentlyContinue
    if ($found) {
        $ErrorActionPreference = 'SilentlyContinue'
        & $cmd --version 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) { $pythonExe = $found.Source }
        $ErrorActionPreference = 'Stop'
        if ($pythonExe) { break }
    }
}

# Buscar en rutas fijas
if (-not $pythonExe) {
    $rutas = @(
        'C:\Python313\python.exe', 'C:\Python312\python.exe', 'C:\Python311\python.exe',
        'C:\Program Files\Python313\python.exe', 'C:\Program Files\Python312\python.exe',
        'C:\Program Files\Python311\python.exe',
        "$env:LOCALAPPDATA\Programs\Python\Python313\python.exe",
        "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe",
        "$env:LOCALAPPDATA\Programs\Python\Python311\python.exe"
    )
    foreach ($ruta in $rutas) {
        if (Test-Path $ruta) {
            $ErrorActionPreference = 'SilentlyContinue'
            & $ruta --version 2>&1 | Out-Null
            if ($LASTEXITCODE -eq 0) { $pythonExe = $ruta }
            $ErrorActionPreference = 'Stop'
            if ($pythonExe) { break }
        }
    }
}

if (-not $pythonExe) {
    Write-Info "Python no encontrado. Buscando instalador..."
    $pyInstaller = Install-Prerequisite `
        -nombre 'Python 3.11 x64' `
        -localPaths @('prereqs\python-3.11.9-amd64.exe') `
        -downloadUrl 'https://www.python.org/ftp/python/3.11.9/python-3.11.9-amd64.exe' `
        -tempName 'python311_setup.exe' `
        -tamanoAprox '25 MB'

    Write-Info "Instalando Python 3.11 x64 (modo silencioso)..."
    $proc = Start-Process -FilePath $pyInstaller -ArgumentList '/quiet InstallAllUsers=1 PrependPath=1 Include_test=0' -Wait -PassThru
    if ($pyInstaller -like "$env:TEMP\*") { Remove-Item $pyInstaller -Force -ErrorAction SilentlyContinue }

    if ($proc.ExitCode -ne 0) {
        Write-Err "Fallo la instalacion de Python (codigo: $($proc.ExitCode))"
        Show-Requisitos
        Read-Host "Presione Enter para salir"
        exit 1
    }
    $env:PATH = [System.Environment]::GetEnvironmentVariable('PATH', 'Machine') + ';' + [System.Environment]::GetEnvironmentVariable('PATH', 'User')
    $pythonExe = 'C:\Program Files\Python311\python.exe'
    if (-not (Test-Path $pythonExe)) { $pythonExe = 'C:\Python311\python.exe' }
    Write-Ok "Python 3.11 x64 instalado: $pythonExe"
} else {
    Write-Ok "Python encontrado: $pythonExe"
}

$env:PYTHON = $pythonExe
Write-Host ""

# ============================================================
# VERIFICAR / INSTALAR VISUAL C++ BUILD TOOLS
# ============================================================
Write-Step "Verificando Visual C++ Build Tools..."

$vcbtOk = $false

# Metodo 1: vswhere.exe (herramienta oficial de Microsoft)
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
if (Test-Path $vswhere) {
    $ErrorActionPreference = 'SilentlyContinue'
    $vswhereOut = & $vswhere -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>&1
    if ($LASTEXITCODE -eq 0 -and $vswhereOut) { $vcbtOk = $true }
    $ErrorActionPreference = 'Stop'
}

# Metodo 2: cl.exe en rutas de Build Tools
if (-not $vcbtOk) {
    foreach ($p in @(
        'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC',
        'C:\Program Files (x86)\Microsoft Visual Studio\2019\BuildTools\VC\Tools\MSVC',
        'C:\BuildTools\VC\Tools\MSVC'
    )) {
        if (Test-Path $p) {
            $clExe = Get-ChildItem -Path $p -Filter 'cl.exe' -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($clExe) { $vcbtOk = $true; break }
        }
    }
}

# Metodo 3: MSBuild en rutas de Build Tools
if (-not $vcbtOk) {
    foreach ($p in @(
        'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\MSBuild\Current\Bin\MSBuild.exe',
        'C:\Program Files (x86)\Microsoft Visual Studio\2019\BuildTools\MSBuild\Current\Bin\MSBuild.exe',
        'C:\BuildTools\MSBuild\Current\Bin\MSBuild.exe'
    )) {
        if (Test-Path $p) { $vcbtOk = $true; break }
    }
}

if (-not $vcbtOk) {
    Write-Info "Visual C++ Build Tools no encontrados. Buscando instalador local..."

    $vsLayoutLocal    = Join-Path $PSScriptRoot 'prereqs\vs_layout\vs_buildtools.exe'
    $vsBootstrapLocal = Join-Path $PSScriptRoot 'prereqs\vs_buildtools.exe'
    $vcArgs = '--wait --quiet --add Microsoft.VisualStudio.Workload.VCTools --add Microsoft.VisualStudio.Component.Windows10SDK.19041 --includeRecommended'
    $proc = $null

    if (Test-Path $vsLayoutLocal) {
        # Opcion A: layout offline completo
        Write-Ok "Layout offline encontrado: prereqs\vs_layout\"
        Write-Info "Instalando Visual C++ Build Tools sin internet (puede tardar 10-20 min)..."
        Write-Host ""
        $proc = Start-Process -FilePath $vsLayoutLocal -ArgumentList "$vcArgs --noweb" -PassThru
        Show-InstallSpinner $proc "Instalando Build Tools (offline)"

    } elseif (Test-Path $vsBootstrapLocal) {
        # Opcion B: bootstrapper local pero descarga componentes (~2-3 GB)
        Write-Ok "Bootstrapper local encontrado: prereqs\vs_buildtools.exe"
        Write-Warn "El bootstrapper descargara ~2-3 GB de componentes desde internet."
        if ($internet.speed -eq 'lenta') {
            Write-Warn "Conexion lenta ($($internet.kbps) KB/s). Esto puede tardar mucho."
            Write-Warn "Alternativa recomendada: generar layout offline. Ver prereqs\LEEME.txt."
        }
        if (-not $hayInternet) {
            Write-Err "Sin internet. El bootstrapper local requiere internet para descargar componentes."
            Write-Err "Use el layout offline completo: prereqs\vs_layout\"
            Write-Err "Ver prereqs\LEEME.txt para instrucciones."
            Show-Requisitos
            Read-Host "Presione Enter para salir"
            exit 1
        }
        $ok = Ask-Confirmacion "Instalar Visual C++ Build Tools descargando ~2-3 GB desde internet?"
        if (-not $ok) {
            Write-Err "Instalacion cancelada. Alternativas:"
            Write-Err "  - prereqs\vs_layout\  (layout offline, sin internet, ver prereqs\LEEME.txt)"
            Read-Host "Presione Enter para salir"
            exit 0
        }
        Write-Info "Instalando Visual C++ Build Tools (puede tardar 10-20 min)..."
        Write-Host ""
        $proc = Start-Process -FilePath $vsBootstrapLocal -ArgumentList $vcArgs -PassThru
        Show-InstallSpinner $proc "Instalando Build Tools"

    } else {
        # Opcion C: nada local
        Write-Warn "No se encontro ningun instalador local de Visual C++ Build Tools."
        Write-Host ""
        Write-Host "  Ubicaciones buscadas:" -ForegroundColor White
        Write-Host "    prereqs\vs_layout\vs_buildtools.exe  (layout offline, recomendado)" -ForegroundColor Gray
        Write-Host "    prereqs\vs_buildtools.exe            (bootstrapper)" -ForegroundColor Gray
        Write-Host ""
        Write-Host "  Ver prereqs\LEEME.txt para saber como preparar los instaladores." -ForegroundColor White

        if (-not $hayInternet) {
            Write-Host ""
            Write-Err "Sin conexion a internet. No es posible descargar automaticamente."
            Show-Requisitos
            Read-Host "Presione Enter para salir"
            exit 1
        }

        if ($internet.speed -eq 'lenta') {
            Write-Warn "ATENCION: Conexion lenta ($($internet.kbps) KB/s)."
            Write-Warn "El bootstrapper descargara ~2-3 GB. Esto puede tardar mucho tiempo."
            Write-Warn "Se recomienda preparar el layout offline. Ver prereqs\LEEME.txt."
        }

        $ok = Ask-Confirmacion "Descargar bootstrapper de Visual C++ Build Tools e instalar (~2-3 GB desde internet)?"
        if (-not $ok) {
            Write-Err "Instalacion cancelada. Prepare los instaladores en prereqs\ y vuelva a ejecutar."
            Write-Info "Ver prereqs\LEEME.txt para instrucciones."
            Read-Host "Presione Enter para salir"
            exit 0
        }

        Write-Info "Descargando bootstrapper (~4 MB)..."
        $vsInstaller = "$env:TEMP\vs_buildtools.exe"
        try {
            Invoke-DownloadFile 'https://aka.ms/vs/17/release/vs_buildtools.exe' $vsInstaller
        } catch {
            Write-Err "No se pudo descargar Visual C++ Build Tools: $_"
            Show-Requisitos
            Read-Host "Presione Enter para salir"
            exit 1
        }
        Write-Info "Instalando Visual C++ Build Tools (puede tardar 10-20 min)..."
        Write-Host ""
        $proc = Start-Process -FilePath $vsInstaller -ArgumentList $vcArgs -PassThru
        Remove-Item $vsInstaller -Force -ErrorAction SilentlyContinue
        Show-InstallSpinner $proc "Instalando Build Tools"
    }

    if ($proc -and $proc.ExitCode -ne 0) {
        Write-Err "Fallo la instalacion de Visual C++ Build Tools (codigo: $($proc.ExitCode))"
        Show-Requisitos
        Read-Host "Presione Enter para salir"
        exit 1
    }
    Write-Ok "Visual C++ Build Tools instalados."
    Write-Info "Si npm install falla a continuacion, REINICIAR el servidor y volver a ejecutar instalar.bat"
} else {
    Write-Ok "Visual C++ Build Tools detectados."
}
Write-Host ""

# ============================================================
# PASO 1 - npm install
# ============================================================
Write-Host "--------------------------------------------------------"
Write-Host " Paso 1/3 - Instalando dependencias npm..."
Write-Host "--------------------------------------------------------"

$env:npm_config_msvs_version = '2022'
$env:npm_config_build_from_source = 'false'

$ErrorActionPreference = 'SilentlyContinue'
& npm install --msvs_version=2022
$npmExit = $LASTEXITCODE
$ErrorActionPreference = 'Stop'

if ($npmExit -ne 0) {
    Write-Info "Primer intento fallo. Reintentando con compilacion desde fuente..."
    if (Test-Path 'node_modules') {
        $ErrorActionPreference = 'SilentlyContinue'
        Remove-Item -Recurse -Force 'node_modules' -ErrorAction SilentlyContinue
        $ErrorActionPreference = 'Stop'
    }
    $env:npm_config_build_from_source = 'true'
    $ErrorActionPreference = 'SilentlyContinue'
    & npm install --msvs_version=2022 --build-from-source
    $npmExit = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
}

if ($npmExit -ne 0) {
    Write-Err "Fallo npm install."
    Write-Host ""
    Write-Host "Si Build Tools se instalaron ahora: REINICIAR y volver a ejecutar instalar.bat" -ForegroundColor Yellow
    Show-Requisitos
    Read-Host "Presione Enter para salir"
    exit 1
}
Write-Ok "Dependencias instaladas."
Write-Host ""

# ============================================================
# VERIFICAR compatibilidad better-sqlite3 con Node 24
# ============================================================
$ErrorActionPreference = 'SilentlyContinue'
$bsVer = & node -e "try{console.log(require('./node_modules/better-sqlite3/package.json').version)}catch(e){console.log('none')}" 2>&1
$ErrorActionPreference = 'Stop'
if ($bsVer -and $bsVer -ne 'none') {
    $parts = $bsVer.Split('.')
    $major = [int]$parts[0]; $minor = [int]$parts[1]
    if ($major -lt 11 -or ($major -eq 11 -and $minor -lt 10)) {
        Write-Info "better-sqlite3 v$bsVer sin prebuild para Node 24. Actualizando..."
        $ErrorActionPreference = 'SilentlyContinue'
        & npm install better-sqlite3@^11.10.0 --save 2>&1 | Out-Null
        $ErrorActionPreference = 'Stop'
        Write-Ok "better-sqlite3 actualizado."
    }
}

# ============================================================
# PASO 2 - Setup
# ============================================================
Write-Host "--------------------------------------------------------"
Write-Host " Paso 2/3 - Configuracion inicial..."
Write-Host "--------------------------------------------------------"
$ErrorActionPreference = 'SilentlyContinue'
& node scripts/setup.js
$setupExit = $LASTEXITCODE
$ErrorActionPreference = 'Stop'
if ($setupExit -ne 0) {
    Write-Err "Fallo el setup."
    Read-Host "Presione Enter para salir"
    exit 1
}
Write-Host ""

# ============================================================
# PASO 3 - Servicio Windows
# ============================================================
Write-Host "--------------------------------------------------------"
Write-Host " Paso 3/3 - Instalando servicio Windows..."
Write-Host "--------------------------------------------------------"
$ErrorActionPreference = 'SilentlyContinue'
& node scripts/install-service.js
$svcExit = $LASTEXITCODE
$ErrorActionPreference = 'Stop'
if ($svcExit -ne 0) {
    Write-Err "Fallo la instalacion del servicio."
    Read-Host "Presione Enter para salir"
    exit 1
}
Write-Host ""

Write-Host "========================================================" -ForegroundColor Green
Write-Host "  Instalacion completada" -ForegroundColor Green
Write-Host "  Acceder en: http://localhost:3847" -ForegroundColor Green
Write-Host "========================================================" -ForegroundColor Green
Write-Host ""
Read-Host "Presione Enter para abrir la interfaz web"
Start-Process "http://localhost:3847"
