'use strict';

const { z } = require('zod/v4');
const { watchFolder } = require('../../../../core/files/folder-watcher');
const { normalizeItemKey, isAbsoluteWindowsPath } = require('../../../../core/files/paths');

const configSchema = z.object({
  path: z.string().trim().min(1, 'Indica la carpeta')
    .refine(isAbsoluteWindowsPath, 'Usa una ruta absoluta local (C:\\…) o de red (\\\\servidor\\recurso\\…)')
    .meta({ title: 'Carpeta a vigilar', description: 'Local (C:\\…) o de red (\\\\servidor\\recurso\\…). Solo esa carpeta, sin subcarpetas.' }),
  pattern: z.string().trim().min(1).default('*.xml')
    .meta({ title: 'Patrón de archivos', description: 'Comodines * y ?, sin distinguir mayúsculas.' }),
  stableSeconds: z.number().int().min(2).max(300).default(10)
    .meta({ title: 'Segundos sin cambios para dar el archivo por completo' }),
  sweepSeconds: z.number().int().min(15).max(3600).default(60)
    .meta({ title: 'Revisión completa de la carpeta cada (segundos)' }),
});

/**
 * Disparador fino: compone watchFolder (core) y traduce sus eventos al contexto del motor.
 * ctx = { logger, enqueue, isKnownUnchanged, setHealth }
 */
function createInstance(config) {
  let handle = null;
  return {
    start(ctx) {
      handle = watchFolder(
        {
          path: config.path,
          pattern: config.pattern,
          stableMs: config.stableSeconds * 1000,
          sweepMs: config.sweepSeconds * 1000,
        },
        {
          shouldProcess: (file) => !ctx.isKnownUnchanged(normalizeItemKey(file.path), { size: file.size, mtimeMs: file.mtimeMs }),
          onFileReady: (file) => ctx.enqueue({
            itemKey: normalizeItemKey(file.path),
            displayName: file.name,
            fingerprint: file.fingerprint,
            meta: { path: file.path, size: file.size, mtimeMs: file.mtimeMs },
          }),
          onHealthChange: (state, message) => ctx.setHealth(state, message),
        },
        { logger: ctx.logger },
      );
    },
    stop() {
      if (handle) handle.stop();
      handle = null;
    },
    sweepNow() {
      return handle ? handle.sweepNow() : Promise.resolve();
    },
  };
}

module.exports = {
  type: 'folder_watch',
  version: 1,
  title: 'Carpeta vigilada',
  description: 'Detecta archivos nuevos o modificados en una carpeta local o de red, cuando han terminado de copiarse.',
  configSchema,
  createInstance,
};
