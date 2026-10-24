'use strict';

const { getDb } = require('../helpers/test-env');
const test = require('node:test');
const assert = require('node:assert/strict');
const queue = require('../../src/core/queue/work-queue');
const { seedAutomation } = require('../helpers/seed');
const { AUTOMATION_RETRY } = require('../../src/config/constants');

const NOW = Date.parse('2026-10-24T10:00:00.000Z');

function add(automationId, name, fingerprint = `fp-${name}`, meta = { size: 10, mtimeMs: 1 }) {
  return queue.enqueue({ automationId, itemKey: `c:\\xml\\${name}`, displayName: name, fingerprint, meta });
}

function claimOne(automationId) {
  const [item] = queue.claimDue(automationId, 1, new Date(NOW).toISOString());
  return item;
}

test('enqueue: crea, ignora mismo contenido y reencola contenido nuevo', () => {
  const a = seedAutomation();
  assert.equal(add(a, 'p1.xml').action, 'created');
  assert.equal(add(a, 'p1.xml').action, 'unchanged');
  const item = claimOne(a);
  queue.completeAttempt(item, { outcome: 'rejected', result: {}, durationMs: 5, policy: AUTOMATION_RETRY, nowMs: NOW });
  const requeued = add(a, 'p1.xml', 'fp-nuevo');
  assert.equal(requeued.action, 'requeued');
  assert.equal(requeued.item.status, 'pending');
  assert.equal(requeued.item.attempts, 0);
});

test('isKnownUnchanged compara tamaño y fecha guardados', () => {
  const a = seedAutomation();
  add(a, 'k.xml', 'fp', { size: 3, mtimeMs: 7 });
  assert.equal(queue.isKnownUnchanged(a, 'c:\\xml\\k.xml', { size: 3, mtimeMs: 7 }), true);
  assert.equal(queue.isKnownUnchanged(a, 'c:\\xml\\k.xml', { size: 4, mtimeMs: 7 }), false);
  assert.equal(queue.isKnownUnchanged(a, 'c:\\xml\\otro.xml', { size: 3, mtimeMs: 7 }), false);
});

test('claimDue toma pendientes y reintentos vencidos, nunca los no vencidos', () => {
  const a = seedAutomation();
  add(a, 'x.xml');
  const item = claimOne(a);
  assert.equal(item.status, 'processing');
  queue.completeAttempt(item, { outcome: 'retry', result: {}, durationMs: 1, policy: AUTOMATION_RETRY, nowMs: NOW });
  assert.equal(queue.claimDue(a, 5, new Date(NOW + 30000).toISOString()).length, 0);
  assert.equal(queue.claimDue(a, 5, new Date(NOW + 60000).toISOString()).length, 1);
});

test('retry: 1 min, 5 min, 15 min, 1 h y al 5.º fallo ⇒ failed', () => {
  const a = seedAutomation();
  add(a, 'r.xml');
  const expected = ['2026-10-24T10:01:00.000Z', '2026-10-24T10:05:00.000Z', '2026-10-24T10:15:00.000Z', '2026-10-24T11:00:00.000Z'];
  for (const at of expected) {
    const [item] = queue.claimDue(a, 1, '2099-01-01T00:00:00.000Z');
    const saved = queue.completeAttempt(item, { outcome: 'retry', result: { message: 'caído' }, durationMs: 1, policy: AUTOMATION_RETRY, nowMs: NOW });
    assert.equal(saved.status, 'retry_wait');
    assert.equal(saved.next_retry_at, at);
  }
  const [item] = queue.claimDue(a, 1, '2099-01-01T00:00:00.000Z');
  const saved = queue.completeAttempt(item, { outcome: 'retry', result: {}, durationMs: 1, policy: AUTOMATION_RETRY, nowMs: NOW });
  assert.equal(saved.status, 'failed');
  assert.equal(saved.attempts, 5);
  assert.equal(queue.listAttempts(saved.id).length, 5);
});

test('done guarda nº de pedido, versión y huella enviada', () => {
  const a = seedAutomation();
  add(a, 'd.xml', 'fp-encolado');
  const item = claimOne(a);
  const saved = queue.completeAttempt(item, {
    outcome: 'done',
    result: { http_status: 201, status: 'CREATED', message: 'ok', external_ref: 'ARD-1', external_version: 1, fingerprint: 'fp-enviado' },
    durationMs: 12,
    policy: AUTOMATION_RETRY,
    nowMs: NOW,
  });
  assert.equal(saved.status, 'done');
  assert.equal(saved.external_ref, 'ARD-1');
  assert.equal(saved.external_version, 1);
  assert.equal(saved.fingerprint, 'fp-enviado');
  assert.equal(saved.last_result_status, 'CREATED');
  const [attempt] = queue.listAttempts(saved.id);
  assert.equal(attempt.triggered_by, 'auto');
  assert.equal(attempt.duration_ms, 12);
});

