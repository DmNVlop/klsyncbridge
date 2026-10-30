'use strict';

const GITHUB_USER = 'DmNVlop';
const GITHUB_REPO = 'klsyncbridge';

const MANIFEST_URLS = {
  installer: `https://github.com/${GITHUB_USER}/${GITHUB_REPO}/releases/latest/download/version.json`,
  'legacy-zip': `https://raw.githubusercontent.com/${GITHUB_USER}/${GITHUB_REPO}/master/version.json`,
};

const LEGACY_ZIP_URL = `https://github.com/${GITHUB_USER}/${GITHUB_REPO}/archive/refs/heads/master.zip`;

function manifestUrlFor(mode) {
  return MANIFEST_URLS[mode];
}

function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

module.exports = { manifestUrlFor, compareVersions, LEGACY_ZIP_URL };
