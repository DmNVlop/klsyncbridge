# KLSyncBridge — Guía de Instalación

Dirigida al técnico instalador. Tiempo estimado: 15-30 minutos.

---

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

## Instalación rápida (método recomendado)

La forma más simple de instalar en un servidor cliente es usando el script incluido:

1. Copiar la carpeta del proyecto al servidor (ej: `C:\KLSyncBridge\`)
2. Clic derecho en `instalar.bat` → **Ejecutar como administrador**
3. El script hace todo automáticamente:
   - Verifica e instala **Node.js 24 LTS** si no está presente.
   - Verifica e instala Python 3.11 si no está presente.
   - Verifica e instala Visual C++ Build Tools 2022 si no están presentes.
   - Instala dependencias npm (compila `better-sqlite3`).
   - Genera clave de cifrado, base de datos y usuario admin.
   - Registra e inicia el servicio Windows.
   - Crea acceso directo en el Escritorio y el Menú Inicio.
4. Al terminar, anota las credenciales que aparecen en pantalla y abre el navegador automáticamente.

> **IMPORTANTE:** Anotar el usuario y contraseña que muestra el script. No se pueden recuperar después.

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
- Crea el usuario administrador inicial

**Guardar las credenciales que muestra en pantalla.** No se pueden recuperar después.

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

Iniciar sesión con las credenciales del Paso 3.

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
