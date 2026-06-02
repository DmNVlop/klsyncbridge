# KLSyncBridge — CLAUDE.md

Documento de referencia para agentes IA (Claude Code y similares).

## Descripción del Proyecto

**KLSyncBridge** es un servicio Windows (Node.js) que sincroniza datos de SQL Server → APIs REST externas. Corre como Windows Service con interfaz web local en `http://localhost:3847`.

## Stack

| Componente | Tecnología |
|---|---|
| Runtime | Node.js 24 LTS |
| Web | Express 5.x |
| UI | Tailwind 4.x CDN + Vanilla JS |
| DB interna | SQLite (`better-sqlite3`) |
| SQL Server | `mssql` |
| Scheduler | `node-cron` |
| HTTP Client | `axios` |
| Windows Service | `node-windows` |
| Cifrado | AES-256-GCM (`crypto` built-in) |
| Auth tokens | `jsonwebtoken` |
| Logging | `winston` + `winston-daily-rotate-file` |
| Validación | `zod` |

## Estructura

```
src/
  app.js              # Entry point
  server.js           # Express + rutas
  config/
    env.js            # Variables de entorno (zod)
    constants.js      # Constantes globales
    database.js       # SQLite init + migraciones
  modules/
    auth/             # Login, JWT, middleware
    users/            # CRUD usuarios
    connections/      # Conexiones SQL Server
    api-configs/      # Configuración APIs destino
    jobs/             # Jobs + executor + scheduler
    logs/             # Logs de ejecución
  services/
    encryption.service.js   # AES-256-GCM
    logger.service.js       # Winston
    sqlserver.service.js    # mssql
    http.service.js         # axios + reintentos
    auth-resolver.service.js # Tipos de auth
  utils/
    errors.js         # Clases de error
    response.js       # Helpers HTTP response
    validators.js     # Schemas zod
public/               # UI HTML + JS (sin build)
scripts/
  setup.js            # Genera key + crea admin
  install-service.js  # Windows Service
  uninstall-service.js
data/                 # klsyncbridge.db + encryption.key (runtime)
logs/                 # app.log + executions.log (runtime)
```

## Comandos

```bash
node scripts/setup.js        # Setup inicial (OBLIGATORIO primer uso)
npm start                    # Arrancar servidor
npm run dev                  # Desarrollo con --watch
node scripts/install-service.js    # Instalar como Windows Service
node scripts/uninstall-service.js  # Desinstalar servicio
```

## Reglas de Código OBLIGATORIAS

1. **Sin `console.log`** → usar `logger` de `src/services/logger.service.js`
2. **Sin contraseñas en texto plano** → cifrar con `encryption.service.js` antes de SQLite
3. **Sin SQL concatenado** → siempre parámetros de `mssql` (prevención SQLi)
4. **Todo endpoint protegido** por `requireAuth` excepto `POST /api/auth/login`
5. **Manejo explícito de errores** en cada función async (nunca `catch` vacío)
6. **Respuestas HTTP** siempre via `src/utils/response.js` (`success`, `list`, `created`, `fromError`)

## Formato de Respuestas API

```json
// Éxito
{ "ok": true, "data": { ... } }

// Lista paginada
{ "ok": true, "data": [...], "total": N, "page": N, "per_page": N }

// Error
{ "ok": false, "error": "Mensaje en español", "code": "ERROR_CODE" }
```

## Cifrado

- Clave: `data/encryption.key` (hex 32 bytes)
- Campos cifrados: `connections.password`, `api_configs.auth_config`
- Usar `encrypt()`/`decrypt()` para strings, `encryptObject()`/`decryptObject()` para objetos JSON

## Autenticación UI

- JWT en `localStorage` clave `sb_token`
- Header: `Authorization: Bearer <token>`
- Expiry: 8 horas
- Solo localhost (middleware IP check en `server.js`)

## Base de Datos

- Archivo: `data/klsyncbridge.db`
- Acceso: `getDb()` desde `src/config/database.js`
- Sin ORM → SQL directo con `better-sqlite3`
- Foreign keys habilitadas → `PRAGMA foreign_keys = ON`

## Fases de Desarrollo

Ver `docs/project/SYNCBRIDGE_PROJECT_DOCUMENT.md` Sección 13.

Estado actual: **FASE 0 y FASE 1 completadas** (infraestructura + auth + usuarios + módulos base).

Pendiente: FASE 2 (UI Connections), FASE 3 (API Configs UI), FASE 4 (Jobs UI wizard), FASE 5-6 (Executor + Scheduler), FASE 7 (Dashboard/Logs UI), FASE 8 (Users/Settings UI), FASE 9 (Windows Service).

## Inconsistencias / Decisiones

- `server.js` enruta `/login` y demás rutas UI → `index.html` (SPA-like, cada página es HTML separado)
- `public/index.html` solo hace redirect según auth
- Los logs de ejecución se guardan TANTO en `execution_logs` (SQLite) COMO en archivo `executions.log`
- `node-windows` usa `node_modules/.bin` → requiere `npm install` completo (no `--production`) para instalar el servicio
