'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseVersion,
  isValidVersion,
  semverIncrement,
  compareVersions,
} = require('../../scripts/release');

test('isValidVersion acepta estables y rc con N >= 1', () => {
  for (const v of ['2.3.1', '0.0.0', '2.4.0-rc.1', '2.4.0-rc.10']) {
    assert.equal(isValidVersion(v), true, v);
  }
});

test('isValidVersion rechaza formatos no soportados', () => {
  for (const v of ['2.4', '2.4.0-rc', '2.4.0-rc.0', '2.4.0-rc.01', '2.4.0-beta.1', '2.4.0-alpha.1', '2.4.0-rc.1.2', 'v2.4.0', '', null, undefined]) {
    assert.equal(isValidVersion(v), false, String(v));
  }
});

test('parseVersion devuelve las partes y rc nulo en estables', () => {
  assert.deepEqual(parseVersion('2.4.0-rc.3'), { major: 2, minor: 4, patch: 0, rc: 3 });
  assert.deepEqual(parseVersion('2.3.1'), { major: 2, minor: 3, patch: 1, rc: null });
  assert.equal(parseVersion('x'), null);
});

test('semverIncrement desde estable no cambia', () => {
  assert.equal(semverIncrement('2.3.1', 'patch'), '2.3.2');
  assert.equal(semverIncrement('2.3.1', 'minor'), '2.4.0');
  assert.equal(semverIncrement('2.3.1', 'major'), '3.0.0');
  assert.equal(semverIncrement('2.3.1', 'PATCH'), '2.3.2');
  assert.equal(semverIncrement('2.3.1', 'otro'), null);
});

test('semverIncrement rc desde estable es null (versión explícita obligatoria)', () => {
  assert.equal(semverIncrement('2.3.1', 'rc'), null);
});

test('semverIncrement rc desde rc suma 1', () => {
  assert.equal(semverIncrement('2.4.0-rc.1', 'rc'), '2.4.0-rc.2');
  assert.equal(semverIncrement('2.4.0-rc.9', 'rc'), '2.4.0-rc.10');
});

test('semverIncrement desde rc finaliza según reglas semver', () => {
  assert.equal(semverIncrement('2.4.0-rc.3', 'patch'), '2.4.0');
  assert.equal(semverIncrement('2.4.0-rc.3', 'minor'), '2.4.0');
  assert.equal(semverIncrement('2.4.0-rc.3', 'major'), '3.0.0');
  assert.equal(semverIncrement('3.0.0-rc.1', 'major'), '3.0.0');
  assert.equal(semverIncrement('2.4.1-rc.1', 'patch'), '2.4.1');
  assert.equal(semverIncrement('2.4.1-rc.1', 'minor'), '2.5.0');
});

test('semverIncrement con versión inválida devuelve null', () => {
  assert.equal(semverIncrement('2.4', 'patch'), null);
  assert.equal(semverIncrement('2.4.0-beta.1', 'rc'), null);
});

test('compareVersions ordena estables', () => {
  assert.ok(compareVersions('2.4.0', '2.3.9') > 0);
  assert.ok(compareVersions('2.3.1', '2.4.0') < 0);
  assert.equal(compareVersions('2.3.1', '2.3.1'), 0);
  assert.ok(compareVersions('10.0.0', '9.9.9') > 0);
});

test('compareVersions ordena prereleases correctamente', () => {
  assert.ok(compareVersions('2.4.0-rc.1', '2.4.0-rc.2') < 0);
  assert.ok(compareVersions('2.4.0-rc.2', '2.4.0') < 0);
  assert.ok(compareVersions('2.4.0', '2.4.0-rc.2') > 0);
  assert.ok(compareVersions('2.3.1', '2.4.0-rc.1') < 0);
  assert.ok(compareVersions('2.4.0-rc.1', '2.3.1') > 0);
  assert.ok(compareVersions('2.4.0-rc.10', '2.4.0-rc.2') > 0);
  assert.equal(compareVersions('2.4.0-rc.2', '2.4.0-rc.2'), 0);
});

test('compareVersions lanza con versiones no válidas', () => {
  assert.throws(() => compareVersions('2.4.0-beta.1', '2.4.0'));
});
