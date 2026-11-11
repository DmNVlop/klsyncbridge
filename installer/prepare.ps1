param(
  [Parameter(Mandatory = $true)][string]$AppDir,
  [Parameter(Mandatory = $true)][string]$DataRoot
)
# Lo ejecuta el Setup antes de copiar ficheros: para y elimina el servicio previo
# (antiguo o de un Setup anterior) y, si es una instalación antigua (v2.2.0), migra sus datos.
# Si es una instalación antigua deja un marcador (legacy-migration.json) ANTES de parar nada:
# si el Setup falla después, rollback-legacy.ps1 restaura el servicio antiguo a partir de él.
$ErrorActionPreference = 'Stop'
$serviceName = 'klsyncbridge.exe'

function Write-Log($msg) { Write-Output "[prepare] $msg" }

function Write-Marker($path, $oldRoot, $startedAt, $dataCopied) {
  $json = [ordered]@{ oldRoot = $oldRoot; startedAt = $startedAt; dataCopied = $dataCopied } | ConvertTo-Json
  [IO.File]::WriteAllText($path, $json, (New-Object System.Text.UTF8Encoding($false)))
}

$svc = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if (-not $svc) { Write-Log 'Sin servicio previo.'; exit 0 }

# Carpeta raíz de la instalación del servicio: ImagePath = <root>\src\daemon\klsyncbridge.exe
$imagePath = (Get-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Services\$serviceName").ImagePath.Trim('"')
$oldRoot = Split-Path (Split-Path (Split-Path $imagePath -Parent) -Parent) -Parent
Write-Log "Servicio previo en: $oldRoot"

# GetFullPath no falla si la carpeta antigua ya no existe (Resolve-Path sí)
$isLegacy = -not ([IO.Path]::GetFullPath($oldRoot).TrimEnd('\') -ieq [IO.Path]::GetFullPath($AppDir).TrimEnd('\'))

$markerPath = Join-Path $DataRoot 'legacy-migration.json'
$startedAt = (Get-Date).ToString('o')

if ($isLegacy) {
  # Sin estos ficheros no habría forma de restaurar el servicio antiguo: no se toca nada.
  $oldExe = Join-Path $oldRoot 'src\daemon\klsyncbridge.exe'
  $oldXml = Join-Path $oldRoot 'src\daemon\klsyncbridge.xml'
  if (-not ((Test-Path $oldExe) -and (Test-Path $oldXml))) {
    Write-Log "Faltan klsyncbridge.exe o klsyncbridge.xml en $oldRoot\src\daemon: no se puede garantizar el rollback. No se ha cambiado nada."
    exit 3
  }
  New-Item -ItemType Directory -Force -Path $DataRoot | Out-Null
  Write-Marker $markerPath $oldRoot $startedAt $false
  Write-Log "Marcador de migración escrito: $markerPath"
} elseif (Test-Path $markerPath) {
  # Marcador de un rollback que falló antes: en una actualización normal no debe disparar otro rollback.
  $stale = 'legacy-migration.stale-{0}.json' -f (Get-Date -Format 'yyyyMMdd-HHmmss')
  Rename-Item -Path $markerPath -NewName $stale
  Write-Log "Marcador antiguo apartado como $stale"
}

try {
  if ($svc.Status -ne 'Stopped') {
    Stop-Service -Name $serviceName -Force
    $svc.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(30))
  }
  & sc.exe delete $serviceName | Out-Null
  # sc delete solo lo marca: Windows lo quita cuando nadie lo tiene abierto (p. ej. services.msc).
  # Si sigue ahí, la instalación nueva no podría crear el servicio: se para antes de copiar nada.
  $deadline = (Get-Date).AddSeconds(30)
  while ((Get-Service -Name $serviceName -ErrorAction SilentlyContinue) -and (Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 500
  }
  if (Get-Service -Name $serviceName -ErrorAction SilentlyContinue) {
    Write-Log 'El servicio previo sigue marcado para eliminación: cierra services.msc o reinicia el equipo.'
    exit 2
  }
  Write-Log 'Servicio previo parado y eliminado.'

  if (-not $isLegacy) { exit 0 }

  # Migración v2.2.0: copiar data\ y .env solo si ProgramData aún no tiene datos (nunca pisar)
  $targetData = Join-Path $DataRoot 'data'
  if (Test-Path (Join-Path $targetData 'klsyncbridge.db')) {
    Write-Log "ProgramData ya tiene datos: no se copia nada desde $oldRoot."
    exit 0
  }
  $oldData = Join-Path $oldRoot 'data'
  if (-not (Test-Path $oldData)) {
    Write-Log "La instalación antigua no tiene carpeta data: nada que migrar."
    exit 0
  }
  New-Item -ItemType Directory -Force -Path $targetData | Out-Null
  Copy-Item -Path (Join-Path $oldData '*') -Destination $targetData -Recurse -Force
  if (Test-Path (Join-Path $oldRoot '.env')) {
    Copy-Item -Path (Join-Path $oldRoot '.env') -Destination (Join-Path $DataRoot '.env') -Force
  }
  Write-Marker $markerPath $oldRoot $startedAt $true
  Write-Log "Datos migrados desde $oldRoot. La carpeta antigua se conserva como copia de seguridad."
} catch {
  # El rollback del servicio antiguo lo hace el Setup (rollback-legacy.ps1) al ver el marcador.
  Write-Log "Error preparando la instalación: $($_.Exception.Message)"
  exit 1
}
