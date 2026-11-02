'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildManifest } = require('../../scripts/build-release-manifest');

test('buildManifest añade setupUrl del tag y sha256 a version.json', () => {
  const m = buildManifest({
    versionInfo: { version: '2.3.0', release_date: '2026-11-02', changelog: '- Instalador' },
    tag: 'v2.3.0',
    sha256: 'b'.repeat(64),
  });
  assert.deepEqual(m, {
    version: '2.3.0',
    release_date: '2026-11-02',
    changelog: '- Instalador',
    setupUrl: 'https://github.com/DmNVlop/klsyncbridge/releases/download/v2.3.0/KLSyncBridge-Setup-2.3.0.exe',
    sha256: 'b'.repeat(64),
  });
});

test('en un prerelease la URL usa el tag completo', () => {
  const m = buildManifest({ versionInfo: { version: '2.3.0' }, tag: 'v2.3.0-rc.1', sha256: 'c'.repeat(64) });
  assert.equal(m.setupUrl, 'https://github.com/DmNVlop/klsyncbridge/releases/download/v2.3.0-rc.1/KLSyncBridge-Setup-2.3.0.exe');
});
