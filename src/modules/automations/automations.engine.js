'use strict';

const logger = require('../../services/logger.service');
const events = require('../../services/events.service');
const queue = require('../../core/queue/work-queue');
const { resolveApiConfig } = require('../../core/resources/api-config-resolver');
const {
  AUTOMATION_HEALTH: H, AUTOMATION_ITEM_STATUSES: S, AUTOMATION_RETRY, AUTOMATION_ATTEMPTS_RETENTION_DAYS,
} = require('../../config/constants');
const svc = require('./automations.service');
const { triggers, steps } = require('./plugins/registry');
const { createWorker } = require('./automations.worker');

// Cómo se resuelve cada tipo de recurso referenciado en la configuración de un paso
const RESOURCE_RESOLVERS = { api_config: resolveApiConfig };
const DAY_MS = 24 * 60 * 60 * 1000;

const running = new Map(); // automationId ⇒ { trigger, worker }
let purgeTimer = null;

async function resolveResources(resourceFields, config) {
  const resources = {};
  for (const { field, resource } of resourceFields) {
    resources[field] = await RESOURCE_RESOLVERS[resource](config[field]);
  }
  return resources;
}

function setHealth(id, state, message) {
  svc.setHealth(id, state, message);
  events.emitAutomationHealthChanged({ id, health_state: state, health_message: message || null });
}

function purgeOldAttempts() {
  try {
    const deleted = queue.purgeAttempts(AUTOMATION_ATTEMPTS_RETENTION_DAYS);
    if (deleted > 0) logger.info('Historial de automatizaciones purgado', { deleted });
  } catch (err) {
    logger.error('Error al purgar el historial de automatizaciones', { error: err.message });
  }
}

function stopAutomation(id) {
  const entry = running.get(id);
  if (!entry) return;
  entry.trigger.stop();
  entry.worker.stop();
  running.delete(id);
}

function startAutomation(automation) {
  stopAutomation(automation.id);

  const worker = createWorker({
    automationId: automation.id,
    steps: automation.steps.map((s) => ({ plugin: steps.get(s.type), config: s.config, resourceFields: steps.resourceFields(s.type) })),
    resolveResources,
    policy: AUTOMATION_RETRY,
    halted: automation.health_state === H.NEEDS_ATTENTION,
    logger,
    onItemChanged: (item) => {
      if (item.status === S.DONE) svc.markSuccess(automation.id);
      events.emitWorkItemChanged(item);
    },
    onHalt: (message) => {
      logger.warn('Automatización detenida: necesita revisión', { automation_id: automation.id, name: automation.name, message });
      setHealth(automation.id, H.NEEDS_ATTENTION, message);
    },
  });

  const trigger = triggers.get(automation.trigger.type).createInstance(automation.trigger.config);
  trigger.start({
    logger,
    isKnownUnchanged: (itemKey, stat) => queue.isKnownUnchanged(automation.id, itemKey, stat),
    enqueue: (input) => {
      const { action, item } = queue.enqueue({ automationId: automation.id, ...input });
      if (action === 'unchanged') return;
      events.emitWorkItemChanged(item);
      worker.wake();
    },
    // Una automatización detenida por halt conserva needs_attention aunque la carpeta vuelva a estar accesible
    setHealth: (state, message) => {
      if (!worker.isHalted()) setHealth(automation.id, state, message);
    },
  });

  running.set(automation.id, { trigger, worker });
  worker.wake();
  logger.info('Automatización iniciada', { automation_id: automation.id, name: automation.name, trigger: automation.trigger.type });
}

/** Al arrancar el servicio: recupera lo que quedó a medias, purga historial y arranca las activas. */
async function start() {
  const reset = queue.resetProcessing();
  if (reset > 0) logger.info('Archivos en proceso devueltos a pendiente tras el reinicio', { count: reset });
  purgeOldAttempts();
  if (!purgeTimer) {
    purgeTimer = setInterval(purgeOldAttempts, DAY_MS);
    purgeTimer.unref();
  }
  for (const automation of svc.listActiveAutomations()) {
    try {
      startAutomation(automation);
    } catch (err) {
      logger.error('No se pudo iniciar una automatización', { automation_id: automation.id, error: err.message });
      setHealth(automation.id, H.NEEDS_ATTENTION, `No se pudo iniciar: ${err.message}`);
    }
  }
}

/** Tras crear/editar/activar/desactivar: para y, si está activa, vuelve a arrancar con la definición guardada. */
function reloadAutomation(id) {
  stopAutomation(id);
  const automation = svc.getAutomation(id);
  if (automation.is_active) startAutomation(automation);
}

/** Botón «Reanudar» (o api_config guardada): limpia needs_attention y vuelve a arrancar. */
function resume(id) {
  setHealth(id, H.OK, null);
  reloadAutomation(id);
}

function resumeByApiConfig(apiConfigId) {
  for (const id of svc.findAutomationIdsByApiConfig(apiConfigId)) {
    if (svc.getAutomation(id).health_state === H.NEEDS_ATTENTION) resume(id);
  }
}

/** Reintento manual: despierta al worker si está en marcha. */
function wakeAutomation(id) {
  const entry = running.get(id);
  if (entry) entry.worker.wake();
}

function stopAll() {
  if (purgeTimer) clearInterval(purgeTimer);
  purgeTimer = null;
  for (const id of [...running.keys()]) stopAutomation(id);
}

function getRuntime(id) {
  return running.get(id) || null;
}

module.exports = { start, stopAll, reloadAutomation, stopAutomation, resume, resumeByApiConfig, wakeAutomation, getRuntime };
