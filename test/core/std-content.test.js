'use strict';

require('../helpers/test-env');
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildStdContent, formatDatum } = require('../../src/core/outputs/ardis-std/std-content');

const DATE = new Date(2026, 0, 12); // 12/01/2026 ⇒ 120126

test('formatDatum: DDMMYY de 6 cifras', () => {
  assert.equal(formatDatum(DATE), '120126');
  assert.equal(formatDatum(new Date(2026, 10, 4)), '041126');
});

test('estructura byte a byte como la muestra Azor (registro 1, sin ID)', () => {
  const record = {
    MATERIAAL: '10 AMAZON', DIKTE: 10, RICHTING: 0, LENGTE: 5500, BREEDTE: 2100, NOLIMIT: 1,
    REFER: '10-6AS', MINRESTO: 0.01, ID: '1;CO',
  };
  const { content, written, discarded } = buildStdContent({ header: {}, records: [record], date: DATE });
  assert.equal(written, 1);
  assert.deepEqual(discarded, []);
  assert.equal(content,
    '﻿\r\n' +
    '[ISTDALG]\r\nDATUM=120126\r\n[ISTDALG]\r\n\r\n' +
    '[ISTDALG$FORM]\r\n[ISTDALG$FORM]\r\n\r\n' +
    '[ISTD-1]\r\nMATERIAAL=10 AMAZON\r\nDIKTE=10\r\nRICHTING=0\r\nLENGTE=5500\r\nBREEDTE=2100\r\nNOLIMIT=1\r\n' +
    'REFER=10-6AS\r\nMINRESTO=0.01\r\nAANT=0\r\n[ISTD-1]\r\n\r\n' +
    '[ISTD$FORM-1]\r\n[ISTD$FORM-1]\r\n');
});

test('cabecera REST/ALGMACH; vacías no se escriben; numeración solo de válidos', () => {
  const ok = { MATERIAAL: 'A', LENGTE: 2800, BREEDTE: 2070, DIKTE: 19 };
  const { content, written, discarded } = buildStdContent({
    header: { REST: 'Almacen Retales', ALGMACH: '' },
    records: [ok, { MATERIAAL: 'B', LENGTE: 2800, BREEDTE: 2070 }, ok],
    date: DATE,
  });
  assert.equal(written, 2);
  assert.ok(content.includes('[ISTDALG]\r\nDATUM=120126\r\nREST=Almacen Retales\r\n[ISTDALG]'));
  assert.ok(!content.includes('ALGMACH'));
  assert.ok(content.includes('[ISTD-2]'));
  assert.ok(!content.includes('[ISTD-3]'));
  assert.deepEqual(discarded, [{ row: 2, label: 'MATERIAAL=B', reason: 'falta DIKTE' }]);
});

test('valores: coma decimal en numéricas, saltos de línea fuera, vacíos omitidos, defaults si no se mapean', () => {
  const { content } = buildStdContent({
    header: {},
    records: [{ MATERIAAL: 'A', LENGTE: '2800', BREEDTE: '2070', DIKTE: '5,5', BEM: 'línea1\r\nlínea2', PREF: '', NOLIMIT: 0, AANT: 7 }],
    date: DATE,
  });
  assert.ok(content.includes('DIKTE=5.5\r\n'));
  assert.ok(content.includes('BEM=línea1 línea2\r\n'));
  assert.ok(!content.includes('PREF='));
  assert.ok(content.includes('NOLIMIT=0\r\n'));
  assert.ok(content.includes('AANT=7\r\n'));
  assert.ok(!content.includes('NOLIMIT=1'));
});

test('medidas no numéricas o <= 0 ⇒ descartado con motivo', () => {
  const { written, discarded } = buildStdContent({
    header: {},
    records: [
      { MATERIAAL: 'A', LENGTE: 'abc', BREEDTE: 2070, DIKTE: 19 },
      { MATERIAAL: 'B', LENGTE: 0, BREEDTE: 2070, DIKTE: 19 },
      { MATERIAAL: '  ', LENGTE: 1, BREEDTE: 1, DIKTE: 1 },
    ],
    date: DATE,
  });
  assert.equal(written, 0);
  assert.deepEqual(discarded.map(d => d.reason), [
    'LENGTE no es una medida válida («abc»)',
    'LENGTE no es una medida válida («0»)',
    'falta MATERIAAL',
  ]);
});

test('clave inválida (p. ej. con punto o espacio) ⇒ error de configuración', () => {
  assert.throws(
    () => buildStdContent({ header: {}, records: [{ MATERIAAL: 'A', LENGTE: 1, BREEDTE: 1, DIKTE: 1, 'MI CLAVE': 'x' }], date: DATE }),
    /Clave no válida para el almacén \.STD: «MI CLAVE»/,
  );
  assert.throws(
    () => buildStdContent({ header: {}, records: [{ MATERIAAL: 'A', LENGTE: 1, BREEDTE: 1, DIKTE: 1, EXT: { a: 1 } }], date: DATE }),
    /«EXT» tiene un valor compuesto/,
  );
});

test('cero registros ⇒ written 0 (el llamador decide no escribir)', () => {
  const { written } = buildStdContent({ header: {}, records: [], date: DATE });
  assert.equal(written, 0);
});
