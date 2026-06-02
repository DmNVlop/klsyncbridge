# KLSyncBridge — TODO

Actualizado: 2026-06-02

## Completado

- [x] **FASE 0** — Setup del proyecto
- [x] **FASE 1** — Autenticación y Usuarios
- [x] **FASE 2** — Conexiones SQL Server (backend + UI)
- [x] **FASE 3** — API Configs (backend + UI)
- [x] **FASE 4** — Jobs CRUD + Wizard 4 pasos (backend + UI)
- [x] **FASE 5** — Executor de Jobs
- [x] **FASE 6** — Scheduler (node-cron)
- [x] **FASE 7** — Dashboard + Logs UI
- [x] **FASE 8** — Usuarios + Settings UI
- [x] **FASE 9** — Scripts Windows Service (código listo, pendiente prueba en Windows real)
- [x] **FASE 10 (parcial)** — Limpieza código, seguridad passwords en logs, mensajes de error, docs

## Completado — UI (2026-06-02)

- [x] **UI** `job-editor.html` — agregar campos `item_type`, `op_mode`, `op_passthrough_field`, `send_empty_sync` al formulario de creación/edición de jobs
- [x] **UI** `jobs.html` — mostrar columnas `item_type` y `op_mode` en la tabla de listado de jobs
- [x] **UI** `jobs.html` — agregar botón "Reset Snapshot" por job (`POST /:id/reset-snapshot`)
- [x] **UI** `logs.html` — mostrar stats desglosados (`created` / `updated` / `deleted` / `skipped`) en detalle de ejecución

## Pendiente — requiere entorno real

### Pruebas funcionales (requiere SQL Server + navegador)
- [ ] Prueba end-to-end: conexión SQL Server real → crear job → ejecutar → ver log
- [ ] Verificar todos los tipos de auth (Bearer, Basic, API Key, Login)
- [ ] Verificar modo full e incremental
- [ ] Simular API que falla → verificar reintentos
- [ ] Revisar UI en diferentes resoluciones de pantalla

### Pruebas Windows Service (requiere reinicio de servidor)
- [ ] `node scripts/install-service.js` en entorno real
- [ ] Reiniciar Windows → verificar auto-start
- [ ] Matar proceso → verificar recovery automático

### Distribución
- [ ] `install.bat` / `uninstall.bat` (scripts de instalación sin abrir terminal)

## TODO FUTURO (no tocar aún)

- [ ] **Reporte de desincronización** — comparar snapshot local vs items en ArdisApp via GET paginado (KLSyncBridge ↔ ArdisApp)
- [ ] **Parseo detallado de `errors[]` de ArdisApp** — guardar `reference` + motivo por fila fallida en `details_json`
- [ ] **Campos excluidos por job** — lista configurable de campos a omitir del payload (`exclude_if_null`, campos protegidos custom)

## Notas
- Puerto por defecto: 3847
- Primer uso: `npm install` → `node scripts/setup.js` → `node src/app.js`
