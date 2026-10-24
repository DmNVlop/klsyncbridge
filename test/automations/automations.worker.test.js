'use strict';

const { getDb } = require('../helpers/test-env');
const test = require('node:test');
const assert = require('node:assert/strict');
const queue = require('../../src/core/queue/work-queue');
const { createWorker } = require('../../src/modules/automations/automations.worker');
const { AUTOMATION_RETRY } = require('../../src/config/constants');
const { seedAutomation } = require('../helpers/seed');
const silentLogger = require('../helpers/silent-logger');

function fakeStep(outcomes) {
  const calls = [];
  return {
    calls,
    plugin: {
      type: 'fake',
      concurrency: 1,
      run: async (_ctx, item) => {
        calls.push(item.display_name);
        const next = outcomes.shift();
        if (next instanceof Error) throw next;
        return next;
      },
    },
    config: {},
    resourceFields: [],
  };
}

function makeWorker(automationId, step, { resolveResources = async () => ({}) } = {}) {
  const changes = [];
  const halts = [];
  const worker = createWorker({
    automationId,
    steps: [step],
    resolveResources,
    policy: AUTOMATION_RETRY,
    logger: silentLogger,
    onItemChanged: (item) => changes.push(item),
    onHalt: (message) => halts.push(message),
  });
  return { worker, changes, halts };
}

function add(automationId, name) {
  return queue.enqueue({ automationId, itemKey: `c:\\x\\${name}`, displayName: name, fingerprint: `fp-${name}`, meta: {} }).item;
}

test('done ⇒ estado final, intento registrado y aviso de cambio', async () => {
  const a = seedAutomation();
  const item = add(a, 'a.xml');
  const step = fakeStep([{ outcome: 'done', result: { http_status: 201, status: 'CREATED', external_ref: 'ARD-1', external_version: 1 } }]);
  const { worker, changes } = makeWorker(a, step);
  await worker.wake();
  worker.stop();
  const saved = queue.getItem(item.id);
  assert.equal(saved.status, 'done');
  assert.equal(saved.external_ref, 'ARD-1');
  assert.equal(queue.listAttempts(item.id).length, 1);
  assert.equal(changes.at(-1).status, 'done');
});

test('retry ⇒ espera 1 min; al vencer se reintenta y termina', async () => {
  const a = seedAutomation();
  const item = add(a, 'r.xml');
  const step = fakeStep([{ outcome: 'retry', result: { message: 'caído' } }, { outcome: 'done', result: {} }]);
  const { worker } = makeWorker(a, step);
  await worker.wake();
  const waiting = queue.getItem(item.id);
  assert.equal(waiting.status, 'retry_wait');
  const delay = Date.parse(waiting.next_retry_at) - Date.now();
  assert.ok(delay > 55000 && delay <= 60000, `espera inesperada: ${delay}`);
  getDb().prepare('UPDATE work_items SET next_retry_at = ? WHERE id = ?').run('2000-01-01T00:00:00.000Z', item.id);
  await worker.wake();
  worker.stop();
  assert.equal(queue.getItem(item.id).status, 'done');
  assert.equal(step.calls.length, 2);
});

test('excepción del paso ⇒ retry con el mensaje', async () => {
  const a = seedAutomation();
  const item = add(a, 'e.xml');
  const { worker } = makeWorker(a, fakeStep([new Error('boom')]));
  await worker.wake();
  worker.stop();
  const saved = queue.getItem(item.id);
  assert.equal(saved.status, 'retry_wait');
  assert.match(saved.last_message, /boom/);
});

test('resultado no válido del paso ⇒ retry', async () => {
  const a = seedAutomation();
  const item = add(a, 'raro.xml');
  const { worker } = makeWorker(a, fakeStep([{ outcome: 'otro' }]));
  await worker.wake();
  worker.stop();
  assert.equal(queue.getItem(item.id).status, 'retry_wait');
});

test('halt ⇒ se detiene, avisa y deja el resto pendiente', async () => {
  const a = seedAutomation();
  const first = add(a, 'h1.xml');
  const second = add(a, 'h2.xml');
  const step = fakeStep([{ outcome: 'halt', result: { message: 'Token sin permiso' } }]);
  const { worker, halts } = makeWorker(a, step);
  await worker.wake();
  assert.deepEqual(halts, ['Token sin permiso']);
  assert.equal(worker.isHalted(), true);
  assert.equal(queue.getItem(first.id).status, 'pending');
  assert.equal(queue.getItem(second.id).status, 'pending');
  await worker.wake();
  worker.stop();
  assert.equal(step.calls.length, 1, 'detenido: no procesa más');
});

test('fallo al cargar un recurso ⇒ halt', async () => {
  const a = seedAutomation();
  add(a, 'res.xml');
  const { worker, halts } = makeWorker(a, fakeStep([]), { resolveResources: async () => { throw new Error('Configuración de API no encontrado'); } });
  await worker.wake();
  worker.stop();
  assert.match(halts[0], /Configuración de API no encontrado/);
});

test('arranca detenido si la automatización estaba en needs_attention', async () => {
  const a = seedAutomation();
  add(a, 'p.xml');
  const step = fakeStep([{ outcome: 'done', result: {} }]);
  const worker = createWorker({
    automationId: a, steps: [step], resolveResources: async () => ({}), policy: AUTOMATION_RETRY,
    halted: true, logger: silentLogger, onItemChanged: () => undefined, onHalt: () => undefined,
  });
  await worker.wake();
  worker.stop();
  assert.equal(step.calls.length, 0);
});
