'use strict';

require('../helpers/test-env');
const test = require('node:test');
const assert = require('node:assert/strict');
const { z } = require('zod/v4');
const { createRegistry } = require('../../src/core/plugins/registry');
const { ValidationError } = require('../../src/utils/errors');

const plugin = {
  type: 'demo',
  version: 1,
  title: 'Demo',
  description: 'Plugin de prueba',
  configSchema: z.object({
    target: z.string().min(1, 'Obligatorio').meta({ title: 'Destino', resource: 'api_config' }),
    retries: z.number().int().min(0).max(5).default(2).meta({ title: 'Reintentos' }),
  }),
};

test('alta, búsqueda y duplicados', () => {
  const registry = createRegistry('paso');
  registry.register(plugin);
  assert.equal(registry.get('demo'), plugin);
  assert.equal(registry.has('demo'), true);
  assert.throws(() => registry.register(plugin), /duplicado/);
  assert.throws(() => registry.get('otro'), ValidationError);
});

test('parseConfig aplica valores por defecto y devuelve errores por campo', () => {
  const registry = createRegistry('paso');
  registry.register(plugin);
  assert.deepEqual(registry.parseConfig('demo', { target: 'abc' }), { target: 'abc', retries: 2 });
  assert.throws(() => registry.parseConfig('demo', { retries: 9 }), (err) => {
    assert.ok(err instanceof ValidationError);
    assert.ok(err.details.target);
    assert.ok(err.details.retries);
    return true;
  });
});

test('list expone JSON Schema de entrada y resourceFields detecta recursos', () => {
  const registry = createRegistry('paso');
  registry.register(plugin);
  const [item] = registry.list();
  assert.equal(item.type, 'demo');
  assert.equal(item.title, 'Demo');
  assert.equal(item.configSchema.properties.target.resource, 'api_config');
  assert.equal(item.configSchema.properties.retries.default, 2);
  assert.deepEqual(item.configSchema.required, ['target']);
  assert.deepEqual(registry.resourceFields('demo'), [{ field: 'target', resource: 'api_config' }]);
});
