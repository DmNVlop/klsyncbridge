'use strict';

require('../helpers/test-env');
const test = require('node:test');
const assert = require('node:assert/strict');
const outputs = require('../../src/core/outputs');

test('parseFormats: lista normalizada; vacío => csv', () => {
  assert.deepEqual(outputs.parseFormats(' CSV , json '), ['csv', 'json']);
  assert.deepEqual(outputs.parseFormats(null), ['csv']);
});

test('findByFormats: csv/json => file', () => {
  assert.equal(outputs.findByFormats('csv,json').type, 'file');
});

test('findByFormats: formato desconocido => error', () => {
  assert.throws(() => outputs.findByFormats('xml'), /Formato de salida no soportado: xml/);
});
