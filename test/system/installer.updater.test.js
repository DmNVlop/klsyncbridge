'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { sha256File, buildSetupCommand, assertManifest } = require('../../src/modules/system/updaters/installer.updater');

test('sha256File calcula el hash del fichero', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'klsb-sha-')), 'a.bin');
  fs.writeFileSync(file, 'hola');
  const expected = crypto.createHash('sha256').update('hola').digest('hex');
  assert.equal(await sha256File(file), expected);
});

test('buildSetupCommand lanza el Setup en silencio con log y sin reinicio', () => {
  const cmd = buildSetupCommand('C:\\PD\\updates\\KLSyncBridge-Setup-2.3.0.exe', 'C:\\PD\\logs\\setup-2.3.0.log');
  assert.equal(cmd, 'start "" "C:\\PD\\updates\\KLSyncBridge-Setup-2.3.0.exe" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /LOG="C:\\PD\\logs\\setup-2.3.0.log"');
});

test('assertManifest exige version, setupUrl de GitHub y sha256', () => {
  assert.doesNotThrow(() => assertManifest({
    version: '2.3.0',
    setupUrl: 'https://github.com/DmNVlop/klsyncbridge/releases/download/v2.3.0/KLSyncBridge-Setup-2.3.0.exe',
    sha256: 'a'.repeat(64),
  }));
  assert.throws(() => assertManifest({ version: '2.3.0', setupUrl: 'https://evil.example/x.exe', sha256: 'a'.repeat(64) }));
  assert.throws(() => assertManifest({ version: '2.3.0', setupUrl: 'https://github.com/DmNVlop/klsyncbridge/releases/download/v2.3.0/x.exe' }));
});