test('halt: vuelve a pending sin gastar intento', () => {
  const a = seedAutomation();
  add(a, 'h.xml');
  const item = claimOne(a);
  const saved = queue.completeAttempt(item, { outcome: 'halt', result: { message: 'token' }, durationMs: 1, policy: AUTOMATION_RETRY, nowMs: NOW });
  assert.equal(saved.status, 'pending');
  assert.equal(saved.attempts, 0);
});

test('contenido nuevo encolado mientras se procesaba ⇒ pending desde cero', () => {
  const a = seedAutomation();
  add(a, 'c.xml', 'fp-1');
  const item = claimOne(a);
  const during = add(a, 'c.xml', 'fp-2');
  assert.equal(during.item.status, 'processing');
  const saved = queue.completeAttempt(item, { outcome: 'done', result: { fingerprint: 'fp-1' }, durationMs: 1, policy: AUTOMATION_RETRY, nowMs: NOW });
  assert.equal(saved.status, 'pending');
  assert.equal(saved.fingerprint, 'fp-2');
  assert.equal(saved.attempts, 0);
});

test('resetProcessing devuelve a pending lo que quedó a medias', () => {
  const a = seedAutomation();
  add(a, 'z.xml');
  claimOne(a);
  assert.ok(queue.resetProcessing() >= 1);
  assert.equal(queue.listItems(a, { page: 1, perPage: 10 }).rows[0].status, 'pending');
});

test('reintento manual: vuelve a pending y el siguiente intento registra el usuario', () => {
  const a = seedAutomation();
  add(a, 'm.xml');
  const item = claimOne(a);
  queue.completeAttempt(item, { outcome: 'invalid', result: {}, durationMs: 1, policy: AUTOMATION_RETRY, nowMs: NOW });
  const retried = queue.requestManualRetry(item.id, 'ana');
  assert.equal(retried.status, 'pending');
  assert.equal(retried.requested_by, 'manual:ana');
  const again = claimOne(a);
  const saved = queue.completeAttempt(again, { outcome: 'done', result: {}, durationMs: 1, policy: AUTOMATION_RETRY, nowMs: NOW });
  assert.equal(saved.requested_by, null);
  assert.equal(queue.listAttempts(saved.id)[0].triggered_by, 'manual:ana');
});

test('reintento manual de un ítem en proceso ⇒ conflicto', () => {
  const a = seedAutomation();
  add(a, 'busy.xml');
  const item = claimOne(a);
  assert.throws(() => queue.requestManualRetry(item.id, 'ana'), { code: 'CONFLICT' });
});

test('listItems: filtro por estado, búsqueda por nombre y paginación', () => {
  const a = seedAutomation();
  ['uno.xml', 'dos.xml', 'tres.xml'].forEach((n) => add(a, n));
  const item = claimOne(a);
  queue.completeAttempt(item, { outcome: 'done', result: {}, durationMs: 1, policy: AUTOMATION_RETRY, nowMs: NOW });
  assert.equal(queue.listItems(a, { status: 'pending', page: 1, perPage: 10 }).total, 2);
  assert.equal(queue.listItems(a, { search: 'DO', page: 1, perPage: 10 }).rows[0].display_name, 'dos.xml');
  const page2 = queue.listItems(a, { page: 2, perPage: 2 });
  assert.equal(page2.total, 3);
  assert.equal(page2.rows.length, 1);
  assert.deepEqual(queue.countsByStatus(a), { pending: 2, processing: 0, retry_wait: 0, done: 1, rejected: 0, invalid: 0, failed: 0 });
});

test('nextDueAt devuelve el reintento más próximo', () => {
  const a = seedAutomation();
  add(a, 'n.xml');
  const item = claimOne(a);
  queue.completeAttempt(item, { outcome: 'retry', result: {}, durationMs: 1, policy: AUTOMATION_RETRY, nowMs: NOW });
  assert.equal(queue.nextDueAt(a), '2026-10-24T10:01:00.000Z');
});

test('purgeAttempts borra el historial de más de N días', () => {
  const a = seedAutomation();
  add(a, 'old.xml');
  const item = claimOne(a);
  queue.completeAttempt(item, { outcome: 'done', result: {}, durationMs: 1, policy: AUTOMATION_RETRY, nowMs: Date.parse('2020-01-01T00:00:00.000Z') });
  assert.ok(queue.purgeAttempts(90) >= 1);
  assert.equal(queue.listAttempts(item.id).length, 0);
  assert.ok(getDb().prepare('SELECT 1 FROM work_items WHERE id = ?').get(item.id), 'el ítem no se purga');
});
