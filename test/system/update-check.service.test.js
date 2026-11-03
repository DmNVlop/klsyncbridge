'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createUpdateChecker, UPDATE_STATUS } = require('../../src/modules/system/update-check.service');

function checker(fetch, version = '2.3.0') {
  return createUpdateChecker({
    getVersion: () => version,
    getMode: () => 'installer',
    fetch,
    now: () => new Date('2026-11-03T10:00:00Z'),
  });
}

test('sin comprobar todavía: estado unknown con la versión instalada', () => {
  const c = checker(async () => ({ version: '9.9.9' }));
  const r = c.getLastResult();
  assert.equal(r.status, UPDATE_STATUS.UNKNOWN);
  assert.equal(r.current, '2.3.0');
  assert.equal(r.hasUpdate, false);
});

test('versión publicada mayor: update-available y se guarda como último resultado', async () => {
  const c = checker(async () => ({ version: '2.3.1', changelog: '- arreglo', release_date: '2026-11-04' }));
  const r = await c.checkNow();
  assert.equal(r.status, UPDATE_STATUS.UPDATE_AVAILABLE);
  assert.equal(r.hasUpdate, true);
  assert.equal(r.latest, '2.3.1');
  assert.equal(r.changelog, '- arreglo');
  assert.equal(r.checkedAt, '2026-11-03T10:00:00.000Z');
  assert.deepEqual(c.getLastResult(), r);
});

test('misma versión: up-to-date', async () => {
  const r = await checker(async () => ({ version: '2.3.0' })).checkNow();
  assert.equal(r.status, UPDATE_STATUS.UP_TO_DATE);
  assert.equal(r.hasUpdate, false);
});

test('404 (aún no hay Release publicado): no-release, sin error', async () => {
  const r = await checker(async () => {
    const err = new Error('Request failed with status code 404');
    err.response = { status: 404 };
    throw err;
  }).checkNow();
  assert.equal(r.status, UPDATE_STATUS.NO_RELEASE);
  assert.equal(r.error, null);
  assert.equal(r.current, '2.3.0');
});

test('sin red: error con el mensaje, conserva la versión instalada', async () => {
  const r = await checker(async () => { throw new Error('getaddrinfo ENOTFOUND github.com'); }).checkNow();
  assert.equal(r.status, UPDATE_STATUS.ERROR);
  assert.match(r.error, /ENOTFOUND/);
  assert.equal(r.current, '2.3.0');
  assert.equal(r.hasUpdate, false);
});

test('startPeriodicChecks comprueba tras el retardo inicial y devuelve cómo pararlo', async () => {
  let calls = 0;
  const c = checker(async () => { calls += 1; return { version: '2.3.0' }; });
  const stop = c.startPeriodicChecks({ initialDelayMs: 10, intervalMs: 60 * 60 * 1000 });
  await new Promise((r) => setTimeout(r, 50));
  stop();
  assert.equal(calls, 1);
  assert.equal(c.getLastResult().status, UPDATE_STATUS.UP_TO_DATE);
});
