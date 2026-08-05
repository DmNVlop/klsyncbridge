# Windows Service con Node.js — Guía Técnica

> Referencia para equipos que quieran replicar el patrón de servicio Windows usado en KLSyncBridge en otros proyectos Node.js.

---

## Índice

1. [Stack y dependencias](#1-stack-y-dependencias)
2. [Estructura de archivos](#2-estructura-de-archivos)
3. [Implementación del servicio](#3-implementación-del-servicio)
4. [Scripts de instalación y desinstalación](#4-scripts-de-instalación-y-desinstalación)
5. [Entry point del servidor (graceful shutdown)](#5-entry-point-del-servidor-graceful-shutdown)
6. [Installer PowerShell completo](#6-installer-powershell-completo)
7. [Prerequisitos de compilación nativa](#7-prerequisitos-de-compilación-nativa)
8. [Checklist de replicación](#8-checklist-de-replicación)
9. [Errores comunes](#9-errores-comunes)

---

## 1. Stack y Dependencias

| Paquete | Versión | Rol |
|---|---|---|
| `node-windows` | `^1.0.0-beta.8` | Registrar/desregistrar servicio Windows, shortcuts |
| Node.js | `>= 24 LTS x64` | Runtime (x64 obligatorio si hay módulos nativos) |
| Python | `3.11 x64` | Compilar módulos nativos (ej: `better-sqlite3`) |
| Visual C++ Build Tools | `2022` | Compilar módulos nativos |

> **Nota:** Python y Build Tools solo son necesarios si el proyecto usa módulos con bindings nativos (`.node`). Para proyectos pure-JS no son requeridos.

```bash
npm install node-windows --save
```

`node-windows` no requiere bindings nativos → no necesita compilación.

---

## 2. Estructura de Archivos

```
proyecto/
  src/
    app.js                    # Entry point del proceso
  scripts/
    install-service.js        # Registra el servicio Windows
    uninstall-service.js      # Elimina el servicio Windows
    setup.js                  # Configuración inicial (keys, BD, admin)
  instalar.ps1                # Installer completo (PowerShell)
  desinstalar.ps1             # Uninstaller (PowerShell)
  package.json
```

---

## 3. Implementación del Servicio

### `scripts/install-service.js`

```javascript
const { Service } = require('node-windows');
const path = require('path');

const svc = new Service({
  name: 'MiServicio',                          // Nombre en Services (services.msc)
  description: 'Descripción del servicio',
  script: path.join(__dirname, '..', 'src', 'app.js'),
  env: {
    name: 'NODE_ENV',
    value: 'production'
  }
});

svc.on('install', () => {
  console.log('✅ Servicio instalado');
  svc.start();

  // Política de reinicio automático ante fallos
  // 5s → 10s → 30s
  const { execSync } = require('child_process');
  execSync(
    'sc failure "MiServicio" reset= 86400 actions= restart/5000/restart/10000/restart/30000',
    { stdio: 'inherit' }
  );

  // Atajo de escritorio (opcional)
  crearAtajoEscritorio();
});

svc.on('error', (err) => {
  console.error('❌ Error:', err);
});

svc.install();
```

**Política de reinicio:** `sc failure` es un comando nativo de Windows. Configura reintentos automáticos ante crashes:
- 1er fallo → reinicio a los 5s
- 2do fallo → reinicio a los 10s
- 3er+ fallo → reinicio a los 30s
- `reset= 86400` → resetea el contador de fallos después de 24h sin crash

### Crear accesos directos (opcional)

```javascript
const { createShortcut } = require('node-windows');

// Escritorio
createShortcut({
  name: 'MiServicio',
  target: 'http://localhost:3847',
  description: 'Abrir panel de control',
  outputPath: path.join(process.env.USERPROFILE, 'Desktop')
});

// Menú Inicio
createShortcut({
  name: 'MiServicio',
  target: 'http://localhost:3847',
  outputPath: path.join(
    process.env.APPDATA,
    'Microsoft', 'Windows', 'Start Menu', 'Programs'
  )
});
```

### `scripts/uninstall-service.js`

```javascript
const { Service } = require('node-windows');
const path = require('path');

const svc = new Service({
  name: 'MiServicio',
  script: path.join(__dirname, '..', 'src', 'app.js')
});

svc.on('uninstall', () => {
  console.log('✅ Servicio desinstalado');
});

svc.on('error', (err) => {
  console.error('❌ Error:', err);
});

svc.uninstall();
```

---

## 4. Scripts de Instalación y Desinstalación

### `package.json` — scripts relevantes

```json
{
  "scripts": {
    "start": "node src/app.js",
    "dev": "node --watch src/app.js",
    "setup": "node scripts/setup.js",
    "install-service": "node scripts/install-service.js",
    "uninstall-service": "node scripts/uninstall-service.js"
  },
  "engines": {
    "node": ">= 24.0.0"
  }
}
```

### Flujo de instalación manual

```bash
# 1. Configuración inicial (genera key, crea DB, crea usuario admin)
node scripts/setup.js

# 2. Registrar como servicio Windows (requiere PowerShell como Admin)
node scripts/install-service.js

# 3. Verificar en services.msc que el servicio existe y está corriendo
```

### Flujo de desinstalación

```bash
# 1. Detener y eliminar servicio
node scripts/uninstall-service.js

# 2. Eliminar shortcuts manualmente si se crearon
```

> **Importante:** `node-windows` requiere `npm install` completo (no `--production`). Los helpers de instalación del paquete están en `node_modules/.bin`.

---

## 5. Entry Point del Servidor (Graceful Shutdown)

El proceso debe manejar señales de terminación para no cortar conexiones activas.

```javascript
// src/app.js
const server = app.listen(PORT, '127.0.0.1', async () => {
  logger.info(`Servidor en http://127.0.0.1:${PORT}`);
  await initScheduler();
});

// Graceful shutdown compartido
const shutdown = async (signal) => {
  logger.info(`Señal ${signal} recibida, cerrando...`);

  server.close(async () => {
    logger.info('Servidor HTTP cerrado');
    // Cerrar BD, limpiar recursos
    process.exit(0);
  });

  // Forzar cierre si tarda más de 10s
  setTimeout(() => {
    logger.error('Cierre forzado por timeout');
    process.exit(1);
  }, 10_000);
};

process.on('SIGTERM', () => shutdown('SIGTERM')); // Enviado por Windows al detener servicio
process.on('SIGINT', () => shutdown('SIGINT'));   // Ctrl+C en desarrollo

// Capturar errores no manejados (crítico en producción como servicio)
process.on('uncaughtException', (err) => {
  logger.error('uncaughtException:', err);
  shutdown('uncaughtException');
});

process.on('unhandledRejection', (reason) => {
  logger.error('unhandledRejection:', reason);
});
```

**Por qué `127.0.0.1` y no `0.0.0.0`:**  
Limitar a localhost impide acceso desde la red local. Si el servicio debe ser accesible en red, usar `0.0.0.0` y asegurar firewall.

---

## 6. Installer PowerShell Completo

El patrón de `instalar.ps1` cubre el ciclo completo de instalación desatendida. Puntos clave:

### Auto-elevación a Administrador

```powershell
# Al inicio del script
if (-NOT ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Start-Process powershell.exe "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`"" -Verb RunAs
    Exit
}
```

### Verificación de arquitectura

```powershell
# Obligatorio si el proyecto usa módulos nativos (better-sqlite3, etc.)
if ([System.Environment]::Is64BitOperatingSystem -eq $false) {
    Write-Error "❌ Solo compatible con Windows x64"
    Exit 1
}
```

### Instalación de Node.js (online + fallback offline)

```powershell
$nodeVersion = "24.3.0"
$nodeInstaller = "node-v$nodeVersion-x64.msi"
$nodeUrl = "https://nodejs.org/dist/v$nodeVersion/$nodeInstaller"
$prereqsPath = Join-Path $PSScriptRoot "prereqs"

# Verificar si ya está instalado
$nodeInstalled = Get-Command node -ErrorAction SilentlyContinue
if ($nodeInstalled) {
    $currentVersion = (node --version).TrimStart('v')
    # Comparar versiones y saltar si ya es suficiente
}

# Estrategia: primero buscar en prereqs/, luego descargar
$localInstaller = Join-Path $prereqsPath $nodeInstaller
if (Test-Path $localInstaller) {
    # Instalación offline
    Start-Process msiexec.exe -Wait -ArgumentList "/i `"$localInstaller`" /qn ADDLOCAL=ALL"
} else {
    # Descarga online
    Invoke-WebRequest -Uri $nodeUrl -OutFile $nodeInstaller
    Start-Process msiexec.exe -Wait -ArgumentList "/i `"$nodeInstaller`" /qn ADDLOCAL=ALL"
}
```

### Secuencia de setup en el installer

```powershell
# 1. npm install (con retry ante fallos de compilación)
$maxRetries = 3
for ($i = 1; $i -le $maxRetries; $i++) {
    npm install 2>&1
    if ($LASTEXITCODE -eq 0) { break }
    if ($i -lt $maxRetries) { Start-Sleep -Seconds 5 }
}

# 2. Setup inicial
node scripts/setup.js

# 3. Instalar servicio
node scripts/install-service.js

# 4. Abrir navegador
Start-Process "http://localhost:3847"
```

### Uninstaller (`desinstalar.ps1`) — patrón mínimo

```powershell
# Auto-elevación (mismo patrón que arriba)

$confirm = Read-Host "¿Desinstalar MiServicio? (S/N)"
if ($confirm -ne 'S') { Exit }

node scripts/uninstall-service.js

# Eliminar shortcuts
$desktopShortcut = Join-Path $env:USERPROFILE "Desktop\MiServicio.lnk"
if (Test-Path $desktopShortcut) { Remove-Item $desktopShortcut }

Write-Host "✅ Desinstalado. Los datos en /data/ y /logs/ se conservan."
```

---

## 7. Prerequisitos de Compilación Nativa

Solo aplica si el proyecto usa módulos con bindings nativos (`better-sqlite3`, `bcrypt`, `canvas`, etc.).

| Prerequisito | Por qué | Instalación silenciosa |
|---|---|---|
| Python 3.11 x64 | `node-gyp` lo usa para compilar | `python-3.11.x-amd64.exe /quiet InstallAllUsers=1` |
| Visual C++ Build Tools 2022 | Compilador C++ para módulos nativos | `vs_buildtools.exe --quiet --add Microsoft.VisualStudio.Workload.VCTools` |

**Orden obligatorio:**
1. Node.js
2. Python
3. Visual C++ Build Tools
4. `npm install`

Si se cambia el orden o falta alguno → `npm install` falla con errores de `node-gyp`.

### Verificar compilación exitosa

```bash
# Debe terminar sin errores y mostrar "gyp info ok"
npm install --verbose 2>&1 | grep -E "(gyp|error|ok)"
```

### Módulos pure-JS (sin compilación)

Si el proyecto no usa módulos nativos: Python y Build Tools no son necesarios. Solo Node.js es requerido.

---

## 8. Checklist de Replicación

### Para aplicar este patrón en otro proyecto:

- [ ] `npm install node-windows --save`
- [ ] Copiar `scripts/install-service.js`, cambiar:
  - `name:` → nombre del nuevo servicio
  - `description:` → descripción
  - `script:` → path al entry point
  - Puerto en shortcuts (si aplica)
- [ ] Copiar `scripts/uninstall-service.js`, cambiar `name:`
- [ ] Agregar `install-service` y `uninstall-service` a `package.json scripts`
- [ ] Implementar graceful shutdown en `src/app.js` (`SIGTERM` + `SIGINT`)
- [ ] Copiar `instalar.ps1`, adaptar:
  - Nombre del servicio
  - Puerto
  - Variables de `$serviceDisplayName`, `$serviceUrl`
  - Prerequisitos necesarios (quitar Python/BuildTools si no hay módulos nativos)
- [ ] Copiar `desinstalar.ps1`, adaptar nombre y shortcuts
- [ ] Verificar con `services.msc` que el servicio aparece con `Startup Type: Automatic`
- [ ] Probar: detener servicio → esperar → verificar que reinicia solo (política `sc failure`)

---

## 9. Errores Comunes

### `node-windows` no encuentra el script

```
Error: script not found
```

**Causa:** Path relativo en `install-service.js`.  
**Fix:** Usar `path.join(__dirname, '..', 'src', 'app.js')` con path absoluto.

### Servicio instala pero no arranca

**Causa 1:** `NODE_ENV` no definido → crash en `src/app.js`.  
**Fix:** Agregar `env: { name: 'NODE_ENV', value: 'production' }` en la config del servicio.

**Causa 2:** Puerto en uso.  
**Fix:** `netstat -ano | findstr :3847` para identificar proceso ocupando el puerto.

### `npm install` falla con errores `node-gyp`

**Causa:** Faltan Python o Visual C++ Build Tools.  
**Fix:** Instalar en orden: Python 3.11 → Build Tools → `npm install`.

### Acceso denegado al instalar servicio

**Causa:** PowerShell sin privilegios de administrador.  
**Fix:** El script debe auto-elevarse (ver sección 6) o ejecutarse con `Run as Administrator`.

### El servicio no reinicia tras crash

**Causa:** `sc failure` no se ejecutó.  
**Fix:** Ejecutar manualmente:
```cmd
sc failure "NombreServicio" reset= 86400 actions= restart/5000/restart/10000/restart/30000
```

### `node-windows` requiere `npm install` completo

**Causa:** Instalación con `--production` omite devDependencies y helpers de `node-windows`.  
**Fix:** Usar `npm install` sin flags en el installer.

---

## Referencias

- [node-windows en npm](https://www.npmjs.com/package/node-windows)
- [sc failure — Microsoft Docs](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/sc-failure)
- [node-gyp prerequisites](https://github.com/nodejs/node-gyp#on-windows)
- Implementación de referencia: `scripts/install-service.js`, `instalar.ps1` en este repo
