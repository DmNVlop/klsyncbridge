'use strict';

const crypto = require('crypto');
const { getDb } = require('../../src/config/database');
const { createApiConfig } = require('../../src/modules/api-configs/api-configs.service');

/** Automatización mínima insertada a mano (sin validar plugins) para tests de cola y worker. */
function seedAutomation({ name, isActive = false } = {}) {
  const id = crypto.randomUUID();
  const ts = new Date().toISOString();
  getDb().prepare(`
    INSERT INTO automations (id, name, is_active, trigger_type, trigger_config, health_state, created_at, updated_at)
    VALUES (?, ?, ?, 'folder_watch', '{}', 'ok', ?, ?)
  `).run(id, name || `test-${id.slice(0, 8)}`, isActive ? 1 : 0, ts, ts);
  return id;
}

/** api_config con API key (cabecera X-API-Key = 'k') apuntando a baseUrl. */
function seedApiConfig(baseUrl) {
  return createApiConfig({
    name: `api-${crypto.randomUUID().slice(0, 8)}`,
    base_url: baseUrl,
    endpoint_path: '/orders-v2/external/ardis-xml-imports',
    method: 'POST',
    auth_type: 'api_key',
    auth_config: { key_name: 'X-API-Key', key_value: 'k', in: 'header' },
  });
}

/** Job de destino fichero (CSV) con su conexión CSV temporal. `overrides` pisa los campos del job. */
function seedJob(overrides = {}) {
  const fs = require('fs');
  const path = require('path');
  const { makeTempDir } = require('./test-env');
  const connectionsService = require('../../src/modules/connections/connections.service');
  const jobsService = require('../../src/modules/jobs/jobs.service');
  const file = path.join(makeTempDir(), 'datos.csv');
  fs.writeFileSync(file, ['id,name', '1,Uno', '2,Dos', ''].join('\n'));
  const connection = connectionsService.createConnection({
    name: `csv-${crypto.randomUUID().slice(0, 8)}`,
    source_type: 'csv',
    config: { file_path: file, delimiter: ',', encoding: 'utf8', has_header: true, header_row: 1 },
  });
  return jobsService.createJob({
    name: `job-${crypto.randomUUID().slice(0, 8)}`,
    connection_id: connection.id,
    table_or_view: 'datos',
    key_field: 'id',
    schedule_type: 'interval',
    schedule_value: '3600',
    item_type: 'material',
    destination_mode: 'file',
    file_formats: 'csv',
    output_dir: makeTempDir(),
    ...overrides,
  });
}

/** Espera a que se cumpla una condición (sin esperas fijas: sondea cada intervalMs hasta timeoutMs). */
async function waitFor(condition, { timeoutMs = 10000, intervalMs = 50 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Condición no cumplida en ${timeoutMs} ms`);
}

module.exports = { seedAutomation, seedApiConfig, seedJob, waitFor };
