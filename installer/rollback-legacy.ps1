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

function Get-ConfiguredPort {
  $port = 3847
  $envFile = Join-Path $DataRoot '.env'
  if (Test-Path $envFile) {
    $m = Select-String -Path $envFile -Pattern '^\s*PORT\s*=\s*(\d+)' | Select-Object -First 1
    if ($m) { $port = [int]$m.Matches[0].Groups[1].Value }
  }
  return $port
}

function Wait-Health($port, $seconds) {
  $deadline = (Get-Date).AddSeconds($seconds)
  do {
    try {
      $r = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$port/api/health" -TimeoutSec 3
      if ($r.StatusCode -eq 200) { return $true }
    } catch {
      Start-Sleep -Seconds 2
    }
  } while ((Get-Date) -lt $deadline)
  return $false
}

# Restaura la BD compartida (instalación antigua dentro de ProgramData) desde la copia que hizo prepare.ps1.
function Restore-SharedDb($backupDir) {
  if (-not $backupDir -or -not (Test-Path $backupDir)) {
    throw 'La instalación antigua comparte la BD con la nueva y no hay copia de seguridad (dbBackup) utilizable: no se arranca la versión antigua sobre una BD migrada.'
  }
  $dataDir = Join-Path $DataRoot 'data'
  New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
  foreach ($name in 'klsyncbridge.db-wal', 'klsyncbridge.db-shm') {
    $cur = Join-Path $dataDir $name
    if (Test-Path $cur) { Remove-Item -Force -Path $cur }
  }
  $backupDb = Join-Path $backupDir 'klsyncbridge.db'
  if (Test-Path $backupDb) {
    Copy-Item -Path $backupDb -Destination (Join-Path $dataDir 'klsyncbridge.db') -Force
  } else {
    # La copia no tenía BD (no existía al preparar): se retira la creada después.
    $curDb = Join-Path $dataDir 'klsyncbridge.db'
    if (Test-Path $curDb) { Remove-Item -Force -Path $curDb }
  }
  foreach ($name in 'klsyncbridge.db-wal', 'klsyncbridge.db-shm') {
    $b = Join-Path $backupDir $name
    if (Test-Path $b) { Copy-Item -Path $b -Destination (Join-Path $dataDir $name) -Force }
  }
  Write-Log "BD restaurada desde $backupDir"
}

Write-Log "Inicio del rollback (AppDir=$AppDir, DataRoot=$DataRoot)."
try {
  if (-not (Test-Path $markerPath)) {
    Write-Log 'Sin marcador de migración: no hay nada que restaurar.'
    exit 0
  }
  $marker = Get-Content -Raw -Path $markerPath | ConvertFrom-Json
  $oldRoot = [string]$marker.oldRoot
  $sharedRoot = [bool]$marker.sharedRoot
  $dbBackup = [string]$marker.dbBackup
  Write-Log "Restaurando el servicio antiguo de: $oldRoot (sharedRoot=$sharedRoot)"

  # 0. Si el servicio nuevo ya está en marcha y responde (p. ej. se arrancó a mano tras el fallo), no se toca.
  $svc = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
  if ($svc -and (Test-IsUnder (Get-ServiceImagePath) $AppDir)) {
    $port = Get-ConfiguredPort
    $newHealthy = $false
    if ($svc.Status -eq 'Running') {
      $newHealthy = Wait-Health $port 20
    } elseif ($svc.Status -eq 'Stopped') {
      Write-Log 'El servicio nuevo está parado: se intenta arrancar una vez antes de decidir.'
      try {
        Start-Service -Name $serviceName
        (Get-Service -Name $serviceName).WaitForStatus('Running', [TimeSpan]::FromSeconds(30))
        $newHealthy = Wait-Health $port 60
      } catch {
        Write-Log "El servicio nuevo no arranca: $($_.Exception.Message)"
      }
    }
    if ($newHealthy) {
      Remove-Item -Force -Path $markerPath
      Write-Log 'El servicio nuevo está en marcha y responde: no se restaura el antiguo.'
      exit 0
    }
    Write-Log 'El servicio nuevo no responde: se procede a restaurar el antiguo.'
  }

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
    # Los logs del envoltorio (*.err.log, *.out.log, *.wrapper.log) se conservan para soporte.
    $newDaemon = Join-Path $AppDir 'src\daemon'
    if (Test-Path $newDaemon) {
      try {
        $failedDir = Join-Path $logDir ('failed-daemon-{0}' -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
        Move-Item -Path $newDaemon -Destination $failedDir
        Write-Log "Carpeta del servicio nuevo movida a $failedDir"
      } catch {
        Write-Log "No se pudo mover $newDaemon (se continúa): $($_.Exception.Message)"
      }
    }
  }

  # 2. Datos copiados a ProgramData: se apartan para que un reintento vuelva a migrar desde la carpeta antigua.
  if ($marker.dataCopied) {
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $dataDir = Join-Path $DataRoot 'data'
    $envFile = Join-Path $DataRoot '.env'
    if (Test-Path $dataDir) { Rename-Item -Path $dataDir -NewName "data.failed-$stamp"; Write-Log "data apartado como data.failed-$stamp" }
    if (Test-Path $envFile) { Rename-Item -Path $envFile -NewName ".env.failed-$stamp"; Write-Log ".env apartado como .env.failed-$stamp" }
  }

  # 2b. BD compartida: devolverla a su estado previo (la nueva versión pudo migrarla) antes de arrancar la antigua.
  if ($sharedRoot) { Restore-SharedDb $dbBackup }

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
  $healthy = Wait-Health $port 60
  if (-not $healthy) { throw "El servicio antiguo arrancó pero no responde en http://127.0.0.1:$port/api/health." }

  Remove-Item -Force -Path $markerPath
  Write-Log 'Servicio antiguo restaurado y respondiendo.'
  exit 0
} catch {
  Write-Log "ERROR: $($_.Exception.Message). Se conserva el marcador; revisa este log y el estado del servicio."
  exit 1
}
