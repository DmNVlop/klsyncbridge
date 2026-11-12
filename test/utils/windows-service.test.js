'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseServiceState, parseServiceStatus, queryServiceState, startService, ensureServiceRunning,
} = require('../../src/utils/windows-service');

const ES_STOPPED = `
NOMBRE_DE_SERVICIO: klsyncbridge.exe
        TIPO                       : 10  WIN32_OWN_PROCESS
        ESTADO                     : 1  STOPPED
        CÓDIGO_DE_SALIDA_DE_WIN32  : 1077  (0x435)
        CÓDIGO_DE_SALIDA_DEL_SERVICIO: 0  (0x0)
        PUNTO_DE_COMPROBACIÓN      : 0x0
        INDICACIÓN_DE_INICIO       : 0x0
`;

const EN_RUNNING = `
SERVICE_NAME: klsyncbridge.exe
        TYPE               : 10  WIN32_OWN_PROCESS
        STATE              : 4  RUNNING
                                (STOPPABLE, NOT_PAUSABLE, ACCEPTS_SHUTDOWN)
        WIN32_EXIT_CODE    : 0  (0x0)
        SERVICE_EXIT_CODE  : 0  (0x0)
`;

const EN_START_PENDING = 'SERVICE_NAME: x\n        STATE              : 2  START_PENDING\n        WIN32_EXIT_CODE    : 0  (0x0)\n';

test('parseServiceStatus lee estado y código Win32 de una salida en español', () => {
  assert.deepEqual(parseServiceStatus(ES_STOPPED), { state: 'STOPPED', win32ExitCode: 1077 });
});

test('parseServiceStatus lee estado y código Win32 de una salida en inglés', () => {
  assert.deepEqual(parseServiceStatus(EN_RUNNING), { state: 'RUNNING', win32ExitCode: 0 });
});

test('parseServiceState distingue START_PENDING y devuelve null si no reconoce nada', () => {
  assert.equal(parseServiceState(EN_START_PENDING), 'START_PENDING');
  assert.equal(parseServiceState(ES_STOPPED), 'STOPPED');
  assert.equal(parseServiceState('basura'), null);
  assert.equal(parseServiceState(undefined), null);
});

test('parseServiceStatus no confunde el código de salida del servicio con el de Win32', () => {
  const text = 'ESTADO : 1  STOPPED\nCÓDIGO_DE_SALIDA_DEL_SERVICIO: 5  (0x5)\n';
  assert.equal(parseServiceStatus(text).win32ExitCode, null);
});

test('queryServiceState: 1060 es «no instalado»; otro fallo lanza error claro', () => {
  const notFound = () => { const e = new Error('x'); e.status = 1060; throw e; };
  assert.deepEqual(queryServiceState('a', { exec: notFound }), { installed: false });
  const broken = () => { const e = new Error('x'); e.status = 5; throw e; };
  assert.throws(() => queryServiceState('a', { exec: broken }), /No se pudo consultar el servicio a .*código 5/);
  assert.deepEqual(queryServiceState('a', { exec: () => ES_STOPPED }), { installed: true, state: 'STOPPED', win32ExitCode: 1077 });
});

test('startService acepta 1056 (ya en marcha) y lanza error con el resto', () => {
  const running = () => { const e = new Error('x'); e.status = 1056; throw e; };
  assert.doesNotThrow(() => startService('a', { exec: running }));
  const denied = () => { const e = new Error('x'); e.status = 5; e.output = 'Acceso denegado'; throw e; };
  assert.throws(() => startService('a', { exec: denied }), /código 5.*Acceso denegado/);
});

/** Fakes: `states` se consume en cada consulta (el último se repite). */
function fakes(states) {
  const calls = { starts: 0, sleeps: 0 };
  let i = 0;
  return {
    calls,
    deps: {
      query: () => states[Math.min(i++, states.length - 1)],
      start: () => { calls.starts += 1; },
      sleep: async () => { calls.sleeps += 1; },
      pollMs: 1,
    },
  };
}

const running = { installed: true, state: 'RUNNING', win32ExitCode: 0 };
const stopped = { installed: true, state: 'STOPPED', win32ExitCode: 1077 };
const pending = { installed: true, state: 'START_PENDING', win32ExitCode: 0 };

test('ensureServiceRunning: ya en RUNNING no arranca nada', async () => {
  const f = fakes([running]);
  assert.equal(await ensureServiceRunning('a', f.deps), 'RUNNING');
  assert.equal(f.calls.starts, 0);
});

test('ensureServiceRunning: STOPPED ⇒ arranca ⇒ RUNNING', async () => {
  const f = fakes([stopped, running]);
  assert.equal(await ensureServiceRunning('a', f.deps), 'RUNNING');
  assert.equal(f.calls.starts, 1);
});

test('ensureServiceRunning: START_PENDING espera y llega a RUNNING sin arrancar de nuevo', async () => {
  const f = fakes([pending, pending, running]);
  assert.equal(await ensureServiceRunning('a', f.deps), 'RUNNING');
  assert.equal(f.calls.starts, 0);
  assert.equal(f.calls.sleeps, 2);
});

test('ensureServiceRunning: si vuelve a STOPPED reintenta y lanza error tras maxStartAttempts', async () => {
  const f = fakes([stopped]);
  await assert.rejects(
    ensureServiceRunning('a', { ...f.deps, maxStartAttempts: 3 }),
    /se detiene tras 3 intentos.*1077/,
  );
  assert.equal(f.calls.starts, 3);
});

test('ensureServiceRunning: agota el tiempo con mensaje claro', async () => {
  const f = fakes([pending]);
  await assert.rejects(
    ensureServiceRunning('a', { ...f.deps, timeoutMs: 30, sleep: () => new Promise((r) => setTimeout(r, 10)) }),
    /no llegó a RUNNING en 0 s \(estado: START_PENDING, código Win32: 0\)/,
  );
});

test('ensureServiceRunning: servicio no instalado lanza error', async () => {
  const f = fakes([{ installed: false }]);
  await assert.rejects(ensureServiceRunning('a', f.deps), /no está instalado/);
});
