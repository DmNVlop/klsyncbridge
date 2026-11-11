'use strict';

require('../helpers/test-env');
const test = require('node:test');
const assert = require('node:assert/strict');
const { startFakeServer } = require('../helpers/fake-http-server');
const { sendOnce, summarizeBody } = require('../../src/core/http/send-once');
const { buildMultipart } = require('../../src/core/http/multipart');
const { classifyHttpError } = require('../../src/core/http/classify');
const { requestWithRetry, categorizeError } = require('../../src/services/http.service');

test('sendOnce: un intento con validateStatus libre devuelve 4xx sin lanzar', async (t) => {
  const server = await startFakeServer(() => ({ status: 409, json: { status: 'REJECTED_STARTED' } }));
  t.after(() => server.close());
  const res = await sendOnce({ method: 'post', url: `${server.baseUrl}/x`, data: { a: 1 }, validateStatus: () => true });
  assert.equal(res.status, 409);
  assert.equal(res.data.status, 'REJECTED_STARTED');
  assert.equal(server.requests.length, 1);
});

test('sendOnce: sin respuesta ⇒ lanza el error de axios con durationMs', async () => {
  await assert.rejects(sendOnce({ method: 'get', url: 'http://127.0.0.1:1/nada', timeout: 2000 }), (err) => {
    assert.equal(typeof err.durationMs, 'number');
    assert.equal(classifyHttpError(err), 'CONNECTION_ERROR');
    return true;
  });
});

test('buildMultipart: el servidor recibe el archivo con su nombre en el campo file', async (t) => {
  const server = await startFakeServer(() => ({ status: 201, json: {} }));
  t.after(() => server.close());
  const form = buildMultipart({ fieldName: 'file', buffer: Buffer.from('<Ardis/>'), fileName: 'ARD-1.XML', contentType: 'application/xml' });
  await sendOnce({ method: 'post', url: `${server.baseUrl}/up`, data: form, validateStatus: () => true });
  const req = server.requests[0];
  assert.match(req.headers['content-type'], /^multipart\/form-data; boundary=/);
  const body = req.body.toString();
  assert.match(body, /name="file"; filename="ARD-1.XML"/);
  assert.match(body, /Content-Type: application\/xml/);
  assert.match(body, /<Ardis\/>/);
});

test('summarizeBody resume multipart por nombres de campo', () => {
  const form = buildMultipart({ fieldName: 'file', buffer: Buffer.from('x'), fileName: 'a.xml' });
  assert.deepEqual(summarizeBody(form), { _type: 'multipart', fields: ['file'] });
});

test('classifyHttpError por código HTTP', () => {
  const withStatus = (status) => ({ response: { status } });
  assert.equal(classifyHttpError(withStatus(401)), 'AUTH_ERROR');
  assert.equal(classifyHttpError(withStatus(429)), 'RATE_LIMIT');
  assert.equal(classifyHttpError(withStatus(404)), 'CLIENT_ERROR');
  assert.equal(classifyHttpError(withStatus(503)), 'SERVER_ERROR');
  assert.equal(categorizeError, classifyHttpError);
});

test('requestWithRetry sigue devolviendo la respuesta en 2xx (regresión jobs)', async (t) => {
  const server = await startFakeServer(() => ({ status: 200, json: { ok: true } }));
  t.after(() => server.close());
  const res = await requestWithRetry({ method: 'post', url: `${server.baseUrl}/batch`, data: [{ id: 1 }] });
  assert.equal(res.status, 200);
  assert.deepEqual(res.data, { ok: true });
});

test('requestWithRetry: 401 tras renovar el token se abandona (una sola renovación, sin bucle)', async (t) => {
  const server = await startFakeServer(() => ({ status: 401, json: { error: 'unauthorized' } }));
  t.after(() => server.close());
  let renewals = 0;
  const onTokenExpired = async () => { renewals++; return { Authorization: `Bearer t${renewals}` }; };
  await assert.rejects(
    requestWithRetry({ method: 'get', url: `${server.baseUrl}/x` }, { onTokenExpired }),
    (err) => { assert.equal(err.category, 'AUTH_ERROR'); return true; },
  );
  assert.equal(renewals, 1);
  assert.equal(server.requests.length, 2);
  assert.equal(server.requests[1].headers.authorization, 'Bearer t1');
});

test('requestWithRetry: 401 y renovación correcta ⇒ devuelve la respuesta', async (t) => {
  const server = await startFakeServer((req) => (req.headers.authorization === 'Bearer nuevo'
    ? { status: 200, json: { ok: true } }
    : { status: 401, json: {} }));
  t.after(() => server.close());
  const res = await requestWithRetry({ method: 'get', url: `${server.baseUrl}/x` }, { onTokenExpired: async () => ({ Authorization: 'Bearer nuevo' }) });
  assert.equal(res.status, 200);
  assert.equal(server.requests.length, 2);
});
