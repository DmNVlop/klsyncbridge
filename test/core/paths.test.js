'use strict';

require('../helpers/test-env');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeItemKey, isUncPath, isAbsoluteWindowsPath, matchesPattern, describeFsError,
} = require('../../src/core/files/paths');
const { sha256 } = require('../../src/core/files/fingerprint');

test('normalizeItemKey: separador \\ y minúsculas', () => {
  assert.equal(normalizeItemKey('C:/Ardis/XML/Pedido.XML'), 'c:\\ardis\\xml\\pedido.xml');
  assert.equal(normalizeItemKey('\\\\SRV\\Share\\A.xml'), '\\\\srv\\share\\a.xml');
});

test('isUncPath', () => {
  assert.equal(isUncPath('\\\\srv\\share\\xml'), true);
  assert.equal(isUncPath('\\\\srv\\share'), true);
  assert.equal(isUncPath('C:\\xml'), false);
});

test('isAbsoluteWindowsPath: unidad o UNC; nunca relativa', () => {
  assert.equal(isAbsoluteWindowsPath('C:\\Ardis'), true);
  assert.equal(isAbsoluteWindowsPath('d:/ardis/xml'), true);
  assert.equal(isAbsoluteWindowsPath('\\\\srv\\share'), true);
  assert.equal(isAbsoluteWindowsPath('xml\\pedidos'), false);
  assert.equal(isAbsoluteWindowsPath('C:xml'), false);
});

test('matchesPattern: comodines * y ?, sin distinguir mayúsculas', () => {
  assert.equal(matchesPattern('A.XML', '*.xml'), true);
  assert.equal(matchesPattern('a.xml.tmp', '*.xml'), false);
  assert.equal(matchesPattern('b.xml', '?.xml'), true);
  assert.equal(matchesPattern('ab.xml', '?.xml'), false);
  assert.equal(matchesPattern('ARD-1 (copia).xml', 'ARD-*.xml'), true);
});

test('describeFsError: mensaje en español y pista de cuenta solo en UNC', () => {
  const unc = describeFsError({ code: 'EACCES' }, '\\\\srv\\share');
  assert.match(unc, /^No se puede acceder a la carpeta: acceso denegado\./);
  assert.match(unc, /LocalSystem/);
  const local = describeFsError({ code: 'ENOENT' }, 'C:\\no-existe');
  assert.equal(local, 'No se puede acceder a la carpeta: la carpeta no existe o la ruta de red no está disponible.');
  assert.match(describeFsError({ code: 'RARO', message: 'algo' }, 'C:\\x'), /algo/);
});

test('sha256 de un buffer', () => {
  assert.equal(sha256(Buffer.from('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('describeFsError: unidad mapeada no visible, UNC sin credencial y con credencial', () => {
  assert.equal(
    describeFsError({ code: 'ENOENT' }, 'Z:\\datos', { driveMissing: true }),
    'No se puede acceder a la carpeta: unidad mapeada no visible para el servicio; usa \\\\servidor\\recurso.',
  );
  // driveMissing solo aplica a rutas con letra de unidad
  assert.doesNotMatch(describeFsError({ code: 'ENOENT' }, '\\\\srv\\rec', { driveMissing: true }), /unidad mapeada/);
  const noCredential = describeFsError({ code: 'UNKNOWN' }, '\\\\srv\\rec');
  assert.match(noCredential, /Asigna una credencial de red o cambia la cuenta del servicio/);
  const withCredential = describeFsError({ code: 'EACCES' }, '\\\\srv\\rec', { hasCredential: true });
  assert.equal(withCredential, 'No se puede acceder a la carpeta: acceso denegado.');
});
