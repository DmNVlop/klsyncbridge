'use strict';

const { parseFormats } = require('../../core/outputs');

/** Traduce las columnas del job a la configuración común de las salidas de core/outputs. */
function buildFileOutputConfig(job, fieldMaps) {
  return {
    outputDir: job.output_dir,
    baseName: job.table_or_view,
    formats: parseFormats(job.file_formats),
    delimiter: job.csv_delimiter || ';',
    retention: job.file_retention,
    headers: fieldMaps.map(f => f.api_field),
    storeName: job.std_store_name || null,
    header: job.std_header || {},
    jobName: job.name,
    jobId: job.id,
  };
}

/**
 * Estado final según destinos activos. httpOutcome: 'skipped'|'success'|'partial'|'error';
 * fileStatus: null (no se ejecutó) | 'success' | 'warning' | 'error'.
 */
function combineOutcome({ wantsEndpoint, wantsFile, httpOutcome, fileStatus }) {
  const parts = [];
  if (wantsEndpoint) parts.push(httpOutcome === 'skipped' ? 'success' : httpOutcome);
  if (wantsFile) parts.push(fileStatus === null || fileStatus === undefined ? 'success' : (fileStatus === 'warning' ? 'partial' : fileStatus));
  if (parts.every(p => p === 'success')) return 'success';
  if (parts.every(p => p === 'error')) return 'error';
  return 'partial';
}

module.exports = { buildFileOutputConfig, combineOutcome };
