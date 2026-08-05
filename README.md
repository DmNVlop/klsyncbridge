# KLSyncBridge

Servicio Windows (Node.js) que sincroniza datos desde SQL Server hacia APIs REST en la nube, con una UI web local de administración. Corre como **Windows Service** con interfaz en `http://localhost:3847`.

> Este README es la puerta de entrada para un usuario avanzado (técnico instalador o desarrollador) que necesita levantar, instalar o mantener el proyecto. Para detalle profundo de cada tema, seguí los enlaces a `docs/` y `project-doc/`.

---

## ¿Qué hace?

```
SQL Server (vista) → Extracción → Mapeo de campos → Endpoint API cloud
                                                    → y/o Archivo CSV/JSON en disco
```

Cada **job** de sincronización se configura una vez desde la UI (conexión SQL, vista/tabla, mapeo de campos, checkpoint incremental o full, schedule) y corre solo, sin intervención diaria. El destino final de los datos ya mapeados puede ser:

- **Endpoint** — POST a una API cloud configurada (comportamiento histórico).
- **Archivo** — CSV y/o JSON en una carpeta del servidor (para carga manual, terceros, o auditoría).
- **Ambos** — las dos cosas, con una sola extracción y el mismo dato mapeado.

---

## Stack técnico

| Componente | Tecnología |
|---|---|
| Runtime | Node.js 24 LTS |
| Web / API | Express 5.x |
| UI | Tailwind (CDN) + Vanilla JS, sin build |
| Base de datos interna | SQLite (`better-sqlite3`) |
| Origen de datos | SQL Server (`mssql`), también CSV/Excel |
| Scheduler | `node-cron` |
| Cliente HTTP | `axios` (con reintentos y categorización de errores) |
| Servicio Windows | `node-windows` |
| Cifrado | AES-256-GCM (`crypto` nativo) — passwords y config sensible en SQLite |
| Auth UI | JWT (`jsonwebtoken`), solo accesible desde `localhost` |
| Logging | `winston` + rotación diaria de archivos |
| Validación | `zod` |

Ver detalle de arquitectura completo en [`project-doc/SYNCBRIDGE_PROJECT_DOCUMENT.md`](project-doc/SYNCBRIDGE_PROJECT_DOCUMENT.md) y guía rápida para agentes IA en [`CLAUDE.md`](CLAUDE.md) / [`AGENTS.md`](AGENTS.md).

---

## Puesta en marcha rápida (desarrollo)

```bash
npm install
node scripts/setup.js     # obligatorio la primera vez: genera clave de cifrado, DB, usuario admin
npm start                  # o: npm run dev (con --watch)
```

Abrir `http://localhost:3847` y loguearse con el usuario creado en `setup.js`.

Si olvidaste la contraseña del admin:

```bash
node scripts/reset-admin.js
```

### Comandos disponibles

```bash
npm start                    # arrancar el servidor
npm run dev                  # desarrollo con --watch
npm run setup                # setup inicial (clave + DB + admin)
npm run install-service      # instalar como Windows Service
npm run uninstall-service    # desinstalar el Windows Service
npm run release               # incrementar versión (package.json + version.json) + tag git
```

---

## Instalación en un cliente (producción)

La instalación completa en una máquina Windows nueva (sin Node, sin Build Tools) está automatizada:

```bat
instalar.bat
```

`instalar.ps1` valida requisitos y, si faltan, los instala **sin intervención** usando primero los instaladores locales de `prereqs/` (evita depender de internet) y, si no están, descargándolos. Detalle completo, qué se instala y por qué, en [`docs/INSTALL.md`](docs/INSTALL.md).

### Sobre `prereqs/` y Visual C++ Build Tools

`better-sqlite3` (la base de datos interna) incluye código nativo en C++ que se compila durante el `npm install`. Eso requiere **Python 3.11** (para `node-gyp`) y **Visual C++ Build Tools** (`cl.exe` + SDK de Windows). El instalador busca estos componentes ya instalados en el sistema y, si no los encuentra, cae a los instaladores locales de `prereqs/` antes de intentar descargar de internet.

Para Visual C++ Build Tools específicamente, `instalar.ps1` busca en este orden:

1. `prereqs\vs_layout\vs_buildtools.exe` — **layout offline completo** (~2-3 GB, no requiere internet en el momento de instalar).
2. `prereqs\vs_buildtools.exe` — bootstrapper local (~4 MB; al ejecutarlo igual descarga ~2-3 GB de componentes, requiere internet).
3. Descarga directa del bootstrapper desde `https://aka.ms/vs/17/release/vs_buildtools.exe` (requiere internet y confirmación interactiva).

