'use strict';

const crypto = require('crypto');
const { getDb } = require('../../config/database');
const { AUTOMATION_HEALTH } = require('../../config/constants');
const { NotFoundError, ValidationError } = require('../../utils/errors');
const { countsByStatus } = require('../../core/queue/work-queue');
const { triggers, steps } = require('./plugins/registry');

// Tabla de cada tipo de recurso que un paso puede referenciar por id
const RESOURCE_TABLES = { api_config: 'api_configs' };

const now = () => new Date().toISOString();

function loadSteps(automationId) {
  return getDb().prepare('SELECT * FROM automation_steps WHERE automation_id = ? ORDER BY position').all(automationId);
}

function serialize(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    is_active: Boolean(row.is_active),
    trigger: { type: row.trigger_type, config: JSON.parse(row.trigger_config) },
    steps: loadSteps(row.id).map((s) => ({ id: s.id, position: s.position, type: s.step_type, config: JSON.parse(s.config) })),
    health_state: row.health_state,
    health_message: row.health_message,
    last_success_at: row.last_success_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    counts: countsByStatus(row.id),
  };
}

// Etiqueta los errores de configuración con su sección para que la UI los pinte en su sitio
function inSection(section, fn) {
  try {
    return fn();
  } catch (err) {
    if (err instanceof ValidationError) throw new ValidationError(err.message, { section, fields: err.details || {} });
    throw err;
  }
}

function assertResourcesExist(stepType, config) {
  for (const { field, resource } of steps.resourceFields(stepType)) {
    const exists = getDb().prepare(`SELECT 1 FROM ${RESOURCE_TABLES[resource]} WHERE id = ?`).get(config[field]);
    if (!exists) throw new ValidationError('El recurso seleccionado no existe', { [field]: ['No existe: elige otro'] });
  }
}

/** Valida disparador y pasos con el esquema de su plugin y devuelve la configuración completa. */
function normalizeDefinition(data) {
  const triggerConfig = inSection('trigger', () => triggers.parseConfig(data.trigger.type, data.trigger.config));
  const stepDefs = data.steps.map((step, index) => inSection(`step:${index}`, () => {
    const config = steps.parseConfig(step.type, step.config);
    assertResourcesExist(step.type, config);
    return { type: step.type, config };
  }));
  return { triggerConfig, stepDefs };
}

function insertSteps(automationId, stepDefs) {
  const insert = getDb().prepare('INSERT INTO automation_steps (id, automation_id, position, step_type, config) VALUES (?, ?, ?, ?, ?)');
  stepDefs.forEach((step, index) => insert.run(crypto.randomUUID(), automationId, index, step.type, JSON.stringify(step.config)));
}

function listAutomations() {
  return getDb().prepare('SELECT * FROM automations ORDER BY name').all().map(serialize);
}

function listActiveAutomations() {
  return getDb().prepare('SELECT * FROM automations WHERE is_active = 1').all().map(serialize);
}

function getAutomation(id) {
  const row = getDb().prepare('SELECT * FROM automations WHERE id = ?').get(id);
  if (!row) throw new NotFoundError('Automatización');
  return serialize(row);
}

function createAutomation(data) {
  const db = getDb();
  const { triggerConfig, stepDefs } = normalizeDefinition(data);
  const id = crypto.randomUUID();
  const ts = now();
  db.transaction(() => {
    db.prepare(`
      INSERT INTO automations (id, name, description, is_active, trigger_type, trigger_config, health_state, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, data.name, data.description || null, data.is_active ? 1 : 0, data.trigger.type, JSON.stringify(triggerConfig), AUTOMATION_HEALTH.OK, ts, ts);
    insertSteps(id, stepDefs);
  })();
  return getAutomation(id);
}

/** Guardar = definición completa. Vuelve a salud correcta: guardar reanuda una automatización detenida. */
function updateAutomation(id, data) {
  getAutomation(id);
  const db = getDb();
  const { triggerConfig, stepDefs } = normalizeDefinition(data);
  db.transaction(() => {
    db.prepare(`
      UPDATE automations SET name = ?, description = ?, is_active = ?, trigger_type = ?, trigger_config = ?,
        health_state = ?, health_message = NULL, updated_at = ?
      WHERE id = ?
    `).run(data.name, data.description || null, data.is_active ? 1 : 0, data.trigger.type, JSON.stringify(triggerConfig), AUTOMATION_HEALTH.OK, now(), id);
    db.prepare('DELETE FROM automation_steps WHERE automation_id = ?').run(id);
    insertSteps(id, stepDefs);
  })();
  return getAutomation(id);
}

/** Borra la automatización con sus pasos, archivos e historial (FK en cascada). */
function deleteAutomation(id) {
  getAutomation(id);
  getDb().prepare('DELETE FROM automations WHERE id = ?').run(id);
}

function setHealth(id, state, message) {
  getDb().prepare('UPDATE automations SET health_state = ?, health_message = ?, updated_at = ? WHERE id = ?')
    .run(state, message || null, now(), id);
}

function markSuccess(id) {
  getDb().prepare('UPDATE automations SET last_success_at = ? WHERE id = ?').run(now(), id);
}

/** Automatizaciones cuyos pasos usan una api_config (los ids son uuid: sin comodines de LIKE). */
function findAutomationIdsByApiConfig(apiConfigId) {
  return getDb().prepare('SELECT DISTINCT automation_id FROM automation_steps WHERE config LIKE ?')
    .all(`%"${apiConfigId}"%`)
    .map((row) => row.automation_id);
}

module.exports = {
  listAutomations,
  listActiveAutomations,
  getAutomation,
  createAutomation,
  updateAutomation,
  deleteAutomation,
  setHealth,
  markSuccess,
  findAutomationIdsByApiConfig,
};
