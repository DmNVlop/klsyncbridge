'use strict';

require('../helpers/test-env');
const test = require('node:test');
const assert = require('node:assert/strict');
const { applyTransform } = require('../../src/core/data-pipeline/transforms');
const { evaluateExpression, matchesFilter } = require('../../src/core/data-pipeline/expressions');

test('applyTransform: default si nulo, number, uppercase, none', () => {
  assert.equal(applyTransform(null, 'none', 'X'), 'X');
  assert.equal(applyTransform(undefined, 'none', undefined), null);
  assert.equal(applyTransform('19.5', 'number'), 19.5);
  assert.equal(applyTransform('abc', 'uppercase'), 'ABC');
  assert.equal(applyTransform(' a ', 'trim'), 'a');
  assert.equal(applyTransform(1, 'boolean'), true);
  assert.equal(applyTransform(7, 'string'), '7');
});

test('evaluateExpression: usa columnas como variables; error ⇒ null', () => {
  assert.equal(evaluateExpression('LARGO * 10', { LARGO: 280 }), 2800);
  assert.equal(evaluateExpression('NO_EXISTE + 1', { A: 1 }), null);
});

test('matchesFilter: sin expresión ⇒ true; verdadero/falso; error ⇒ true', () => {
  assert.equal(matchesFilter({ A: 1 }, null), true);
  assert.equal(matchesFilter({ A: 1 }, 'A > 0'), true);
  assert.equal(matchesFilter({ A: 0 }, 'A > 0'), false);
  assert.equal(matchesFilter({ A: 0 }, 'NO_EXISTE > 0'), true);
});

const { buildPayload, runPipeline } = require('../../src/core/data-pipeline');

test('buildPayload: campo, fijo, expresión, transform, default y clave anidada', () => {
  const fields = [
    { api_field: 'MATERIAAL', sql_field: 'COD', source_type: 'field', transform: 'trim' },
    { api_field: 'NOLIMIT', source_type: 'static', default_value: '0' },
    { api_field: 'LENGTE', source_type: 'expression', expression: 'LARGO * 10', transform: 'number' },
    { api_field: 'BEM', sql_field: 'DESC', source_type: 'field', default_value: 'sin descripción' },
    { api_field: 'a.b', sql_field: 'COD' },
  ];
  assert.deepEqual(buildPayload({ COD: ' F186 ', LARGO: 280, DESC: null }, fields), {
    MATERIAAL: 'F186', NOLIMIT: '0', LENGTE: 2800, BEM: 'sin descripción', a: { b: ' F186 ' },
  });
});

test('runPipeline: filtra y mapea todas las filas', () => {
  const records = [{ COD: 'A', STOCK: 3 }, { COD: 'B', STOCK: 0 }, { COD: 'C', STOCK: 5 }];
  const fields = [{ api_field: 'MATERIAAL', sql_field: 'COD' }];
  const { items, filteredOut } = runPipeline({ records, filterExpression: 'STOCK > 0', fields });
  assert.deepEqual(items.map(i => i.payload), [{ MATERIAAL: 'A' }, { MATERIAAL: 'C' }]);
  assert.equal(items[1].record.COD, 'C');
  assert.equal(filteredOut, 1);
});
