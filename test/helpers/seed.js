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

/** Espera a que se cumpla una condición (sin esperas fijas: sondea cada intervalMs hasta timeoutMs). */
async function waitFor(condition, { timeoutMs = 10000, intervalMs = 50 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Condición no cumplida en ${timeoutMs} ms`);
}

module.exports = { seedAutomation, seedApiConfig, waitFor };
