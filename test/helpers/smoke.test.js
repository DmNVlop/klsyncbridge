'use strict';

const { getDb, rootDir } = require('./test-env');
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

test('la BD de test vive en temporal, nunca en data/', () => {
  const dbPath = getDb().name;
  assert.ok(dbPath.startsWith(rootDir), `BD fuera del temporal: ${dbPath}`);
  assert.ok(!dbPath.includes(`${path.sep}KLSyncBridge${path.sep}data`));
});
