'use strict';

const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { z } = require('zod');
const env = require('../../../config/env');
const logger = require('../../../services/logger.service');
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

/** Bytes en MB con una cifra decimal y coma (p. ej. «35,5 MB»). */
function formatMb(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

/**
 * Siguiente tramo de progreso a informar (múltiplo de `stepPct`), o null si no se ha cruzado ninguno nuevo
 * o si no se conoce el tamaño total.
 */
function nextProgressStep(received, total, lastStep, stepPct = 10) {
  if (!total || total <= 0) return null;
  const pct = Math.min(100, Math.floor((received / total) * 100));
  const step = pct - (pct % stepPct);
  return step > lastStep ? step : null;
}

async function download(url, filePath, onProgress = () => {}) {
  const response = await axios.get(url, { responseType: 'stream', timeout: 120000, maxRedirects: 5 });
  const total = Number(response.headers?.['content-length']) || 0;
  let received = 0;
  response.data.on('data', (chunk) => {
    received += chunk.length;
    onProgress(received, total);
  });
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(filePath);
    response.data.pipe(out);
    out.on('finish', resolve);
    out.on('error', reject);
    response.data.on('error', reject);
  });
}

/** Descarga y valida el manifiesto del último Release. */
async function fetchInstallerManifest() {
  const { data } = await axios.get(manifestUrlFor('installer'), { timeout: 8000 });
  return assertManifest(data);
}

/** Descarga el Setup a <DATA_DIR>/../updates y comprueba su sha256; si no coincide, lo borra y lanza error. */
async function downloadVerifiedSetup(manifest, { log }) {
  const updatesDir = path.resolve(env.DATA_DIR, '..', 'updates');
  fs.mkdirSync(updatesDir, { recursive: true });
  const setupPath = path.join(updatesDir, `KLSyncBridge-Setup-${manifest.version}.exe`);

  log(`▶ Descargando v${manifest.version}...`);
  const startedAt = Date.now();
  let lastStep = 0;
  let size = 0;
  // La UI lee estas líneas («Descargando … N %») para pintar el progreso de la fase de descarga.
  await download(manifest.setupUrl, setupPath, (received, total) => {
    size = received;
    const step = nextProgressStep(received, total, lastStep);
    if (step === null) return;
    lastStep = step;
    log(`▶ Descargando v${manifest.version}... ${step} % (${formatMb(received)} de ${formatMb(total)})`);
  });
  const actual = await sha256File(setupPath);
  if (actual !== manifest.sha256) {
    fs.rmSync(setupPath, { force: true });
    throw new Error('La descarga no coincide con el sha256 publicado; se ha descartado');
  }
  const seconds = Math.round((Date.now() - startedAt) / 1000);
  logger.info('System: Setup descargado y verificado', { version: manifest.version, bytes: size, seconds });
  log(`✅ Descarga verificada (${formatMb(size)} en ${seconds} s)`);
  return setupPath;
}

/** Lanza el Setup desacoplado de este proceso (sobrevive a la parada del servicio). */
function launchSetupDetached(setupPath, logPath) {
  const child = spawn('cmd.exe', ['/d', '/s', '/c', buildSetupCommand(setupPath, logPath)], {
    detached: true,
    stdio: 'ignore',
    windowsVerbatimArguments: true,
  });
  child.unref();
}

// Devuelve true si el Setup quedó lanzado (el llamador no libera el cerrojo: el proceso morirá).
async function runInstallerUpdate({ res, log, localVersion }) {
  try {
    const current = localVersion();
    const manifest = await fetchInstallerManifest();
    if (compareVersions(manifest.version, current) <= 0) {
      log(`ℹ️ Ya estás en la última versión (v${current})`);
      res.end();
      return false;
    }

    const logPath = path.join(path.resolve(env.LOG_DIR), `setup-${manifest.version}.log`);
    const setupPath = await downloadVerifiedSetup(manifest, { log });

    log(`▶ Lanzando el instalador (log: ${logPath}). El servicio se reiniciará solo.`);
    // La UI espera esta línea para pasar a «esperando reinicio» (mismo texto que el final de legacy-zip).
    log(`✅ Actualización completada: instalando v${manifest.version}, el servicio vuelve en 1-2 minutos.`);
    res.end();
    launchSetupDetached(setupPath, logPath);
    return true;
  } catch (err) {
    log(`❌ Error durante la actualización: ${err.message}`);
    log('ℹ️ No se ha cambiado nada: sigue la versión actual.');
    res.end();
    return false;
  }
}

/** Política de versión de la migración: el mismo Release o uno posterior sirve; uno anterior, no. */
function assertMigrationVersion(manifestVersion, localVersion) {
  if (compareVersions(manifestVersion, localVersion) < 0) {
    throw new Error(`El último instalador publicado (v${manifestVersion}) es más antiguo que la versión instalada (v${localVersion})`);
  }
}

/**
 * Paso de una instalación antigua (legacy-zip) al instalador. Devuelve true si el Setup quedó lanzado.
 */
async function runInstallerMigration({ res, log, localVersion, username }) {
  try {
    const current = localVersion();
    const manifest = await fetchInstallerManifest();
    assertMigrationVersion(manifest.version, current);

    const logPath = path.join(path.resolve(env.LOG_DIR), `setup-migration-${manifest.version}.log`);
    const setupPath = await downloadVerifiedSetup(manifest, { log });

    log(`▶ Lanzando el instalador (log: ${logPath}). El servicio se detendrá y volverá en 1-2 minutos.`);
    logger.info('System: lanzando Setup de migración al instalador', { user: username, version: manifest.version });
    log(`✅ Actualización completada: pasando al instalador (v${manifest.version}), el servicio vuelve en 1-2 minutos.`);
    res.end();
    launchSetupDetached(setupPath, logPath);
    return true;
  } catch (err) {
    log(`❌ Error durante el paso al instalador: ${err.message}`);
    log('ℹ️ No se ha cambiado nada: sigue la instalación actual.');
    res.end();
    return false;
  }
}

module.exports = {
  runInstallerUpdate, runInstallerMigration, fetchInstallerManifest, downloadVerifiedSetup, launchSetupDetached,
  assertMigrationVersion, sha256File, buildSetupCommand, assertManifest, formatMb, nextProgressStep,
};
