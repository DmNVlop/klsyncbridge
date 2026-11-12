'use strict';

const fsp = require('fs/promises');
const path = require('path');
const { z } = require('zod/v4');
const { AUTOMATION_OUTCOMES: O } = require('../../../../config/constants');
const { findReader } = require('../../../../core/readers');
const { runPipeline } = require('../../../../core/data-pipeline');
const { findByType } = require('../../../../core/outputs');
const { NetworkAccessError } = require('../../../../core/network/net-errors');
const { isValidWindowsFileName } = require('../../../../utils/validators');
const { credentialAccess } = require('../../../credentials/credential-access.service');

const MAX_REASONS = 20;
const FILE_RETRYABLE_CODES = new Set(['EBUSY', 'EPERM', 'EACCES', 'EAGAIN', 'ETIMEDOUT', 'STD_WRITE_FAILED']);

const OUTPUT_TYPES = ['ardis_std', 'csv', 'json', 'endpoint'];
const nonEmpty = (value) => typeof value === 'string' && value.trim() !== '';

const configSchema = z.object({
  mappingTemplateId: z.string().min(1, 'Elige la plantilla de mapeo')
    .meta({ title: 'Plantilla de mapeo', description: 'Se carga en cada ejecución: si la editas, el cambio se aplica al siguiente fichero.', resource: 'mapping_template' }),
  readerFormat: z.enum(['auto', 'csv', 'excel']).default('auto')
    .meta({ title: 'Formato del fichero de entrada', description: 'Auto = según la extensión (.csv/.txt o .xlsx/.xls).' }),
  delimiter: z.string().trim().max(1).optional()
    .meta({ title: 'Delimitador (CSV)', description: 'Vacío = se detecta entre ; , y tabulador.' }),
  encoding: z.enum(['utf8', 'latin1']).optional().meta({ title: 'Codificación (CSV)' }),
  hasHeader: z.boolean().default(true).meta({ title: 'La primera fila es la cabecera' }),
  sheetName: z.string().trim().optional().meta({ title: 'Hoja (Excel)', description: 'Vacío = la primera.' }),
  outputType: z.enum(OUTPUT_TYPES).meta({ title: 'Salida', description: 'ardis_std = almacén de tableros .STD; csv/json = fichero; endpoint = API.' }),
  outputDir: z.string().trim().optional().meta({ title: 'Carpeta de salida', description: 'Para .STD, CSV y JSON. Admite rutas UNC.' }),
  outputCredentialId: z.string().optional()
    .meta({ title: 'Credencial de red de la salida', description: 'Solo si la carpeta de salida es UNC y necesita usuario.', resource: 'network_credential' }),
  stdStoreName: z.string().trim().optional().meta({ title: 'Nombre del almacén .STD', description: 'Sin extensión.' }),
  stdRest: z.string().trim().optional().meta({ title: 'Almacén de retales asociado (REST)' }),
  stdAlgmach: z.string().trim().optional().meta({ title: 'Máquina por defecto (ALGMACH)' }),
  csvDelimiter: z.string().trim().max(1).optional().meta({ title: 'Delimitador del CSV de salida', description: 'Por defecto ;' }),
  apiConfigId: z.string().optional().meta({ title: 'Configuración de API de destino', resource: 'api_config' }),
  itemType: z.string().trim().optional().meta({ title: 'Tipo de elemento', description: 'Si se indica, cada elemento enviado lleva type con este valor.' }),
  batchSize: z.number().int().min(1).max(5000).optional().meta({ title: 'Tamaño de lote', description: 'Elementos por petición (por defecto 500).' }),
}).superRefine((config, ctx) => {
  const fail = (field, message) => ctx.addIssue({ code: 'custom', path: [field], message });
  if (config.outputType !== 'endpoint' && !nonEmpty(config.outputDir)) fail('outputDir', 'Indica la carpeta de salida');
  if (config.outputType === 'ardis_std' && !isValidWindowsFileName(config.stdStoreName)) {
    fail('stdStoreName', 'Indica el nombre del almacén .STD: sin \\ / : * ? " < > |, sin punto ni espacio final y distinto de CON, PRN, AUX, NUL, COM1-9 o LPT1-9');
  }
  if (config.outputType === 'endpoint' && !nonEmpty(config.apiConfigId)) fail('apiConfigId', 'Elige la configuración de API');
});

function readerOptions(config) {
  const options = { has_header: config.hasHeader };
  if (nonEmpty(config.delimiter)) options.delimiter = config.delimiter;
  if (config.encoding) options.encoding = config.encoding;
  if (nonEmpty(config.sheetName)) options.sheet_name = config.sheetName;
  return options;
}

function fileConfig(format, ctx, template) {
  const { config } = ctx;
  return {
    outputDir: config.outputDir,
    baseName: template.name,
    formats: [format],
    delimiter: config.csvDelimiter || ';',
    retention: 'keep_all',
    headers: template.fields.map((f) => f.api_field),
    jobName: template.name,
    jobId: null,
  };
}

