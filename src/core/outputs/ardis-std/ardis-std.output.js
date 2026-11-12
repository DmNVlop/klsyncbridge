'use strict';

const fs = require('fs');
const { resolveConfiguredPath } = require('../../files/paths');
const { AppError } = require('../../../utils/errors');
const { FILE_FORMATS } = require('../../../config/constants');
const logger = require('../../../services/logger.service');
const { buildStdContent } = require('./std-content');
const { writeStdFile } = require('./std-file');

const MAX_REASONS = 20;

function describeDiscarded(discarded) {
  const shown = discarded.slice(0, MAX_REASONS)
    .map(d => `fila ${d.row}${d.label ? ` (${d.label})` : ''}: ${d.reason}`)
    .join('; ');
  const more = discarded.length > MAX_REASONS ? `; y ${discarded.length - MAX_REASONS} más` : '';
  const noun = discarded.length === 1 ? 'registro descartado' : 'registros descartados';
  return `${discarded.length} ${noun}: ${shown}${more}`;
}

/** Almacén de tableros de Ardis: un fichero completo por ejecución (la fuente de verdad es el ERP). */
async function write({ items, config, now = new Date() }) {
  if (!config.outputDir) throw new AppError('output_dir no configurado para el almacén .STD', 'INVALID_PATH', 400);
  if (!config.storeName) throw new AppError('Falta el nombre del almacén .STD', 'INVALID_STD_STORE', 400);

  const { content, written, discarded } = buildStdContent({
    header: config.header || {},
    records: items.map(i => i.payload ?? i),
    date: now,
  });
  const base = { discardedCount: discarded.length };
  if (discarded.length > 0) {
    logger.warn(`Almacén .STD «${config.storeName}»: registros descartados`, {
      job_id: config.jobId, discarded: discarded.length, first: discarded.slice(0, MAX_REASONS),
    });
  }
  if (written === 0) {
    return {
      ...base, status: 'warning', filePaths: [], written: 0, unchanged: false,
      message: `No se ha escrito el almacén «${config.storeName}»: 0 registros válidos (se conserva el anterior).`
        + (discarded.length ? ` ${describeDiscarded(discarded)}` : ''),
    };
  }

  const dir = resolveConfiguredPath(config.outputDir);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const { filePath, changed } = await writeStdFile({ dir, storeName: config.storeName, content });
  logger.info(`Almacén .STD «${config.storeName}» ${changed ? 'actualizado' : 'sin cambios'}`, {
    job_id: config.jobId, filePath, written,
  });
  return {
    ...base,
    status: discarded.length ? 'warning' : 'success',
    filePaths: [filePath],
    written,
    unchanged: !changed,
    message: discarded.length ? describeDiscarded(discarded) : null,
  };
}

module.exports = { type: 'ardis_std', formats: [FILE_FORMATS.ARDIS_STD], fullSet: true, write };
