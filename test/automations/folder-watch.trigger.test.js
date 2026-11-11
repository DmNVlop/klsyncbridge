'use strict';

const { makeTempDir } = require('../helpers/test-env');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { triggers } = require('../../src/modules/automations/plugins/registry');
const { ValidationError } = require('../../src/utils/errors');
const silentLogger = require('../helpers/silent-logger');

test('configuración por defecto', () => {
  assert.deepEqual(triggers.parseConfig('folder_watch', { path: 'C:\\Ardis\\XML' }), {
    path: 'C:\\Ardis\\XML', pattern: '*.xml', stableSeconds: 10, sweepSeconds: 60,
  });
});

test('rechaza ruta relativa y límites fuera de rango', () => {
  assert.throws(() => triggers.parseConfig('folder_watch', { path: 'xml' }), ValidationError);
  assert.throws(() => triggers.parseConfig('folder_watch', { path: 'C:\\x', stableSeconds: 1 }), ValidationError);
  assert.throws(() => triggers.parseConfig('folder_watch', { path: 'C:\\x', sweepSeconds: 5 }), ValidationError);
});

test('encola con clave normalizada y omite lo conocido sin cambios', async () => {
  const dir = makeTempDir();
  fs.writeFileSync(path.join(dir, 'Pedido1.xml'), '<a/>');
  fs.writeFileSync(path.join(dir, 'Conocido.xml'), '<b/>');
  const enqueued = [];
  const ctx = {
    logger: silentLogger,
    isKnownUnchanged: (itemKey) => itemKey.endsWith('conocido.xml'),
    enqueue: (input) => enqueued.push(input),
    setHealth: () => undefined,
  };
  const config = triggers.parseConfig('folder_watch', { path: dir, stableSeconds: 2, sweepSeconds: 3600 });
  const instance = triggers.get('folder_watch').createInstance(config);
  instance.start(ctx);
  await instance.sweepNow();
  instance.stop();
  assert.equal(enqueued.length, 1);
  const filePath = path.join(dir, 'Pedido1.xml');
  assert.equal(enqueued[0].itemKey, path.win32.normalize(filePath).toLowerCase());
  assert.equal(enqueued[0].displayName, 'Pedido1.xml');
  assert.equal(enqueued[0].meta.path, filePath);
  assert.equal(enqueued[0].meta.size, 4);
  assert.match(enqueued[0].fingerprint, /^[0-9a-f]{64}$/);
});

// ── Credencial de red opcional ───────────────────────────────────────────────

const CREDENTIAL_ID = '3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
const UNC = '\\\\servidor\\recurso\\xml';

test('credentialId: acepta nulo y uuid con ruta UNC', () => {
  assert.equal(triggers.parseConfig('folder_watch', { path: UNC, credentialId: null }).credentialId, null);
  assert.equal(triggers.parseConfig('folder_watch', { path: UNC, credentialId: CREDENTIAL_ID }).credentialId, CREDENTIAL_ID);
  assert.throws(() => triggers.parseConfig('folder_watch', { path: UNC, credentialId: 'no-es-uuid' }), ValidationError);
});

test('credentialId con ruta local ⇒ error de validación', () => {
  assert.throws(
    () => triggers.parseConfig('folder_watch', { path: 'C:\\Ardis\\XML', credentialId: CREDENTIAL_ID }),
    (err) => err instanceof ValidationError && /solo aplican a rutas/.test(JSON.stringify(err.details || err.fieldErrors || err.message)),
  );
});

test('el JSON Schema conserva resource y el registro solo lo ve como recurso de selector', () => {
  const schema = triggers.list().find((t) => t.type === 'folder_watch').configSchema;
  assert.equal(schema.properties.credentialId.resource, 'network_credential');
});

test('createInstance construye el hook ensureAccess solo con credencial', async () => {
  const { credentialAccess } = require('../../src/modules/credentials/credential-access.service');
  const original = credentialAccess.makeEnsureAccess;
  const built = [];
  credentialAccess.makeEnsureAccess = (target) => { built.push(target); return async () => undefined; };
  const dir = makeTempDir();
  const ctx = { logger: silentLogger, isKnownUnchanged: () => false, enqueue: () => undefined, setHealth: () => undefined, halt: () => undefined };
  try {
    const plain = triggers.get('folder_watch').createInstance(triggers.parseConfig('folder_watch', { path: dir }));
    plain.start(ctx);
    await plain.sweepNow();
    plain.stop();
    assert.equal(built.length, 0);

    const withCredential = triggers.get('folder_watch').createInstance({
      path: dir, pattern: '*.xml', stableSeconds: 2, sweepSeconds: 3600, credentialId: CREDENTIAL_ID,
    });
    withCredential.start(ctx);
    await withCredential.sweepNow();
    withCredential.stop();
    assert.deepEqual(built, [{ path: dir, credentialId: CREDENTIAL_ID }]);
  } finally {
    credentialAccess.makeEnsureAccess = original;
  }
});

test('credencial rechazada ⇒ ctx.halt con el mensaje', async () => {
  const { credentialAccess } = require('../../src/modules/credentials/credential-access.service');
  const original = credentialAccess.makeEnsureAccess;
  credentialAccess.makeEnsureAccess = () => async () => { const e = new Error('Credencial incorrecta'); e.kind = 'credential'; throw e; };
  const halts = [];
  const ctx = { logger: silentLogger, isKnownUnchanged: () => false, enqueue: () => undefined, setHealth: () => undefined, halt: (m) => halts.push(m) };
  try {
    const instance = triggers.get('folder_watch').createInstance({
      path: makeTempDir(), pattern: '*.xml', stableSeconds: 2, sweepSeconds: 3600, credentialId: CREDENTIAL_ID,
    });
    instance.start(ctx);
    await instance.sweepNow();
    instance.stop();
    assert.deepEqual(halts, ['Credencial incorrecta']);
  } finally {
    credentialAccess.makeEnsureAccess = original;
  }
});
