'use strict';

/**
 * Comprobación de actualizaciones en el servidor: al arrancar y cada 6 h, sin depender de que alguien abra la UI.
 * Guarda el último resultado en memoria; la UI lo lee sin salir a internet (GET /api/update-status).
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const logger = require('../../services/logger.service');
const { getUpdateMode } = require('./updaters/update-mode');
const { manifestUrlFor, compareVersions } = require('./updaters/manifest');

const INITIAL_DELAY_MS = 60 * 1000;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

const UPDATE_STATUS = Object.freeze({
  UNKNOWN: 'unknown',
  UP_TO_DATE: 'up-to-date',
  UPDATE_AVAILABLE: 'update-available',
  NO_RELEASE: 'no-release',
  ERROR: 'error',
});

function localVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../package.json'), 'utf8'));
    return pkg.version || '0.0.0';
  } catch (err) {
    logger.warn('No se pudo leer la versión local', { error: err.message });
    return '0.0.0';
  }
}

async function fetchManifest(mode) {
  const { data } = await axios.get(manifestUrlFor(mode), { timeout: 8000 });
  return data;
}

/** Dependencias inyectables para poder probarlo sin red. */
function createUpdateChecker({ getVersion = localVersion, getMode = getUpdateMode, fetch = fetchManifest, now = () => new Date() } = {}) {
  let lastResult = null;

  async function checkNow() {
    const current = getVersion();
    const mode = getMode();
    const base = { current, mode, checkedAt: now().toISOString() };
    try {
      const manifest = await fetch(mode);
      const latest = manifest.version;
      const hasUpdate = compareVersions(latest, current) > 0;
      lastResult = {
        ...base,
        status: hasUpdate ? UPDATE_STATUS.UPDATE_AVAILABLE : UPDATE_STATUS.UP_TO_DATE,
        latest,
        hasUpdate,
        changelog: manifest.changelog || '',
        release_date: manifest.release_date || '',
      };
    } catch (err) {
      // 404 en modo installer = aún no hay ningún Release publicado (los prerelease no cuentan): no es un error.
      const noRelease = err.response && err.response.status === 404;
      lastResult = {
        ...base,
        status: noRelease ? UPDATE_STATUS.NO_RELEASE : UPDATE_STATUS.ERROR,
        hasUpdate: false,
        error: noRelease ? null : err.message,
      };
      if (!noRelease) logger.warn('Comprobación de actualizaciones fallida', { error: err.message });
    }
    return lastResult;
  }

  function getLastResult() {
    return lastResult || { status: UPDATE_STATUS.UNKNOWN, current: getVersion(), mode: getMode(), hasUpdate: false, checkedAt: null };
  }

  /** Arranca las comprobaciones periódicas; devuelve la función que las para. Los temporizadores no retienen el proceso. */
  function startPeriodicChecks({ initialDelayMs = INITIAL_DELAY_MS, intervalMs = CHECK_INTERVAL_MS } = {}) {
    const run = () => {
      checkNow()
        .then((r) => logger.info('Comprobación de actualizaciones', { status: r.status, current: r.current, latest: r.latest }))
        .catch((err) => logger.error('Error inesperado comprobando actualizaciones', { error: err.message }));
    };
    const first = setTimeout(run, initialDelayMs);
    const every = setInterval(run, intervalMs);
    first.unref();
    every.unref();
    return () => {
      clearTimeout(first);
      clearInterval(every);
    };
  }

  return { checkNow, getLastResult, startPeriodicChecks };
}

const updateChecker = createUpdateChecker();

module.exports = { updateChecker, createUpdateChecker, localVersion, UPDATE_STATUS };
