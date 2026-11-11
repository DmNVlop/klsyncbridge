'use strict';

require('../helpers/test-env');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validate, createNetworkCredentialSchema, updateNetworkCredentialSchema, testNetworkCredentialSchema,
} = require('../../src/utils/validators');
const { ValidationError } = require('../../src/utils/errors');

test('alta mínima OK y dominio vacío ⇒ null', () => {
  const data = validate(createNetworkCredentialSchema, { name: ' NAS ', domain: '  ', username: 'svc', password: 'x' });
  assert.equal(data.name, 'NAS');
  assert.equal(data.domain, null);
});

test('alta sin username ⇒ ValidationError', () => {
  assert.throws(() => validate(createNetworkCredentialSchema, { name: 'NAS', password: 'x' }), ValidationError);
});

test('update sin password o con vacío es válido y no la incluye', () => {
  assert.equal(validate(updateNetworkCredentialSchema, { name: 'Otro' }).password, undefined);
  assert.equal(validate(updateNetworkCredentialSchema, { password: '' }).password, undefined);
  assert.equal(validate(updateNetworkCredentialSchema, { password: 'nueva' }).password, 'nueva');
});

test('test con ruta local ⇒ mensaje de solo rutas UNC', () => {
  try {
    validate(testNetworkCredentialSchema, { path: 'C:\\datos', username: 'u' });
    assert.fail('debía fallar');
  } catch (err) {
    assert.ok(err instanceof ValidationError);
    assert.match(JSON.stringify(err.details), /solo aplican a rutas/);
  }
});

test('test exige credentialId o username', () => {
  assert.throws(() => validate(testNetworkCredentialSchema, { path: '\\\\srv\\rec' }), ValidationError);
  const ok = validate(testNetworkCredentialSchema, { path: '\\\\srv\\rec', username: 'u', password: 'p', checkWrite: true });
  assert.equal(ok.username, 'u');
});
