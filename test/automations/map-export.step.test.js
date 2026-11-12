'use strict';

const { makeTempDir } = require('../helpers/test-env');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const silentLogger = require('../helpers/silent-logger');
const { steps } = require('../../src/modules/automations/plugins/registry');
const step = require('../../src/modules/automations/plugins/steps/map-export.step');
const engine = require('../../src/modules/automations/automations.engine');
const templates = require('../../src/modules/mapping-templates/mapping-templates.service');
const { AppError } = require('../../src/utils/errors');
const { NetworkAccessError } = require('../../src/core/network/net-errors');
const { EndpointOutputError } = require('../../src/core/outputs/endpoint.output');

const actor = { id: 'u1', username: 't' };
const stdFields = [
  { api_field: 'MATERIAAL', source_type: 'field', sql_field: 'CODIGO', transform: 'trim' },
  { api_field: 'LENGTE', source_type: 'field', sql_field: 'LARGO' },
  { api_field: 'BREEDTE', source_type: 'field', sql_field: 'ANCHO' },
  { api_field: 'DIKTE', source_type: 'field', sql_field: 'ESPESOR' },
];

let counter = 0;
function makeTemplate(overrides = {}) {
  counter += 1;
  return templates.createTemplate({ name: `Stock paso ${counter}`, target_kind: 'ardis_std', fields: stdFields, ...overrides }, actor);
}

function makeItem(text = 'CODIGO;LARGO;ANCHO;ESPESOR\nA1;2800;2070;19\nB2;2440;1220;16\n', name = 'stock.csv') {
  const filePath = path.join(makeTempDir(), name);
  fs.writeFileSync(filePath, text);
  return { id: 'i1', display_name: name, meta: { path: filePath } };
}

const baseConfig = { mappingTemplateId: 'x', outputType: 'ardis_std', outputDir: 'C:\\salida', stdStoreName: 'Stock' };

function makeCtx(template, overrides = {}) {
  const config = steps.parseConfig('map_export', { ...baseConfig, ...(overrides.config || {}) });
  return { config, resources: { mappingTemplateId: template, ...(overrides.resources || {}) }, logger: silentLogger };
}

// Sustituye la salida de un tipo por una falsa durante un test
function fakeOutput(t, type, write) {
  const target = step.OUTPUT_TARGETS[type];
  const original = target.output;
  target.output = { ...original, write };
  t.after(() => { target.output = original; });
}

const okWrite = (calls) => async ({ items, config }) => {
  calls.push({ items, config });
  return { status: 'success', filePaths: ['C:\\salida\\Stock.STD'], written: items.length, discardedCount: 0, unchanged: false, message: null };
};

test('done: contadores y configuración de la salida .STD', async (t) => {
  const calls = [];
  fakeOutput(t, 'ardis_std', okWrite(calls));
  const ctx = makeCtx(makeTemplate(), { config: { stdRest: 'RETALES', stdAlgmach: 'M1' } });
  const res = await step.run(ctx, makeItem());
  assert.equal(res.outcome, 'done');
  assert.equal(res.result.read, 2);
  assert.equal(res.result.written, 2);
  assert.deepEqual(res.result.filePaths, ['C:\\salida\\Stock.STD']);
  assert.equal(calls[0].items[0].payload.MATERIAAL, 'A1');
  assert.equal(calls[0].config.storeName, 'Stock');
  assert.deepEqual(calls[0].config.header, { REST: 'RETALES', ALGMACH: 'M1' });
});

test('el filtro de la plantilla descarta filas y se cuenta', async (t) => {
  fakeOutput(t, 'ardis_std', okWrite([]));
  const template = makeTemplate({ filter_expression: 'LARGO > 2500' });
  const res = await step.run(makeCtx(template), makeItem());
  assert.equal(res.outcome, 'done');
  assert.equal(res.result.written, 1);
  assert.equal(res.result.discarded, 1);
});

test('invalid: 0 filas válidas ⇒ no escribe', async (t) => {
  const calls = [];
  fakeOutput(t, 'ardis_std', okWrite(calls));
  const template = makeTemplate({ filter_expression: 'LARGO > 99999' });
  const res = await step.run(makeCtx(template), makeItem());
  assert.equal(res.outcome, 'invalid');
  assert.equal(calls.length, 0);
});

test('invalid: la salida descarta todas las filas (written 0)', async (t) => {
  fakeOutput(t, 'ardis_std', async () => ({
    status: 'warning', filePaths: [], written: 0, discardedCount: 2, unchanged: false, message: '2 registros descartados',
  }));
  const res = await step.run(makeCtx(makeTemplate()), makeItem());
  assert.equal(res.outcome, 'invalid');
  assert.match(res.result.message, /descartados/);
});

test('invalid: fichero desaparecido o formato no legible', async (t) => {
  fakeOutput(t, 'ardis_std', okWrite([]));
  const ctx = makeCtx(makeTemplate());
  const gone = await step.run(ctx, { display_name: 'x.csv', meta: { path: path.join(makeTempDir(), 'nada.csv') } });
  assert.equal(gone.outcome, 'invalid');
  const bad = await step.run(ctx, makeItem('x', 'stock.pdf'));
  assert.equal(bad.outcome, 'invalid');
});

