# klsyncbridge — AGENTS.md

Referencia rápida para agentes IA que continúen el desarrollo.

## Estado Actual del Proyecto (2026-06-02)

**Fases completadas:** 0 (Setup), 1 (Auth/Users), + backend de Fases 2-6.

**Qué falta:** Las páginas HTML de la UI (FASE 2-4, 7-8) + pruebas (FASE 10).

El backend está **completo y funcional**. Todas las rutas de API están implementadas.

## Para Continuar el Desarrollo

### Antes de arrancar

```bash
cd d:\ArdisApp\TOOLS\Importador_Local_Sincronizador_ArdisApp
npm install
node scripts/setup.js
npm start
```

### Rutas API disponibles

```
POST /api/auth/login
POST /api/auth/logout          [auth requerida]
GET  /api/auth/me              [auth requerida]

GET|POST /api/users            [auth requerida]
GET|PUT|DELETE /api/users/:id
POST /api/users/:id/reset-password

GET|POST /api/connections      [auth requerida]
GET|PUT|DELETE /api/connections/:id
POST /api/connections/:id/test
GET  /api/connections/:id/tables
GET  /api/connections/:id/fields?table=X

GET|POST /api/api-configs      [auth requerida]
GET|PUT|DELETE /api/api-configs/:id
POST /api/api-configs/:id/test

GET|POST /api/jobs             [auth requerida]
GET|PUT|DELETE /api/jobs/:id
POST /api/jobs/:id/activate
POST /api/jobs/:id/deactivate
POST /api/jobs/:id/run-now
GET  /api/jobs/:id/logs
GET|POST /api/jobs/:id/field-maps
GET  /api/jobs/scheduler/status

GET /api/logs
GET /api/logs/:id
DELETE /api/logs/cleanup?days=30
```

## Patrones de Código a Seguir

### Servicio (backend)
```javascript
'use strict';
const { getDb } = require('../../config/database');
const { NotFoundError } = require('../../utils/errors');

function getItem(id) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM table WHERE id = ?').get(id);
  if (!row) throw new NotFoundError('Item');
  return row;
}
```

### Ruta (backend)
```javascript
router.get('/:id', (req, res) => {
  try { return success(res, svc.getItem(req.params.id)); }
  catch (err) { return fromError(res, err); }
});
```

### Página HTML (frontend)
- Tailwind CDN 4.x vía `<script src="https://cdn.tailwindcss.com">`
- Fondo: `#0f1117` | Superficie: `#1a1d27` | Acento: `#3b82f6`
- Google Fonts: Inter + JetBrains Mono
- Incluir `<script src="/js/auth.js"></script>` + llamar `AUTH.requireAuth()` al inicio
- Usar `API.get('/ruta')`, `API.post(...)`, etc. (definido en auth.js)

## Próximas tareas prioritarias

1. `public/connections.html` + `public/js/connections.js`
2. `public/api-configs.html` + `public/js/api-configs.js`
3. `public/jobs.html` + `public/js/jobs.js` + `public/job-editor.html` + `public/js/job-editor.js`
4. `public/logs.html` + `public/js/logs.js`
5. `public/users.html` + `public/js/users.js`
6. `public/settings.html` + `public/js/settings.js`

Ver `TODO.md` para lista completa.

## Archivos Críticos

| Archivo | Propósito |
|---|---|
| `src/app.js` | Entry point, shutdown, scheduler init |
| `src/server.js` | Express config, rutas, middleware IP |
| `src/config/database.js` | SQLite, todas las tablas |
| `src/services/encryption.service.js` | AES-256-GCM, clave en `data/encryption.key` |
| `src/modules/jobs/jobs.executor.js` | Lógica de ejecución de jobs (CRÍTICO) |
| `src/modules/jobs/jobs.scheduler.js` | node-cron, gestión de tareas |
| `scripts/setup.js` | Setup inicial (primer uso) |
| `CLAUDE.md` | Reglas de código y arquitectura |

## Alertas

- La clave de cifrado `data/encryption.key` es ÚNICA por instalación. Si se pierde, los datos cifrados son irrecuperables.
- El usuario master (`is_master = 1`) NO puede eliminarse ni desactivarse (regla de negocio dura).
- Las queries a SQL Server SIEMPRE deben usar parámetros, nunca concatenación de strings.
- Los logs NUNCA deben contener contraseñas, tokens, ni auth_config sin enmascarar.
