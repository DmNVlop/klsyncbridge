'use strict';

require('../helpers/test-env');
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApiConfig } = require('../../src/modules/api-configs/api-configs.service');
const { resolveApiConfig, loadApiConfig } = require('../../src/core/resources/api-config-resolver');

test('resolveApiConfig: descifra y une cabecera de API key con cabeceras fijas', async () => {
  const created = createApiConfig({
    name: 'ardis',
    base_url: 'https://app.example.com/api',
    endpoint_path: '/orders-v2/external/ardis-xml-imports',
    method: 'POST',
    headers_json: { 'X-Factory': 'LAMI' },
    auth_type: 'api_key',
    auth_config: { key_name: 'X-API-Key', key_value: 'secreto', in: 'header' },
  });
  const resolved = await resolveApiConfig(created.id);
  assert.equal(resolved.apiConfig.base_url, 'https://app.example.com/api');
  assert.equal(resolved.apiConfig.auth_config.key_value, 'secreto');
  assert.deepEqual(resolved.headers, { 'X-API-Key': 'secreto', 'X-Factory': 'LAMI' });
  assert.deepEqual(resolved.params, {});
  assert.equal(resolved.onTokenExpired, null);
});

test('API key en query ⇒ va en params', async () => {
  const created = createApiConfig({
    name: 'q', base_url: 'https://x', endpoint_path: '/y', method: 'POST',
    auth_type: 'api_key', auth_config: { key_name: 'key', key_value: 'v', in: 'query' },
  });
  const resolved = await resolveApiConfig(created.id);
  assert.deepEqual(resolved.params, { key: 'v' });
});

test('id inexistente ⇒ NotFoundError', () => {
  assert.throws(() => loadApiConfig('no-existe'), { code: 'NOT_FOUND' });
});
