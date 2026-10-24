'use strict';

const { makeTempDir } = require('../helpers/test-env');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startFakeServer } = require('../helpers/fake-http-server');
const silentLogger = require('../helpers/silent-logger');
const { steps } = require('../../src/modules/automations/plugins/registry');
const step = require('../../src/modules/automations/plugins/steps/ardis-xml-import.step');

let server;
let reply = { status: 201, json: {} };

test.before(async () => { server = await startFakeServer(() => reply); });
test.after(() => server.close());

function makeItem(name = 'ARD-1.XML', content = '<Ardis/>') {
  const filePath = path.join(makeTempDir(), name);
  fs.writeFileSync(filePath, content);
  return { id: 'i1', display_name: name, meta: { path: filePath } };
}

function makeCtx(overrides = {}) {
  return {
    config: steps.parseConfig('ardis_xml_import', { api_config_id: 'cfg' }),
    resources: {
      api_config_id: {
        apiConfig: { auth_type: 'api_key', base_url: `${server.baseUrl}/api/` },
        headers: { 'X-API-Key': 'k', 'Content-Type': 'application/json' },
        params: {},
      },
    },
    logger: silentLogger,
    ...overrides,
  };
}

const CASES = [
  { status: 201, json: { status: 'CREATED', orderNumber: 'ARD-1', version: 1, sentToProduction: true, message: 'Creado' }, outcome: 'done' },
  { status: 200, json: { status: 'UPDATED', orderNumber: 'ARD-1', version: 2 }, outcome: 'done' },
  { status: 200, json: { status: 'UNCHANGED', orderNumber: 'ARD-1', version: 1 }, outcome: 'done' },
  { status: 409, json: { status: 'REJECTED_STARTED', message: 'La OF ya empezó' }, outcome: 'rejected' },
  { status: 409, json: { status: 'REJECTED_CLOSED' }, outcome: 'rejected' },
  { status: 422, json: { status: 'INVALID_XML', message: 'No es Ardis' }, outcome: 'invalid' },
  { status: 413, json: {}, outcome: 'invalid' },
  { status: 400, json: { message: 'Bad' }, outcome: 'halt' },
  { status: 401, json: {}, outcome: 'halt' },
  { status: 403, json: { message: 'Forbidden' }, outcome: 'halt' },
  { status: 404, json: {}, outcome: 'halt' },
  { status: 500, json: {}, outcome: 'retry' },
  { status: 503, json: {}, outcome: 'retry' },
  { status: 200, json: { raro: true }, outcome: 'retry' },
  { status: 418, json: {}, outcome: 'retry' },
  { status: 422, json: { status: 'OTRO' }, outcome: 'retry' },
];

for (const c of CASES) {
  test(`HTTP ${c.status} ${c.json.status || '(sin status)'} ⇒ ${c.outcome}`, async () => {
    reply = { status: c.status, json: c.json };
    const res = await step.run(makeCtx(), makeItem());
    assert.equal(res.outcome, c.outcome);
    assert.equal(res.result.http_status, c.status);
    assert.match(res.result.fingerprint, /^[0-9a-f]{64}$/);
  });
}

test('done guarda nº de pedido, versión y envío a fábrica', async () => {
  reply = { status: 201, json: { status: 'CREATED', orderNumber: 'ARD-063160', version: 1, sentToProduction: false, message: 'Creado' } };
  const { result } = await step.run(makeCtx(), makeItem());
  assert.equal(result.status, 'CREATED');
  assert.equal(result.external_ref, 'ARD-063160');
  assert.equal(result.external_version, 1);
  assert.equal(result.sent_to_production, false);
  assert.equal(result.message, 'Creado');
});

test('halt 403 explica qué revisar', async () => {
  reply = { status: 403, json: { message: 'Forbidden' } };
  const { result } = await step.run(makeCtx(), makeItem());
  assert.match(result.message, /^Token sin permiso o inválido: revisa la configuración de API/);
});

test('envía multipart a base_url + endpointPath con la API key y sin Content-Type JSON', async () => {
  reply = { status: 201, json: { status: 'CREATED' } };
  const before = server.requests.length;
  await step.run(makeCtx(), makeItem('Pedido X.XML', '<Ardis id="9"/>'));
  const req = server.requests[before];
  assert.equal(req.method, 'POST');
  assert.equal(req.url, '/api/orders-v2/external/ardis-xml-imports');
  assert.equal(req.headers['x-api-key'], 'k');
  assert.match(req.headers['content-type'], /^multipart\/form-data/);
  assert.match(req.body.toString(), /filename="Pedido X.XML"/);
});

test('más de 5 MB ⇒ invalid sin llamar a la plataforma', async () => {
  const before = server.requests.length;
  const res = await step.run(makeCtx(), makeItem('grande.xml', Buffer.alloc(5 * 1024 * 1024 + 1, 'a')));
  assert.equal(res.outcome, 'invalid');
  assert.equal(res.result.message, 'El archivo supera 5 MB');
  assert.equal(server.requests.length, before);
});

test('archivo borrado antes de enviarlo ⇒ invalid', async () => {
  const item = makeItem();
  fs.unlinkSync(item.meta.path);
  const res = await step.run(makeCtx(), item);
  assert.equal(res.outcome, 'invalid');
  assert.equal(res.result.message, 'El archivo ya no está en la carpeta');
});

test('configuración de API sin API key ⇒ halt', async () => {
  const ctx = makeCtx();
  ctx.resources.api_config_id.apiConfig.auth_type = 'bearer';
  const res = await step.run(ctx, makeItem());
  assert.equal(res.outcome, 'halt');
});

test('sin respuesta de la plataforma ⇒ retry', async () => {
  const ctx = makeCtx();
  ctx.resources.api_config_id.apiConfig.base_url = 'http://127.0.0.1:1';
  const res = await step.run(ctx, makeItem());
  assert.equal(res.outcome, 'retry');
  assert.match(res.result.message, /^Sin respuesta de la plataforma/);
});

test('mapImportResponse decide por HTTP y status, nunca por message', () => {
  assert.equal(step.mapImportResponse(201, { status: 'CREATED', message: 'error raro' }).outcome, 'done');
  assert.equal(step.mapImportResponse(200, { message: 'CREATED' }).outcome, 'retry');
});
