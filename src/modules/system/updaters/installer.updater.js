'use strict';

const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { z } = require('zod');
const env = require('../../../config/env');
const { manifestUrlFor, compareVersions } = require('./manifest');

const SETUP_URL_PREFIX = 'https://github.com/DmNVlop/klsyncbridge/releases/download/';

const manifestSchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  setupUrl: z.string().startsWith(SETUP_URL_PREFIX),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});

function assertManifest(manifest) {
  const parsed = manifestSchema.safeParse(manifest);
  if (!parsed.success) throw new Error('Manifiesto de actualización inválido: ' + JSON.stringify(parsed.error.flatten().fieldErrors));
  return parsed.data;
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(filePath)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject);
  });
}

// `start ""` deja el Setup huérfano: el envoltorio del servicio no lo mata al pararse (mismo patrón que legacy-zip).
function buildSetupCommand(setupPath, logPath) {
  return `start "" "${setupPath}" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /LOG="${logPath}"`;
}

async function download(url, filePath) {
  const response = await axios.get(url, { responseType: 'stream', timeout: 120000, maxRedirects: 5 });
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(filePath);
    response.data.pipe(out);
    out.on('finish', resolve);
    out.on('error', reject);
    response.data.on('error', reject);
  });
}

async function runInstallerUpdate({ res, log, localVersion }) {
  try {
    const current = localVersion();
    const { data } = await axios.get(manifestUrlFor('installer'), { timeout: 8000 });
    const manifest = assertManifest(data);
    if (compareVersions(manifest.version, current) <= 0) {
      log(`ℹ️ Ya estás en la última versión (v${current})`);
      return res.end();
    }

    const updatesDir = path.resolve(env.DATA_DIR, '..', 'updates');
    fs.mkdirSync(updatesDir, { recursive: true });
    const setupPath = path.join(updatesDir, `KLSyncBridge-Setup-${manifest.version}.exe`);
    const logPath = path.join(path.resolve(env.LOG_DIR), `setup-${manifest.version}.log`);

    log(`▶ Descargando v${manifest.version}...`);
    await download(manifest.setupUrl, setupPath);
    const actual = await sha256File(setupPath);
    if (actual !== manifest.sha256) {
      fs.rmSync(setupPath, { force: true });
      throw new Error('La descarga no coincide con el sha256 publicado; se ha descartado');
    }
    log('✅ Descarga verificada');

    log(`▶ Lanzando el instalador (log: ${logPath}). El servicio se reiniciará solo.`);
    res.end();
    const child = spawn('cmd.exe', ['/d', '/s', '/c', buildSetupCommand(setupPath, logPath)], {
      detached: true,
      stdio: 'ignore',
      windowsVerbatimArguments: true,
    });
    child.unref();
    return undefined;
  } catch (err) {
    log(`❌ Error durante la actualización: ${err.message}`);
    log('ℹ️ No se ha cambiado nada: sigue la versión actual.');
    return res.end();
  }
}

module.exports = { runInstallerUpdate, sha256File, buildSetupCommand, assertManifest };
