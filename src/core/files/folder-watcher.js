'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { matchesPattern, describeFsError } = require('./paths');
const { readWhenComplete } = require('./file-stability');
const { sha256 } = require('./fingerprint');

const HEALTH_OK = 'ok';
const HEALTH_UNREACHABLE = 'folder_unreachable';

/**
 * Vigila una carpeta (sin subcarpetas): fs.watch marca candidatos (con rebote) y un barrido
 * periódico cubre notificaciones perdidas (habitual en SMB) y archivos llegados con el servicio parado.
 *
 * handlers.shouldProcess({ path, name, size, mtimeMs }) ⇒ boolean  (evita releer lo ya conocido)
 * handlers.onFileReady({ path, name, size, mtimeMs, buffer, fingerprint })
 * handlers.onHealthChange(state, message)  (solo al cambiar de estado)
 *
 * @returns {{ stop(): void, sweepNow(): Promise<void> }}
 */
function watchFolder(options, handlers, { logger }) {
  const { path: folderPath, pattern, stableMs, sweepMs, debounceMs = 1000 } = options;
  const inFlight = new Set();
  const debounceTimers = new Map();
  let watcher = null;
  let health = null;
  let sweeping = null;
  let stopped = false;

  function setHealth(state, message) {
    if (state === health) return;
    health = state;
    if (state === HEALTH_UNREACHABLE) logger.warn('Carpeta vigilada inaccesible', { path: folderPath, message });
    else logger.info('Carpeta vigilada accesible', { path: folderPath });
    handlers.onHealthChange(state, message);
  }

  async function checkFile(name) {
    if (stopped || !matchesPattern(name, pattern)) return;
    const filePath = path.join(folderPath, name);
    if (inFlight.has(filePath)) return;
    inFlight.add(filePath);
    try {
      const stat = await fsp.stat(filePath);
      if (!stat.isFile()) return;
      if (!handlers.shouldProcess({ path: filePath, name, size: stat.size, mtimeMs: stat.mtimeMs })) return;
      const read = await readWhenComplete(filePath, { stableMs });
      if (!read.ready) {
        logger.debug('Archivo aún no listo', { path: filePath, reason: read.reason });
        return;
      }
      if (stopped) return;
      await handlers.onFileReady({
        path: filePath,
        name,
        size: read.size,
        mtimeMs: read.mtimeMs,
        buffer: read.buffer,
        fingerprint: sha256(read.buffer),
      });
    } catch (err) {
      if (err.code === 'ENOENT') {
        logger.debug('Archivo desaparecido antes de procesarlo', { path: filePath });
        return;
      }
      logger.warn('Error al revisar un archivo de la carpeta vigilada', { path: filePath, error: err.message });
    } finally {
      inFlight.delete(filePath);
    }
  }

  function closeWatcher() {
    if (!watcher) return;
    try {
      watcher.close();
    } catch (err) {
      logger.debug('Error al cerrar fs.watch', { path: folderPath, error: err.message });
    }
    watcher = null;
  }

  function scheduleCheck(name) {
    clearTimeout(debounceTimers.get(name));
    debounceTimers.set(name, setTimeout(() => {
      debounceTimers.delete(name);
      checkFile(name);
    }, debounceMs));
  }

  function ensureWatcher() {
    if (watcher || stopped) return;
    try {
      watcher = fs.watch(folderPath, { persistent: false }, (_event, fileName) => {
        if (fileName) scheduleCheck(String(fileName));
      });
      watcher.on('error', (err) => {
        logger.warn('fs.watch caído; se sigue solo con barridos', { path: folderPath, error: err.message });
        closeWatcher();
      });
    } catch (err) {
      logger.warn('fs.watch no disponible; se sigue solo con barridos', { path: folderPath, error: err.message });
      watcher = null;
    }
  }

  function sweep() {
    if (stopped) return Promise.resolve();
    if (sweeping) return sweeping;
    sweeping = (async () => {
      let entries;
      try {
        entries = await fsp.readdir(folderPath, { withFileTypes: true });
      } catch (err) {
        closeWatcher();
        setHealth(HEALTH_UNREACHABLE, describeFsError(err, folderPath));
        return;
      }
      setHealth(HEALTH_OK, null);
      ensureWatcher();
      const names = entries.filter((e) => e.isFile() && matchesPattern(e.name, pattern)).map((e) => e.name);
      await Promise.all(names.map(checkFile));
    })().finally(() => { sweeping = null; });
    return sweeping;
  }

  const sweepTimer = setInterval(sweep, sweepMs);
  sweepTimer.unref();
  sweep();

  return {
    sweepNow: sweep,
    stop() {
      stopped = true;
      clearInterval(sweepTimer);
      for (const timer of debounceTimers.values()) clearTimeout(timer);
      debounceTimers.clear();
      closeWatcher();
    },
  };
}

module.exports = { watchFolder, HEALTH_OK, HEALTH_UNREACHABLE };
