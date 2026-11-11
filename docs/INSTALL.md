# KLSyncBridge — Guía de Instalación

Dirigida al técnico instalador. Tiempo estimado: 15-30 minutos.

---

## Instalación con el instalador (recomendada)

Un único `KLSyncBridge-Setup-X.Y.Z.exe` instala todo: lleva su propio Node.js y las dependencias ya compiladas. **No hace falta instalar Node.js, Python ni Visual C++ Build Tools.** Tiempo estimado: 2-3 minutos.

1. Descargar `KLSyncBridge-Setup-X.Y.Z.exe`:
   - desde la plataforma ArdisApp: **Configuración › Instalaciones › KLSyncBridge**, o
   - desde GitHub: https://github.com/DmNVlop/klsyncbridge/releases/latest
2. Clic derecho en el `.exe` › **Ejecutar como administrador**.
   - Si Windows SmartScreen avisa de «aplicación no reconocida»: **Más información** › **Ejecutar de todas formas**.
3. Al terminar se abre `http://localhost:3847` con la pantalla **Primer acceso**: elegir la contraseña del usuario `admin` (mínimo 8 caracteres) y entrar. Esta pantalla solo aparece desde el propio equipo y solo mientras no exista el administrador.

Dónde queda cada cosa:

| Qué | Dónde |
|---|---|
| Programa (incluye `node.exe`) | `C:\Program Files\KLSyncBridge\` |
| Configuración (`.env`), base de datos, clave de cifrado | `C:\ProgramData\KLSyncBridge\` (`.env`, `data\`) |
| Logs (incluido el de cada actualización, `setup-X.Y.Z.log`) | `C:\ProgramData\KLSyncBridge\logs\` |
| Servicio Windows | `KLSyncBridge` (arranque automático) |

**Actualizar:** KLSyncBridge comprueba solo si hay versión nueva (al minuto de arrancar y cada 6 horas) y, si la hay, muestra un aviso en todas las pantallas. Para instalarla: **Sistema › Actualizar ahora** (o **Buscar actualización** para comprobarlo en el momento). Descarga el instalador nuevo, comprueba que no está alterado (sha256) y lo ejecuta en segundo plano; el servicio se reinicia solo en uno o dos minutos, la página espera a que vuelva con la versión nueva y los datos se conservan. Si en 5 minutos no ha vuelto, la página lo avisa: revisar `C:\ProgramData\KLSyncBridge\logs` (`setup-*.log` e `installer-setup.log`). También se puede ejecutar a mano el Setup de la versión nueva.

El instalador no termina hasta comprobar que el servicio responde (`http://localhost:3847/api/health`); si no responde en 60 segundos, muestra un error con la ruta de `installer-setup.log`.

### Si el instalador falla

Mensaje «Los ficheros se han copiado, pero no se pudo configurar el servicio» o «No se pudo preparar la instalación». Los datos (`C:\ProgramData\KLSyncBridge`) no se pierden en ningún caso.

1. Abrir `C:\ProgramData\KLSyncBridge\logs\installer-setup.log` y leer las últimas líneas (las que empiezan por ❌ explican la causa).
2. En un **PowerShell como administrador**, ver el estado del servicio:
   ```powershell
   sc.exe query klsyncbridge.exe
   ```
   - `ERROR 1060` (no existe): el servicio no llegó a crearse. Seguir con el paso 3.
   - `RUNNING`: el servicio funciona; abrir `http://localhost:3847/api/health`. Si responde, la instalación es correcta (solo tardó más de 60 s en arrancar).
   - Cualquier otro estado, o «marcado para eliminación»: cerrar `services.msc` (y el Administrador de tareas si está abierto), **reiniciar el equipo** y seguir con el paso 3.
3. Volver a ejecutar el mismo `KLSyncBridge-Setup-X.Y.Z.exe` como administrador. Repara solo la instalación: limpia los restos del servicio anterior y lo vuelve a crear.
4. Si vuelve a fallar, configurar el servicio a mano con el Node.js incluido (PowerShell como administrador):
   ```powershell
   cd "C:\Program Files\KLSyncBridge"
   .\node.exe scripts\installer-setup.js "C:\ProgramData\KLSyncBridge"
   ```
   Hace lo mismo que el final del instalador y escribe en pantalla cada paso; termina con «✅ Servicio en marcha y respondiendo». Si no, enviar a soporte su salida y `installer-setup.log`.

