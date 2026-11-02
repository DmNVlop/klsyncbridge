param(
  [Parameter(Mandatory = $true)][string]$AppDir,
  [Parameter(Mandatory = $true)][string]$DataRoot
)
# Lo ejecuta el Setup antes de copiar ficheros: para y elimina el servicio previo
# (antiguo o de un Setup anterior) y, si es una instalación antigua (v2.2.0), migra sus datos.
$ErrorActionPreference = 'Stop'
$serviceName = 'klsyncbridge.exe'

function Write-Log($msg) { Write-Output "[prepare] $msg" }

$svc = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if (-not $svc) { Write-Log 'Sin servicio previo.'; exit 0 }

# Carpeta raíz de la instalación del servicio: ImagePath = <root>\src\daemon\klsyncbridge.exe
$imagePath = (Get-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Services\$serviceName").ImagePath.Trim('"')
$oldRoot = Split-Path (Split-Path (Split-Path $imagePath -Parent) -Parent) -Parent
Write-Log "Servicio previo en: $oldRoot"

if ($svc.Status -ne 'Stopped') {
  Stop-Service -Name $serviceName -Force
  $svc.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(30))
}
& sc.exe delete $serviceName | Out-Null
Write-Log 'Servicio previo parado y eliminado.'

# GetFullPath no falla si la carpeta antigua ya no existe (Resolve-Path sí)
$isLegacy = -not ([IO.Path]::GetFullPath($oldRoot).TrimEnd('\') -ieq [IO.Path]::GetFullPath($AppDir).TrimEnd('\'))
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
Write-Log "Datos migrados desde $oldRoot. La carpeta antigua se conserva como copia de seguridad."
