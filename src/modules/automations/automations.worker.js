'use strict';

const queue = require('../../core/queue/work-queue');
const { AUTOMATION_OUTCOMES: O } = require('../../config/constants');

const VALID_OUTCOMES = new Set(Object.values(O));
const MAX_TIMER_MS = 2 ** 31 - 1;

/**
 * Procesa la cola de una automatización. Sin sondeo continuo: se despierta al encolar (wake)
 * o con un temporizador al vencer el reintento más próximo. Un ítem recorre los pasos en orden;
 * el primer resultado distinto de 'done' corta la cadena y fija su estado.
 *
 * steps: [{ plugin, config, resourceFields }]
 * resolveResources(resourceFields, config) ⇒ { campo: recursoResuelto }
 */
function createWorker({ automationId, steps, resolveResources, policy, halted = false, logger, onItemChanged, onHalt }) {
  const concurrency = Math.max(1, Math.min(...steps.map((s) => s.plugin.concurrency || 1)));
  let isHalted = halted;
  let stopped = false;
  let draining = null;
  let wakeRequested = false;
  let timer = null;

  function clearTimer() {
    if (timer) clearTimeout(timer);
    timer = null;
  }

  async function runSteps(item) {
    let last = { outcome: O.DONE, result: {} };
    for (const step of steps) {
      let resources;
      try {
        resources = await resolveResources(step.resourceFields, step.config);
      } catch (err) {
        return { outcome: O.HALT, result: { message: `No se pudo cargar un recurso del paso: ${err.message}` } };
      }
      try {
        last = await step.plugin.run({ config: step.config, resources, logger }, item);
      } catch (err) {
        logger.error('Error inesperado en un paso de automatización', {
          automation_id: automationId, step: step.plugin.type, file: item.display_name, error: err.message, stack: err.stack,
        });
        return { outcome: O.RETRY, result: { message: `Error inesperado: ${err.message}` } };
      }
      if (!last || !VALID_OUTCOMES.has(last.outcome)) {
        logger.error('Un paso de automatización devolvió un resultado no válido', {
          automation_id: automationId, step: step.plugin.type, outcome: last && last.outcome,
        });
        return { outcome: O.RETRY, result: { message: 'Resultado no válido del paso' } };
      }
      if (last.outcome !== O.DONE) return last;
    }
    return last;
  }

  function halt(message) {
    isHalted = true;
    clearTimer();
    onHalt(message || 'La automatización necesita revisión');
  }

  async function processItem(item) {
    const started = Date.now();
    const { outcome, result } = await runSteps(item);
    const updated = queue.completeAttempt(item, { outcome, result: result || {}, durationMs: Date.now() - started, policy });
    onItemChanged(updated);
    if (outcome === O.HALT && !isHalted) halt(result && result.message);
  }

  function scheduleNextRetry() {
    if (stopped || isHalted) return;
    const nextAt = queue.nextDueAt(automationId);
    if (!nextAt) return;
    const delay = Math.min(Math.max(Date.parse(nextAt) - Date.now(), 0), MAX_TIMER_MS);
    timer = setTimeout(() => { timer = null; wake(); }, delay);
    timer.unref();
  }

  async function drain() {
    clearTimer();
    while (!stopped && !isHalted) {
      const items = queue.claimDue(automationId, concurrency);
      if (items.length === 0) break;
      await Promise.all(items.map((item) => processItem(item).catch((err) => {
        logger.error('Error al registrar el intento de un archivo', { automation_id: automationId, file: item.display_name, error: err.message });
      })));
    }
    scheduleNextRetry();
  }

  /** Procesa lo pendiente; devuelve una promesa que se resuelve al vaciar la cola disponible. */
  function wake() {
    if (stopped || isHalted) return Promise.resolve();
    if (draining) {
      wakeRequested = true;
      return draining;
    }
    draining = (async () => {
      do {
        wakeRequested = false;
        await drain();
      } while (wakeRequested && !stopped && !isHalted);
    })()
      .catch((err) => logger.error('Error en el worker de automatización', { automation_id: automationId, error: err.message, stack: err.stack }))
      .finally(() => { draining = null; });
    return draining;
  }

  return {
    wake,
    isHalted: () => isHalted,
    stop() {
      stopped = true;
      clearTimer();
    },
  };
}

module.exports = { createWorker };