/**
 * Salidas disponibles por `outputType` (declarativo, sin `if` por tipo en la ejecución):
 *   output: salida de core/outputs; buildConfig(ctx, template) ⇒ config de la salida;
 *   usesFolder ⇒ escribe en carpeta (acceso con credencial de red si se configuró).
 */
const OUTPUT_TARGETS = {
  ardis_std: {
    output: findByType('ardis_std'),
    usesFolder: true,
    buildConfig: (ctx) => ({
      outputDir: ctx.config.outputDir,
      storeName: ctx.config.stdStoreName,
      header: Object.fromEntries([['REST', ctx.config.stdRest], ['ALGMACH', ctx.config.stdAlgmach]].filter(([, v]) => nonEmpty(v))),
      jobId: null,
    }),
  },
  csv: { output: findByType('file'), usesFolder: true, buildConfig: (ctx, template) => fileConfig('csv', ctx, template) },
  json: { output: findByType('file'), usesFolder: true, buildConfig: (ctx, template) => fileConfig('json', ctx, template) },
  endpoint: {
    output: findByType('endpoint'),
    usesFolder: false,
    buildConfig: (ctx) => {
      const { apiConfig, headers, params, onTokenExpired } = ctx.resources.apiConfigId;
      return { apiConfig, headers, params, onTokenExpired, itemType: ctx.config.itemType || undefined, batchSize: ctx.config.batchSize };
    },
  },
};

/** Error de la salida ⇒ resultado del paso: reintentable ⇒ retry; necesita a una persona ⇒ halt. */
function mapWriteError(err) {
  const message = err.message || 'Error al escribir la salida';
  if (err instanceof NetworkAccessError || typeof err.retryable === 'boolean') {
    return { outcome: err.retryable ? O.RETRY : O.HALT, result: { message } };
  }
  if (FILE_RETRYABLE_CODES.has(err.code)) return { outcome: O.RETRY, result: { message } };
  // Ruta, nombre o configuración inválidos (AppError 4xx): lo arregla una persona
  if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) return { outcome: O.HALT, result: { message } };
  return { outcome: O.RETRY, result: { message } };
}

async function readRecords(ctx, item) {
  let buffer;
  try {
    buffer = await fsp.readFile(item.meta.path);
  } catch (err) {
    if (err.code === 'ENOENT') return { failure: { outcome: O.INVALID, result: { message: 'El archivo ya no está en la carpeta' } } };
    return { failure: { outcome: O.RETRY, result: { message: `No se pudo leer el archivo: ${err.message}` } } };
  }
  try {
    const reader = findReader({ format: ctx.config.readerFormat, fileName: item.display_name || path.basename(item.meta.path) });
    return { records: reader.readAll({ buffer, options: readerOptions(ctx.config) }) };
  } catch (err) {
    return { failure: { outcome: O.INVALID, result: { message: `No se pudo interpretar el archivo: ${err.message}` } } };
  }
}

/**
 * Lee el fichero, aplica filtro y mapeo de la plantilla viva y lo escribe en la salida elegida.
 * ctx.resources.mappingTemplateId = plantilla; ctx.resources.apiConfigId = { apiConfig, headers, params, onTokenExpired }.
 */
async function run(ctx, item) {
  const template = ctx.resources.mappingTemplateId;
  if (!template) return { outcome: O.HALT, result: { message: 'La plantilla de mapeo ya no existe: elige otra en el paso' } };

  const { records, failure } = await readRecords(ctx, item);
  if (failure) return failure;

  const { items, filteredOut } = runPipeline({
    records, filterExpression: template.filter_expression, fields: template.fields, logMeta: { template: template.name },
  });
  if (items.length === 0) {
    return { outcome: O.INVALID, result: { read: records.length, written: 0, discarded: filteredOut, message: 'El fichero no tiene filas válidas: no se escribe nada' } };
  }

  const target = OUTPUT_TARGETS[ctx.config.outputType];
  const outputConfig = target.buildConfig(ctx, template);
  const write = () => target.output.write({ items, config: outputConfig });
  const credentialId = ctx.config.outputCredentialId;
  let outcome;
  try {
    outcome = target.usesFolder && credentialId
      ? await credentialAccess.withFolderAccess({ path: ctx.config.outputDir, credentialId }, write)
      : await write();
  } catch (err) {
    ctx.logger.warn('Fallo al escribir la salida del paso map_export', { file: item.display_name, output: ctx.config.outputType, error: err.message });
    return mapWriteError(err);
  }

  const result = {
    read: records.length,
    written: outcome.written,
    discarded: (outcome.discardedCount || 0) + filteredOut,
    firstReasons: outcome.message ? [outcome.message].slice(0, MAX_REASONS) : [],
    filePaths: outcome.filePaths,
  };
  if (outcome.written === 0) return { outcome: O.INVALID, result: { ...result, message: outcome.message || 'No se escribió ninguna fila' } };
  return { outcome: O.DONE, result };
}

module.exports = {
  type: 'map_export',
  version: 1,
  title: 'Transformar y exportar (plantilla de mapeo)',
  description: 'Lee el fichero, aplica la plantilla de mapeo y lo exporta como almacén .STD, CSV/JSON o a una API.',
  configSchema,
  concurrency: 1,
  run,
  OUTPUT_TARGETS,
};