test('halt: plantilla no encontrada (recurso nulo) y plantilla borrada en el resolver', async () => {
  const none = await step.run(makeCtx(null), makeItem());
  assert.equal(none.outcome, 'halt');
  const template = makeTemplate();
  templates.deleteTemplate(template.id, actor);
  await assert.rejects(
    engine.resolveResources([{ field: 'mappingTemplateId', resource: 'mapping_template' }], { mappingTemplateId: template.id }),
    /no encontrad/,
  );
});

const WRITE_ERRORS = [
  ['red no reintentable (credencial)', new NetworkAccessError({ kind: 'credential', message: 'acceso denegado', retryable: false }), 'halt'],
  ['red reintentable', new NetworkAccessError({ kind: 'network', message: 'sin red', retryable: true }), 'retry'],
  ['fichero ocupado EBUSY', Object.assign(new Error('busy'), { code: 'EBUSY' }), 'retry'],
  ['STD_WRITE_FAILED', new AppError('ocupado', 'STD_WRITE_FAILED', 500), 'retry'],
  ['ruta inválida', new AppError('ruta', 'INVALID_PATH', 400), 'halt'],
  ['API 5xx', new EndpointOutputError('503', { retryable: true, httpStatus: 503 }), 'retry'],
  ['API 403', new EndpointOutputError('403', { retryable: false, httpStatus: 403 }), 'halt'],
];
for (const [label, error, expected] of WRITE_ERRORS) {
  test(`errores de la salida: ${label} ⇒ ${expected}`, async (t) => {
    fakeOutput(t, 'ardis_std', async () => { throw error; });
    const res = await step.run(makeCtx(makeTemplate()), makeItem());
    assert.equal(res.outcome, expected);
  });
}

test('salida endpoint: usa la api_config resuelta, itemType y batchSize', async (t) => {
  const calls = [];
  fakeOutput(t, 'endpoint', okWrite(calls));
  const ctx = makeCtx(makeTemplate({ target_kind: 'api' }), {
    config: { outputType: 'endpoint', apiConfigId: 'cfg', itemType: 'stock', batchSize: 10, outputDir: undefined },
    resources: { apiConfigId: { apiConfig: { base_url: 'https://a' }, headers: { h: 1 }, params: {}, onTokenExpired: null } },
  });
  const res = await step.run(ctx, makeItem());
  assert.equal(res.outcome, 'done');
  assert.equal(calls[0].config.itemType, 'stock');
  assert.equal(calls[0].config.batchSize, 10);
  assert.equal(calls[0].config.apiConfig.base_url, 'https://a');
});

test('salida csv/json: escribe un fichero real en la carpeta de salida', async () => {
  const dir = makeTempDir();
  const template = makeTemplate({ target_kind: 'api' });
  for (const outputType of ['csv', 'json']) {
    const res = await step.run(makeCtx(template, { config: { outputType, outputDir: dir } }), makeItem());
    assert.equal(res.outcome, 'done');
    assert.ok(fs.existsSync(res.result.filePaths[0]));
    assert.ok(res.result.filePaths[0].endsWith(`.${outputType}`));
  }
});

test('plantilla viva: editarla cambia el resultado de la siguiente ejecución', async (t) => {
  fakeOutput(t, 'ardis_std', okWrite([]));
  const template = makeTemplate();
  const config = { mappingTemplateId: template.id };
  const run = async () => {
    const resources = await engine.resolveResources([{ field: 'mappingTemplateId', resource: 'mapping_template' }], config);
    return step.run(makeCtx(resources.mappingTemplateId), makeItem());
  };
  assert.equal((await run()).result.written, 2);
  templates.updateTemplate(template.id, { ...template, filter_expression: 'LARGO > 2500' }, actor);
  assert.equal((await run()).result.written, 1);
});

test('resolveResources: campo de recurso opcional vacío ⇒ null; network_credential ⇒ id', async () => {
  const resolved = await engine.resolveResources(
    [{ field: 'apiConfigId', resource: 'api_config' }, { field: 'outputCredentialId', resource: 'network_credential' }],
    { outputCredentialId: 'cred-1' },
  );
  assert.equal(resolved.apiConfigId, null);
  assert.equal(resolved.outputCredentialId, 'cred-1');
});

test('registro: recursos detectados del schema', () => {
  const fields = steps.resourceFields('map_export').map((f) => `${f.field}:${f.resource}`).sort();
  assert.deepEqual(fields, ['apiConfigId:api_config', 'mappingTemplateId:mapping_template', 'outputCredentialId:network_credential']);
});

test('validación de configuración', () => {
  const parse = (extra) => () => steps.parseConfig('map_export', { ...baseConfig, ...extra });
  assert.doesNotThrow(parse({}));
  assert.throws(parse({ stdStoreName: undefined }), /no válida/);
  assert.throws(parse({ stdStoreName: 'a:b' }), /no válida/);
  assert.throws(parse({ outputDir: undefined }), /no válida/);
  assert.throws(parse({ outputType: 'endpoint', outputDir: undefined }), /no válida/);
  assert.doesNotThrow(parse({ outputType: 'endpoint', outputDir: undefined, apiConfigId: 'cfg' }));
  assert.throws(parse({ outputType: 'xml' }), /no válida/);
  assert.equal(steps.parseConfig('map_export', baseConfig).hasHeader, true);
  assert.equal(steps.parseConfig('map_export', baseConfig).readerFormat, 'auto');
});
