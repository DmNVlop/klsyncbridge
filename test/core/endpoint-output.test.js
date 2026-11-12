'use strict';

require('../helpers/test-env');
const test = require('node:test');
const assert = require('node:assert/strict');
const outputs = require('../../src/core/outputs');
const endpoint = require('../../src/core/outputs/endpoint.output');

const apiConfig = { base_url: 'https://api.test', endpoint_path: '/stock', method: 'post' };
const makeItems = (n) => Array.from({ length: n }, (_, i) => ({ payload: { code: `C${i}` } }));

function fakeSend(calls, behaviour = () => ({ status: 200 })) {
  return async (requestConfig) => {
    calls.push(requestConfig);
    return behaviour(requestConfig, calls.length);
  };
}

function httpError(status) {
  const err = new Error(`HTTP ${status}`);
  err.response = { status };
  return err;
}

test('findByType: devuelve la salida por tipo y falla con uno desconocido', () => {
  assert.equal(outputs.findByType('endpoint').type, 'endpoint');
  assert.equal(outputs.findByType('ardis_std').type, 'ardis_std');
  assert.equal(outputs.findByType('file').type, 'file');
  assert.throws(() => outputs.findByType('xml'), /Tipo de salida no soportado: xml/);
});

test('findByFormats no cambia: endpoint no atiende formatos de fichero', () => {
  assert.equal(outputs.findByFormats('csv').type, 'file');
  assert.throws(() => outputs.findByFormats('endpoint'), /no soportado/);
});

test('endpoint: envía lotes de batchSize como array JSON', async () => {
  const calls = [];
  const result = await endpoint.write({
    items: makeItems(5),
    config: { apiConfig, headers: { 'X-API-Key': 'k' }, params: { a: 1 }, batchSize: 2, send: fakeSend(calls) },
  });
  assert.equal(calls.length, 3);
  assert.deepEqual(calls.map((c) => c.data.length), [2, 2, 1]);
  assert.equal(calls[0].url, 'https://api.test/stock');
  assert.equal(calls[0].method, 'post');
  assert.equal(calls[0].headers['X-API-Key'], 'k');
  assert.equal(calls[0].headers['Content-Type'], 'application/json');
  assert.deepEqual(calls[0].params, { a: 1 });
  assert.equal(result.written, 5);
  assert.equal(result.status, 'success');
  assert.deepEqual(result.filePaths, []);
});

test('endpoint: lote por defecto 500 y type solo si hay itemType', async () => {
  const calls = [];
  await endpoint.write({ items: makeItems(501), config: { apiConfig, send: fakeSend(calls) } });
  assert.deepEqual(calls.map((c) => c.data.length), [500, 1]);
  assert.equal(calls[0].data[0].type, undefined);

  const typed = [];
  await endpoint.write({ items: makeItems(1), config: { apiConfig, itemType: 'stock', send: fakeSend(typed) } });
  assert.deepEqual(typed[0].data[0], { code: 'C0', type: 'stock' });
});

test('endpoint: 5xx, 429 y sin respuesta son reintentables; 400 no', async () => {
  const cases = [[httpError(503), true], [httpError(429), true], [new Error('ECONNREFUSED'), true], [httpError(400), false], [httpError(403), false]];
  for (const [error, retryable] of cases) {
    await assert.rejects(
      endpoint.write({ items: makeItems(1), config: { apiConfig, send: async () => { throw error; } } }),
      (err) => err.name === 'EndpointOutputError' && err.retryable === retryable,
    );
  }
});

test('endpoint: 401 renueva el token una vez y reintenta el lote', async () => {
  const calls = [];
  let renewed = 0;
  const send = fakeSend(calls, (cfg, n) => { if (n === 1) throw httpError(401); return { status: 200 }; });
  const result = await endpoint.write({
    items: makeItems(1),
    config: { apiConfig, headers: { Authorization: 'old' }, send, onTokenExpired: async () => { renewed++; return { Authorization: 'new' }; } },
  });
  assert.equal(renewed, 1);
  assert.equal(calls[1].headers.Authorization, 'new');
  assert.equal(result.written, 1);
});

test('endpoint: un segundo 401 no es reintentable', async () => {
  await assert.rejects(
    endpoint.write({ items: makeItems(1), config: { apiConfig, send: async () => { throw httpError(401); }, onTokenExpired: async () => ({}) } }),
    (err) => err.retryable === false && err.httpStatus === 401,
  );
});

test('endpoint: sin configuración de API ⇒ error de validación', async () => {
  await assert.rejects(endpoint.write({ items: makeItems(1), config: {} }), /configuración de API/);
});