**Si ya tenés el instalador descargado** (`prereqs\vs_BuildTools.exe`), no hace falta nada más: Windows no distingue mayúsculas/minúsculas en nombres de archivo, así que calza directo con la ruta que busca el script. Si además tenés el layout offline completo comprimido (`prereqs\vs_layout.7z`), descomprimilo a `prereqs\vs_layout\` para una instalación 100% sin internet:

```powershell
prereqs\7z2601-x64.exe x prereqs\vs_layout.7z -oprereqs\vs_layout
```

**Para instalarlo manualmente** (sin pasar por `instalar.ps1`), como Administrador:

```powershell
prereqs\vs_BuildTools.exe --wait --quiet --add Microsoft.VisualStudio.Workload.VCTools --add Microsoft.VisualStudio.Component.Windows10SDK.19041 --includeRecommended
```

Con Build Tools ya instalado en el sistema, `instalar.ps1` lo detecta automáticamente vía `vswhere.exe` y salta ese paso. Ver [`prereqs/LEEME.txt`](prereqs/LEEME.txt) y [`docs/INSTALL.md`](docs/INSTALL.md) para el resto de los prerequisitos (Node.js, Python) con la misma lógica de "local primero, descarga después".

### Desinstalar

```bat
desinstalar.bat
```

---

## Documentación

| Documento | Para quién | Contenido |
|---|---|---|
| [`docs/INSTALL.md`](docs/INSTALL.md) | Técnico instalador | Qué instala `instalar.bat` paso a paso, de dónde, y por qué |
| [`docs/USER_GUIDE.md`](docs/USER_GUIDE.md) | Instalador + operador | Guía completa: puesta en marcha + uso diario |
| [`docs/manuales/MANUAL_USUARIO.md`](docs/manuales/MANUAL_USUARIO.md) | Operador final | Manual paso a paso de la UI (conexiones, APIs, jobs) |
| [`docs/RELEASE.md`](docs/RELEASE.md) | Desarrollador | Mecanismo de auto-update y flujo de `npm run release` |
| [`docs/dev/WINDOWS_SERVICE_GUIDE.md`](docs/dev/WINDOWS_SERVICE_GUIDE.md) | Desarrollador | Instalar/depurar el Windows Service |
| [`project-doc/SYNCBRIDGE_PROJECT_DOCUMENT.md`](project-doc/SYNCBRIDGE_PROJECT_DOCUMENT.md) | Desarrollador | Documento maestro de arquitectura, módulos, fases |
| [`CLAUDE.md`](CLAUDE.md) / [`AGENTS.md`](AGENTS.md) | Agente IA | Reglas de código, estructura, convenciones del proyecto |

---

## Estructura del proyecto

```
src/
  app.js / server.js       # Entry point + Express
  config/                  # env, constantes, SQLite (init + migraciones)
  modules/
    auth/ users/           # Login, JWT, CRUD usuarios
    connections/            # Conexiones a fuentes de datos (SQL Server, CSV, Excel)
    api-configs/            # Configuración de APIs destino
    jobs/                   # Jobs + executor + scheduler — el corazón del sistema
    logs/                   # Logs de ejecución
  services/
    encryption.service.js       # AES-256-GCM
    logger.service.js           # Winston
    http.service.js             # axios + reintentos categorizados por tipo de error
    file-export.service.js      # exportación streaming a CSV/JSON
    sources/                    # adaptadores por tipo de fuente (sqlserver, csv, excel)
  utils/                    # errores, respuestas HTTP, validadores zod
public/                     # UI (HTML + JS, sin build)
scripts/                    # setup, reset-admin, install/uninstall-service, release
data/                       # klsyncbridge.db + encryption.key (runtime, no versionado)
logs/                       # app.log + executions.log (runtime, no versionado)
prereqs/                    # instaladores offline para instalación sin internet
```

## Puntos a tener en cuenta al desarrollar

- **Sin `console.log`** — usar `logger` de `src/services/logger.service.js`.
- **Sin SQL concatenado** — siempre parámetros de `mssql`/`better-sqlite3` (prevención de inyección).
- **Migraciones aditivas** — el esquema de SQLite se versiona en `src/config/database.js` (array `migrations`, patrón `addColIfNotExists`). Nunca modificar una migración ya aplicada; siempre agregar una nueva al final.
- **Todo endpoint protegido** por `requireAuth` excepto `POST /api/auth/login`.
- **Respuestas HTTP** siempre vía `src/utils/response.js` (`success`, `list`, `created`, `fromError`) — formato uniforme `{ ok, data }` / `{ ok: false, error, code }`.
- **Cifrado**: `connections.password` y `api_configs.auth_config` van cifrados en SQLite; usar `encrypt()`/`decrypt()` o `encryptObject()`/`decryptObject()` de `encryption.service.js`, nunca guardar texto plano.
- **Producción activa**: los flujos existentes (sincronización endpoint-only, checkpoints incremental/snapshot) deben seguir funcionando siempre. Cambios en `jobs.executor.js` deben ser aditivos.
