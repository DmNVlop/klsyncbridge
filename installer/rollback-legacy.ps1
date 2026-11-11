param(
  [Parameter(Mandatory = $true)][string]$AppDir,
  [Parameter(Mandatory = $true)][string]$DataRoot
)
# Restaura el servicio de una instalación antigua (carpeta propia) cuando el Setup falla tras pararlo.
# Lo ejecuta el Setup (DeinitializeSetup) y también se puede lanzar a mano. Es idempotente:
# sin marcador (legacy-migration.json) no hace nada; con él, deja el servicio antiguo en marcha.
$ErrorActionPreference = 'Stop'
$serviceName = 'klsyncbridge.exe'
$logDir = Join-Path $DataRoot 'logs'
$logFile = Join-Path $logDir 'legacy-rollback.log'
$markerPath = Join-Path $DataRoot 'legacy-migration.json'

function Write-Log($msg) {
  $line = '{0} [rollback] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
  Write-Output $line
  try {
    if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Force -Path $logDir | Out-Null }
    Add-Content -Path $logFile -Value $line -Encoding UTF8
  } catch {
    Write-Output "No se pudo escribir el log: $($_.Exception.Message)"
  }
}

function Get-ServiceImagePath {
  $key = "HKLM:\SYSTEM\CurrentControlSet\Services\$serviceName"
  if (-not (Test-Path $key)) { return $null }
  return ([string](Get-ItemProperty $key).ImagePath).Trim('"')
}

function Test-IsUnder($path, $folder) {
  if (-not $path) { return $false }
  $p = [IO.Path]::GetFullPath($path).TrimEnd('\') + '\'
  $f = [IO.Path]::GetFullPath($folder).TrimEnd('\') + '\'
  return $p.StartsWith($f, [StringComparison]::OrdinalIgnoreCase)
}

function Wait-ServiceGone($seconds) {
  $deadline = (Get-Date).AddSeconds($seconds)
  while ((Get-Service -Name $serviceName -ErrorAction SilentlyContinue) -and (Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 500
  }
  return -not (Get-Service -Name $serviceName -ErrorAction SilentlyContinue)
}

try {
  if (-not (Test-Path $markerPath)) {
    Write-Log 'Sin marcador de migración: no hay nada que restaurar.'
    exit 0
  }
  $marker = Get-Content -Raw -Path $markerPath | ConvertFrom-Json
  $oldRoot = [string]$marker.oldRoot
  Write-Log "Restaurando el servicio antiguo de: $oldRoot"

  # 1. Si el servicio registrado es el NUEVO (bajo AppDir), se elimina junto con su envoltorio.
  $svc = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
  if ($svc -and (Test-IsUnder (Get-ServiceImagePath) $AppDir)) {
    Write-Log 'Eliminando el servicio nuevo.'
    if ($svc.Status -ne 'Stopped') {
      Stop-Service -Name $serviceName -Force
      $svc.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(30))
    }
    & sc.exe delete $serviceName | Out-Null
    if (-not (Wait-ServiceGone 30)) { throw 'El servicio nuevo sigue marcado para eliminación (cierra services.msc o reinicia el equipo).' }
    $newDaemon = Join-Path $AppDir 'src\daemon'
    if (Test-Path $newDaemon) { Remove-Item -Recurse -Force -Path $newDaemon }
  }

  # 2. Datos copiados a ProgramData: se apartan para que un reintento vuelva a migrar desde la carpeta antigua.
  if ($marker.dataCopied) {
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $dataDir = Join-Path $DataRoot 'data'
    $envFile = Join-Path $DataRoot '.env'
    if (Test-Path $dataDir) { Rename-Item -Path $dataDir -NewName "data.failed-$stamp"; Write-Log "data apartado como data.failed-$stamp" }
    if (Test-Path $envFile) { Rename-Item -Path $envFile -NewName ".env.failed-$stamp"; Write-Log ".env apartado como .env.failed-$stamp" }
  }

  # 3. Reinstalar el servicio antiguo con su envoltorio (el .xml conserva node, script y entorno de antes).
  $oldExe = Join-Path $oldRoot 'src\daemon\klsyncbridge.exe'
  function Install-OldService {
    if (-not (Test-Path $oldExe)) { throw "No existe ${oldExe}: no se puede reinstalar el servicio antiguo." }
    Write-Log 'Reinstalando el servicio antiguo.'
    & $oldExe install | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "klsyncbridge.exe install falló (código $LASTEXITCODE)." }
  }
  $svc = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
  if (-not $svc) {
    Install-OldService
  } elseif (Test-IsUnder (Get-ServiceImagePath) $oldRoot) {
    # Puede seguir registrado pero «marcado para eliminación» (prepare.ps1 salió con código 2): entonces no
    # arranca; se espera a que Windows lo quite y se vuelve a registrar.
    Write-Log 'El servicio antiguo sigue registrado: se intenta arrancar.'
    try {
      Start-Service -Name $serviceName
    } catch {
      Write-Log "No arranca ($($_.Exception.Message)); esperando hasta 90 s a que Windows termine de eliminarlo."
      if (-not (Wait-ServiceGone 90)) { throw 'El servicio antiguo sigue marcado para eliminación: cierra services.msc o reinicia el equipo y vuelve a lanzar este script.' }
      Install-OldService
    }
  } else {
    throw 'Hay un servicio klsyncbridge.exe registrado que no es ni el nuevo ni el antiguo; no se toca.'
  }

  # 4. Reinicio automático ante fallos (si falla, solo se avisa).
  & sc.exe failure $serviceName reset= 86400 actions= restart/5000/restart/10000/restart/30000 | Out-Null
  if ($LASTEXITCODE -ne 0) { Write-Log "Aviso: no se pudo configurar el reinicio automático (código $LASTEXITCODE)." }

  # 5. Arrancar y comprobar que responde.
  Start-Service -Name $serviceName
  (Get-Service -Name $serviceName).WaitForStatus('Running', [TimeSpan]::FromSeconds(30))
  $port = 3847
  $oldEnv = Join-Path $oldRoot '.env'
  if (Test-Path $oldEnv) {
    $m = Select-String -Path $oldEnv -Pattern '^\s*PORT\s*=\s*(\d+)' | Select-Object -First 1
    if ($m) { $port = [int]$m.Matches[0].Groups[1].Value }
  }
  $healthy = $false
  $deadline = (Get-Date).AddSeconds(60)
  while (-not $healthy -and (Get-Date) -lt $deadline) {
    try {
      $r = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$port/api/health" -TimeoutSec 3
      if ($r.StatusCode -eq 200) { $healthy = $true }
    } catch {
      Start-Sleep -Seconds 2
    }
  }
  if (-not $healthy) { throw "El servicio antiguo arrancó pero no responde en http://127.0.0.1:$port/api/health." }

  Remove-Item -Force -Path $markerPath
  Write-Log 'Servicio antiguo restaurado y respondiendo.'
  exit 0
} catch {
  Write-Log "ERROR: $($_.Exception.Message). Se conserva el marcador; revisa este log y el estado del servicio."
  exit 1
}
