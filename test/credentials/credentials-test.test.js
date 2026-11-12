'use strict';

require('../helpers/test-env');
const test = require('node:test');
const assert = require('node:assert/strict');
const { testFolderAccess } = require('../../src/modules/credentials/credentials-test.service');
const { createCredentialAccess } = require('../../src/modules/credentials/credential-access.service');
const { createNetworkSession } = require('../../src/core/network/network-session');
const { conflictMessage } = require('../../src/core/network/net-errors');
const { ValidationError } = require('../../src/utils/errors');

const SECRET = 'clave-de-prueba-xyz';
const PATH = '\\\\srv\\rec\\in';
const actor = { id: 'u1', username: 'tester' };
const quietLogger = { info() {}, warn() {}, error() {} };

/** probeFolder simulado: ejecuta el hook y devuelve pasos según `listOk`/`writeOk`. */
function fakeProbe({ listOk = true, writeOk = true } = {}) {
  const calls = [];
  const probe = async ({ checkWrite, pattern }, { ensureAccess }) => {
    calls.push({ checkWrite, pattern });
    try {
      await ensureAccess();
    } catch (err) {
      return { accessible: false, steps: [{ name: 'connect', ok: false, message: err.message }] };
    }
    const steps = [{ name: 'connect', ok: true, message: 'ok' }, { name: 'list', ok: listOk, message: listOk ? 'listado' : 'no lista' }];
    if (checkWrite) steps.push({ name: 'write', ok: writeOk, message: writeOk ? 'escribe' : 'no escribe' });
    return { accessible: listOk, matchingFiles: 3, steps };
  };
  return { probe, calls };
}

function build({ probeOptions, winCode = 0 } = {}) {
  const connects = [];
  const disconnects = [];
  const winNet = {
    connect: async (arg) => { connects.push(arg.username); return winCode; },
    disconnect: async (root) => { disconnects.push(root); return 0; },
  };
  const session = createNetworkSession({ winNet, logger: quietLogger });
  const getSecret = async (id) => ({ id, domain: 'EMP', username: 'guardada', password: SECRET });
  const saved = createCredentialAccess({ getSecret, session, logger: quietLogger });
  const recorded = [];
  const { probe, calls } = fakeProbe(probeOptions);
  const deps = {
    credentialAccess: saved, probeFolder: probe, session, logger: quietLogger,
    getCredential: () => ({ username: 'guardada', domain: 'EMP' }),
    recordTestResult: (id, result, who) => recorded.push({ id, result, who }),
  };
  return { deps, connects, disconnects, recorded, calls, session };
}

test('credencial guardada: usa su secreto y registra el resultado', async () => {
  const { deps, connects, recorded } = build();
  const res = await testFolderAccess({ path: PATH, credentialId: 'cred-1', checkWrite: true }, actor, deps);
  assert.equal(res.ok, true);
  assert.deepEqual(res.steps.map((s) => s.name), ['connect', 'list', 'write']);
  assert.deepEqual(connects, ['EMP\\guardada']);
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].id, 'cred-1');
  assert.equal(recorded[0].result.ok, true);
  assert.equal(JSON.stringify(res).includes(SECRET), false);
});

test('efímera: conecta con los datos recibidos, desconecta siempre y no registra last_test', async () => {
  const { deps, connects, disconnects, recorded } = build();
  const res = await testFolderAccess({ path: PATH, username: 'otro', domain: 'X', password: SECRET }, actor, deps);
  assert.equal(res.ok, true);
  assert.deepEqual(connects, ['X\\otro']);
  assert.equal(disconnects.length, 1);
  assert.equal(recorded.length, 0);
  assert.equal(JSON.stringify(res).includes(SECRET), false);
});

test('efímera contra servidor ya conectado con otra credencial ⇒ connect en rojo por conflicto y conexión intacta', async () => {
  const { deps, disconnects, session } = build();
  await session.ensureConnected({ root: '\\\\srv\\rec', credentialId: 'cred-ajena', username: 'a', password: 'p' });
  const res = await testFolderAccess({ path: PATH, username: 'otro', password: SECRET }, actor, deps);
  assert.equal(res.ok, false);
  assert.equal(res.steps[0].name, 'connect');
  assert.equal(res.steps[0].ok, false);
  assert.equal(res.message, conflictMessage('srv', 'credential'));
  assert.equal(disconnects.length, 0, 'no se cancela la conexión ajena');
  assert.equal(session.listConnections().length, 1);
  assert.equal(session.listConnections()[0].credentialId, 'cred-ajena');
});

test('efímera: desconecta también si el listado falla', async () => {
  const { deps, disconnects } = build({ probeOptions: { listOk: false } });
  const res = await testFolderAccess({ path: PATH, username: 'otro', password: SECRET }, actor, deps);
  assert.equal(res.ok, false);
  assert.equal(disconnects.length, 1);
});

test('fallo en connect ⇒ sin pasos list ni write', async () => {
  const { deps } = build({ winCode: 1326 });
  const res = await testFolderAccess({ path: PATH, credentialId: 'cred-1', checkWrite: true }, actor, deps);
  assert.equal(res.ok, false);
  assert.deepEqual(res.steps.map((s) => s.name), ['connect']);
});

test('checkWrite false ⇒ sin paso write; fallo de escritura ⇒ ok false', async () => {
  const noWrite = build();
  const a = await testFolderAccess({ path: PATH, credentialId: 'cred-1' }, actor, noWrite.deps);
  assert.equal(a.steps.some((s) => s.name === 'write'), false);
  const failing = build({ probeOptions: { writeOk: false } });
  const b = await testFolderAccess({ path: PATH, credentialId: 'cred-1', checkWrite: true }, actor, failing.deps);
  assert.equal(b.ok, false);
  assert.equal(b.message, 'no escribe');
});

test('ruta local ⇒ ValidationError', async () => {
  const { deps } = build();
  await assert.rejects(testFolderAccess({ path: 'C:\\datos', credentialId: 'cred-1' }, actor, deps), ValidationError);
});

test('reenvía el patrón (por defecto «*») y conserva los campos del probe', async () => {
  const withPattern = build();
  const res = await testFolderAccess({ path: PATH, credentialId: 'cred-1', pattern: '*.xml' }, actor, withPattern.deps);
  assert.equal(withPattern.calls[0].pattern, '*.xml');
  assert.equal(res.accessible, true);
  assert.equal(res.matchingFiles, 3);
  const withoutPattern = build();
  await testFolderAccess({ path: PATH, credentialId: 'cred-1' }, actor, withoutPattern.deps);
  assert.equal(withoutPattern.calls[0].pattern, '*');
});
