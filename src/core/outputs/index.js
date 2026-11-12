'use strict';

/**
 * Registro de salidas de datos.
 *
 * Contrato de una salida:
 * {
 *   type: string,                 // 'file' | 'ardis_std' (3b: 'endpoint')
 *   formats: string[],            // valores de jobs.file_formats que atiende
 *   fullSet: boolean,             // true => recibe TODOS los registros mapeados (antes del diff) en cada ejecución
 *   async write({ items, config }) => {
 *     status: 'success' | 'warning',   // warning = escrito con descartes o no escrito por 0 válidos
 *     filePaths: string[],             // ficheros escritos (vacío si no se escribió)
 *     written: number,                 // registros escritos
 *     discardedCount: number,
 *     unchanged: boolean,              // true => contenido igual al existente, no se reescribió
 *     message: string | null,          // texto para execution_logs.error_message si status = warning
 *   }
 * }
 * items: [{ payload }]. config: ver buildFileOutputConfig (src/modules/jobs/jobs.outputs.js).
 * Errores (ruta, permisos, clave inválida) => throw.
 */

const { AppError } = require('../../utils/errors');
const fileOutput = require('./file.output');
const ardisStdOutput = require('./ardis-std/ardis-std.output');

// Alta de una salida nueva = añadirla aquí. Ningún llamador tiene un if por formato.
const OUTPUTS = [fileOutput, ardisStdOutput];

function parseFormats(fileFormats) {
  const list = String(fileFormats || '').split(',').map(f => f.trim().toLowerCase()).filter(Boolean);
  return list.length > 0 ? list : ['csv'];
}

/** Salida que atiende los formatos del job. Todos deben ser de la misma salida (los validadores lo garantizan). */
function findByFormats(fileFormats) {
  const found = new Set();
  for (const format of parseFormats(fileFormats)) {
    const output = OUTPUTS.find(o => o.formats.includes(format));
    if (!output) throw new AppError(`Formato de salida no soportado: ${format}`, 'INVALID_FORMAT', 400);
    found.add(output);
  }
  if (found.size > 1) {
    throw new AppError('Los formatos elegidos pertenecen a salidas distintas y no se pueden combinar', 'INVALID_FORMAT', 400);
  }
  return [...found][0];
}

function listOutputs() { return OUTPUTS.slice(); }

module.exports = { parseFormats, findByFormats, listOutputs };