**Desde una instalación antigua (carpeta con `instalar.bat`, v2.2.0 o anterior):** ejecutar el Setup sin desinstalar nada. Detecta el servicio antiguo, lo para, lo sustituye y copia `data\` y `.env` a `ProgramData` (solo si allí aún no hay datos). Se entra con el usuario y la contraseña de siempre. La carpeta antigua queda intacta como copia de seguridad: se puede borrar cuando se compruebe que todo funciona.

### Pasar de una instalación antigua al instalador

Para las instalaciones antiguas (servicio desde su propia carpeta, con el Node del sistema) que ya están en la 2.3.0 o posterior, **Sistema › Pasar al instalador** hace el cambio sin tocar el Setup a mano.

**Requisitos** (si falta alguno, el botón sale deshabilitado y explica el motivo):
- KLSyncBridge corre como servicio desde su carpeta actual (`src\daemon\klsyncbridge.exe` y `klsyncbridge.xml` presentes).
- El proceso tiene privilegios de administrador.
- No hay otra actualización en curso y hay un Release publicado igual o más reciente que la versión instalada.

**Qué hace:** descarga el Setup del último Release, comprueba su sha256 y lo lanza en silencio. El Setup anota un marcador (`C:\ProgramData\KLSyncBridge\legacy-migration.json`), para el servicio antiguo, copia `data\` y `.env` a `C:\ProgramData\KLSyncBridge` e instala el servicio nuevo. La carpeta antigua no se toca: queda como copia de seguridad. La página espera hasta 5 minutos a que el servicio vuelva ya en modo instalador.

**Rollback automático:** si algo falla tras parar el servicio antiguo, el Setup ejecuta `rollback-legacy.ps1`: elimina el servicio nuevo, aparta los datos copiados (`data.failed-<fecha>`, `.env.failed-<fecha>`, para poder reintentar), reinstala el servicio antiguo con su `klsyncbridge.xml`, lo arranca y comprueba `/api/health`. Si todo va bien borra el marcador; si no, lo conserva.

**Logs** (`C:\ProgramData\KLSyncBridge\logs`): `setup-migration-<versión>.log` (Setup), `installer-setup.log` (post-instalación) y `legacy-rollback.log` (rollback).

**Lanzar el rollback a mano** (PowerShell como administrador; solo hace algo si existe el marcador):
```powershell
powershell -ExecutionPolicy Bypass -File C:\ProgramData\KLSyncBridge\installer\rollback-legacy.ps1 -AppDir "C:\Program Files\KLSyncBridge" -DataRoot C:\ProgramData\KLSyncBridge
```

**Desinstalar:** Configuración de Windows › **Aplicaciones** › KLSyncBridge › Desinstalar. Pregunta si borrar también los datos (`ProgramData\KLSyncBridge`); por defecto se conservan, y una instalación posterior los reutiliza.

---

> Lo que sigue describe la **instalación con script o manual (avanzada)**: solo para instalaciones antiguas o si no se puede usar el instalador.

## Requisitos previos

| Requisito | Versión mínima | Notas |
| Windows | 10 / Server 2016 | 64 bits |
| Node.js | 24 LTS (x64) | Se instala automáticamente si no está presente (usando `prereqs/` o descargando) |
| SQL Server | 2012+ | El cliente necesita acceso de lectura |
| Permisos | Administrador local | Para instalar el servicio Windows |
| Conexión a Internet | — | Opcional. Si no hay internet, se realiza instalación 100% offline usando los instaladores de `prereqs/` |

---

## Qué instala el script automáticamente

`instalar.bat` verifica el sistema y, si detecta que faltan componentes, los descarga e instala sin intervención del usuario. A continuación se detalla **qué se instala, por qué y de dónde**.

### 1. Node.js 24 LTS *(si no está instalado)*

| | |
|---|---|
| **Por qué** | KLSyncBridge es una aplicación construida sobre Node.js y requiere el motor V8 para ejecutar su lógica de backend y el servidor Express. |
| **Qué se instala** | Node.js 24 LTS x64. |
| **Fuente** | `prereqs/node-v24.16.0-x64.msi` (local) o descarga directa oficial de `nodejs.org` |
| **Dónde queda** | `C:\Program Files\nodejs\` (instalación estándar del sistema) |

### 2. Python 3.11 *(si no está instalado)*

| | |
|---|---|
| **Por qué** | La biblioteca `better-sqlite3` (base de datos interna) incluye código nativo en C++ que debe compilarse durante la instalación de npm. El compilador (`node-gyp`) requiere Python para ejecutarse. |
| **Qué se instala** | Python 3.11 — intérprete oficial, sin modificaciones. |
| **Fuente** | `prereqs/python-3.11.9-amd64.exe` (local) o `python.org` (descarga directa) |
| **Dónde queda** | `C:\Program Files\Python311\` o `C:\Python311\` (instalación estándar) |
| **Queda en el sistema** | Sí. Python 3.11 queda instalado como cualquier otra aplicación. No se usa en tiempo de ejecución de KLSyncBridge — solo fue necesario para compilar los módulos. |

### 3. Visual C++ Build Tools 2022 *(si no están instalados)*

| | |
|---|---|
| **Por qué** | El mismo proceso de compilación de `better-sqlite3` requiere el compilador de C++ de Microsoft (`cl.exe`) y las cabeceras del SDK de Windows. |
| **Qué se instala** | Visual Studio Build Tools 2022 con el workload `VCTools` y el SDK de Windows 11 (22621). Son las herramientas de compilación de Microsoft, sin el IDE. |
| **Fuente** | Carpeta `prereqs/vs_layout/` (modo offline recomendado), bootstrapper local `prereqs/vs_buildtools.exe` o descarga oficial de Microsoft. |
| **Dónde queda** | `C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\` |
| **Tamaño aproximado** | 3-6 GB en disco (compilador + SDK). |
| **Tiempo de instalación** | 5-15 minutos dependiendo de la velocidad de descarga. |
| **Queda en el sistema** | Sí. Se desinstala desde *Panel de control → Programas → Visual Studio Installer* si ya no se necesita. |

### 4. Dependencias Node.js (`npm install`)

| | |
|---|---|
| **Por qué** | KLSyncBridge usa librerías de terceros que deben descargarse del registro público de npm. |
| **Qué se descarga** | Las librerías listadas en `package.json` (Express, better-sqlite3, mssql, winston, etc.) |
| **Fuente** | `registry.npmjs.org` (registro público estándar de Node.js) o carpetas locales de caché si corresponde. |
| **Dónde queda** | `node_modules\` dentro de la carpeta de instalación de KLSyncBridge. No modifica el sistema. |
| **Compilación nativa** | Solo `better-sqlite3` se compila. El resto son JavaScript puro. |

### 5. KLSyncBridge en sí

| | |
|---|---|
| **Base de datos interna** | `data\klsyncbridge.db` — archivo SQLite, creado localmente. Almacena la configuración de conexiones, jobs y logs de ejecución. No es SQL Server. |
| **Clave de cifrado** | `data\encryption.key` — generada aleatoriamente en el equipo. Cifra las contraseñas de conexión almacenadas. **No debe salir del servidor.** |
| **Servicio Windows** | Nombre: `KLSyncBridge`. Se registra en el Administrador de servicios. Inicia automáticamente con Windows. |
| **Accesos directos** | Uno en el Escritorio y uno en el Menú Inicio, apuntando a `http://localhost:3847`. |
| **Logs** | `logs\app-YYYY-MM-DD.log` y `logs\executions-YYYY-MM-DD.log`. Rotación diaria, retención 30 días. |
| **Puerto de red** | TCP `3847` solo en `localhost`. No abre puertos al exterior. |

