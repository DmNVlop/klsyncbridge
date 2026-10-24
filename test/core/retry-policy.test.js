'use strict';

require('../helpers/test-env');
const test = require('node:test');
const assert = require('node:assert/strict');
const { nextRetryAt } = require('../../src/core/retry/retry-policy');
const { AUTOMATION_RETRY } = require('../../src/config/constants');

const NOW = Date.parse('2026-10-24T10:00:00.000Z');

test('esperas 1 min, 5 min, 15 min, 1 h y luego se agota', () => {
  assert.equal(nextRetryAt(1, AUTOMATION_RETRY, NOW), '2026-10-24T10:01:00.000Z');
  assert.equal(nextRetryAt(2, AUTOMATION_RETRY, NOW), '2026-10-24T10:05:00.000Z');
  assert.equal(nextRetryAt(3, AUTOMATION_RETRY, NOW), '2026-10-24T10:15:00.000Z');
  assert.equal(nextRetryAt(4, AUTOMATION_RETRY, NOW), '2026-10-24T11:00:00.000Z');
  assert.equal(nextRetryAt(5, AUTOMATION_RETRY, NOW), null);
});

test('más intentos que esperas ⇒ repite la última', () => {
  assert.equal(nextRetryAt(3, { delaysMs: [1000], maxAttempts: 10 }, NOW), '2026-10-24T10:00:01.000Z');
});
