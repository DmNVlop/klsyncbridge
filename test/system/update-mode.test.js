'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getUpdateMode } = require('../../src/modules/system/updaters/update-mode');
const { manifestUrlFor, compareVersions } = require('../../src/modules/system/updaters/manifest');

test('con KLSYNC_ENV_FILE el modo es installer', () => {
  assert.equal(getUpdateMode({ KLSYNC_ENV_FILE: 'C:\\ProgramData\\KLSyncBridge\\.env' }), 'installer');
});

test('sin KLSYNC_ENV_FILE el modo es legacy-zip', () => {
  assert.equal(getUpdateMode({}), 'legacy-zip');
});

test('cada modo lee su manifiesto', () => {
  assert.match(manifestUrlFor('installer'), /\/releases\/latest\/download\/version\.json$/);
  assert.match(manifestUrlFor('legacy-zip'), /raw\.githubusercontent\.com\/.+\/master\/version\.json$/);
});

test('compareVersions', () => {
  assert.ok(compareVersions('2.3.0', '2.2.9') > 0);
  assert.equal(compareVersions('2.3.0', '2.3.0'), 0);
  assert.ok(compareVersions('2.2.0', '2.10.0') < 0);
});