> **Resumen para el área de sistemas:** La instalación instala Node.js 24 LTS, Python 3.11 y Visual C++ Build Tools 2022 de instaladores oficiales (offline en `prereqs/` o descargados de Microsoft/NodeJS/Python). Python y Build Tools son necesarios solo durante la instalación para compilar el módulo de base de datos. KLSyncBridge en sí corre completamente en Node.js, no requiere Python ni el compilador en tiempo de ejecución.

---

## Instalación con script (`instalar.bat`)

La forma más simple de instalar en un servidor cliente es usando el script incluido:

1. Copiar la carpeta del proyecto al servidor (ej: `C:\KLSyncBridge\`)
2. Clic derecho en `instalar.bat` → **Ejecutar como administrador**
3. El script hace todo automáticamente:
   - Verifica e instala **Node.js 24 LTS** si no está presente.
   - Verifica e instala Python 3.11 si no está presente.
   - Verifica e instala Visual C++ Build Tools 2022 si no están presentes.
   - Instala dependencias npm (compila `better-sqlite3`).
   - Genera clave de cifrado y base de datos.
   - Registra e inicia el servicio Windows.
   - Crea acceso directo en el Escritorio y el Menú Inicio.
4. Al terminar abre el navegador en la pantalla **Primer acceso**: elegir ahí la contraseña del usuario `admin` (mínimo 8 caracteres).

> **Nota sobre tiempos:** Si Python y/o Visual C++ Build Tools deben instalarse, el proceso puede tardar entre 10 y 25 minutos por las descargas. Es normal que el script parezca bloqueado durante ese tiempo.

> **Si npm install falla después de instalar Build Tools:** En algunos servidores Windows es necesario **reiniciar** para que el compilador quede disponible en el PATH. Reiniciar y volver a ejecutar `instalar.bat`.

Para desinstalar: clic derecho en `desinstalar.bat` → **Ejecutar como administrador**.

---

## Instalación manual (paso a paso)

Usar este método si se necesita control granular o si el script automático falla.

### Paso 1 — Copiar los archivos

Copiar la carpeta del proyecto al servidor destino. Ubicación recomendada:

```
C:\KLSyncBridge\
```

### Paso 2 — Instalar dependencias Node.js

Abrir una terminal (cmd o PowerShell) **como Administrador** dentro de la carpeta:

```bat
cd C:\KLSyncBridge
npm install
```

### Paso 3 — Configuración inicial

```bat
node scripts/setup.js
```

Este comando:
- Genera la clave de cifrado en `data/encryption.key`
- Crea la base de datos SQLite en `data/klsyncbridge.db`

El usuario administrador (`admin`) no se crea aquí: su contraseña se elige en la pantalla **Primer acceso** al abrir la interfaz por primera vez desde el propio equipo.

### Paso 4 — (Opcional) Configurar puerto

Por defecto la interfaz web corre en el puerto `3847`. Para cambiarlo, crear el archivo `.env` en la raíz:

```
PORT=3847
```

Solo modificar si el puerto está ocupado por otra aplicación.

### Paso 5 — Instalar como servicio Windows

```bat
node scripts/install-service.js
```

Esto:
- Registra KLSyncBridge en el Administrador de servicios de Windows
- Configura reinicio automático ante fallos (5s, 10s, 30s)
- Inicia el servicio inmediatamente
- Crea acceso directo en el Escritorio y el Menú Inicio

Verificar en `services.msc` que el servicio **KLSyncBridge** aparece con estado **En ejecución**.

### Paso 6 — Verificar la instalación

Abrir el navegador en el servidor (o usar el acceso directo del Escritorio):

```
http://localhost:3847
```

La primera vez aparece **Primer acceso**: elegir la contraseña de `admin` y entrar.

---

## Modos de ejecución

KLSyncBridge puede correr de dos formas. **Nunca las dos al mismo tiempo** — comparten el mismo puerto.

| Modo | Comando | Cuándo usarlo |
|---|---|---|
| **Servicio Windows** | `instalar.bat` o `install-service.js` | Servidor del cliente (producción) |
| **Proceso manual** | `node src/app.js` o `npm run dev` | Desarrollo y pruebas del técnico |

Cuando el servicio está instalado, es el que sirve la interfaz web. No hace falta correr nada más — arranca solo con Windows y el usuario accede por el acceso directo del Escritorio.

---

## Archivos importantes

| Archivo | Propósito |
|---|---|
| `instalar.bat` | Instalación completa con un doble clic (como Administrador) |
| `desinstalar.bat` | Desinstalación del servicio (como Administrador) |
| `data/klsyncbridge.db` | Base de datos (NO borrar) |
| `data/encryption.key` | Clave de cifrado (NO borrar, NO compartir) |
| `logs/app-YYYY-MM-DD.log` | Log de aplicación |
| `logs/executions-YYYY-MM-DD.log` | Log de ejecuciones de tareas |
| `.env` | Configuración de entorno (opcional) |

---

## Desinstalar el servicio

Método rápido:

```
Clic derecho en desinstalar.bat → Ejecutar como administrador
```

Método manual:

```bat
node scripts/uninstall-service.js
```

Los datos en `data/` y `logs/` se conservan. Eliminar la carpeta completa si se desea borrado total.

---

## Solución de problemas

### Error al compilar `better-sqlite3` durante npm install

Síntoma: `npm error gyp ERR! find Python` o `npm error code 1` en `better-sqlite3`.

Causa: falta Python o Visual C++ Build Tools en el sistema.

Solución:
1. Si el script `instalar.bat` no los instaló automáticamente (sin `winget` ni `choco`), instalar manualmente:
   - **Python:** [python.org/downloads](https://www.python.org/downloads/) — marcar **"Add Python to PATH"** durante la instalación.
   - **Build Tools:** [visualstudio.microsoft.com/visual-cpp-build-tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) — seleccionar workload **"Desarrollo de escritorio con C++"**.
2. **Reiniciar el servidor** tras instalar estos componentes.
3. Volver a ejecutar `instalar.bat` como Administrador.

Verificación rápida en cmd:
```bat
python --version
cl
```
Si ambos responden sin error, `npm install` funcionará.

### El servicio no arranca

1. Revisar `logs/app-*.log` para ver el error.
2. Verificar que no hay otro proceso usando el puerto: `netstat -ano | findstr :3847`
3. Verificar que `node scripts/setup.js` se ejecutó correctamente (debe existir `data/klsyncbridge.db`).
4. Asegurarse de que no hay una instancia manual corriendo (`node src/app.js`) al mismo tiempo que el servicio.

### No aparece en el navegador

- Usar el acceso directo del Escritorio o abrir `http://localhost:3847` manualmente.
- Confirmar que el servicio está en estado **En ejecución** en `services.msc`.
- La interfaz solo es accesible desde `localhost` del servidor donde está instalado.

### Error de conexión a SQL Server

- Verificar que el usuario SQL tiene permisos de lectura (`SELECT`) en las tablas a sincronizar.
- Para instancias nombradas usar `SERVIDOR\INSTANCIA` como host.
- Si la conexión falla con certificado, activar la opción "Confiar en certificado del servidor" al crear la conexión.

### Reinstalar el servicio tras actualización

Solo para instalaciones antiguas con script o manuales. Con el instalador, ver [Si el instalador falla](#si-el-instalador-falla).

```bat
node scripts/uninstall-service.js
npm install
node scripts/install-service.js
```

O simplemente usar el botón **Reinstalar servicio** en la interfaz web (menú Sistema).

---

## Variables de entorno disponibles

| Variable | Defecto | Descripción |
|---|---|---|
| `PORT` | `3847` | Puerto de la interfaz web |
| `NODE_ENV` | `production` | Entorno de ejecución |
| `DATA_DIR` | `./data` | Directorio de datos |
| `LOG_DIR` | `./logs` | Directorio de logs |
| `LOG_LEVEL` | `info` | Nivel de log (`error`, `warn`, `info`, `debug`) |
| `LOG_RETENTION_DAYS` | `30` | Días que se conservan los logs |
