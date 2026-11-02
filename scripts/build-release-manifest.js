'use strict';

/**
 * Genera dist/version.json para el GitHub Release (lo usa el workflow de release).
 * Uso: node scripts/build-release-manifest.js
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const RELEASE_BASE = 'https://github.com/DmNVlop/klsyncbridge/releases/download';

function setupFileName(version) {
  return `KLSyncBridge-Setup-${version}.exe`;
}

// tag = el del Release (vX.Y.Z o vX.Y.Z-rc.N): la URL de descarga cuelga del tag, no de la versión.
function buildManifest({ versionInfo, tag, sha256 }) {
  return {
    ...versionInfo,
    setupUrl: `${RELEASE_BASE}/${tag}/${setupFileName(versionInfo.version)}`,
    sha256,
  };
}

function main() {
  const root = path.join(__dirname, '..');
  const tag = process.env.GITHUB_REF_NAME;
  if (!tag) {
    console.error('❌ Falta GITHUB_REF_NAME (tag del Release)');
    process.exit(1);
  }
  const versionInfo = JSON.parse(fs.readFileSync(path.join(root, 'version.json'), 'utf8'));
  const setupPath = path.join(root, 'dist', setupFileName(versionInfo.version));
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(setupPath)).digest('hex');
  fs.writeFileSync(path.join(root, 'dist', 'version.json'), JSON.stringify(buildManifest({ versionInfo, tag, sha256 }), null, 2));
  console.log(`✅ dist/version.json (sha256 ${sha256})`);
}

if (require.main === module) main();

module.exports = { buildManifest, setupFileName };
