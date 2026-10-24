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
