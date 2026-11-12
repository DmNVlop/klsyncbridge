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
