'use strict';

const { makeTempDir } = require('../helpers/test-env');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { findReader, listReaders } = require('../../src/core/readers');

const csv = findReader({ format: 'csv' });
const excel = findReader({ format: 'excel' });

test('CSV: autodetecta ; y quita el BOM', () => {
  const buffer = Buffer.from('﻿CODIGO;NOMBRE\nA1;Tablero\nA2;Canto\n', 'utf8');
  const { fields, rows } = csv.readSample({ buffer });
  assert.deepEqual(fields, ['CODIGO', 'NOMBRE']);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].CODIGO, 'A1');
});

test('CSV: autodetecta coma y tabulador', () => {
  assert.deepEqual(csv.readSample({ buffer: Buffer.from('a,b,c\n1,2,3\n') }).fields, ['a', 'b', 'c']);
  assert.deepEqual(csv.readSample({ buffer: Buffer.from('a\tb\n1\t2\n') }).fields, ['a', 'b']);
});

test('CSV: delimitador explícito manda sobre la autodetección', () => {
  const buffer = Buffer.from('a;b|c\n1;2|3\n');
  assert.deepEqual(csv.readSample({ buffer, options: { delimiter: '|' } }).fields, ['a;b', 'c']);
});

test('CSV: sin cabecera ⇒ col1..colN y la primera fila es dato', () => {
  const buffer = Buffer.from('X;1\nY;2\n');
  const { fields, rows } = csv.readSample({ buffer, options: { has_header: false } });
  assert.deepEqual(fields, ['col1', 'col2']);
  assert.equal(rows.length, 2);
  assert.equal(csv.readAll({ buffer, options: { has_header: false } })[0].col1, 'X');
});

test('CSV: latin1 conserva los acentos', () => {
  const buffer = Buffer.from('NOMBRE\nCañón\n', 'latin1');
  assert.equal(csv.readAll({ buffer, options: { encoding: 'latin1' } })[0].NOMBRE, 'Cañón');
});

test('CSV: readSample respeta el límite y readAll lee todo; cast numérico', () => {
  const lines = ['N'];
  for (let i = 1; i <= 30; i++) lines.push(String(i));
  const buffer = Buffer.from(lines.join('\n'));
  assert.equal(csv.readSample({ buffer, limit: 5 }).rows.length, 5);
  const all = csv.readAll({ buffer });
  assert.equal(all.length, 30);
  assert.equal(all[0].N, 1);
});

test('CSV: lee desde ruta y falla con 404 si no existe', () => {
  const dir = makeTempDir();
  const file = path.join(dir, 'a.csv');
  fs.writeFileSync(file, 'a;b\n1;2\n');
  assert.deepEqual(csv.readSample({ path: file }).fields, ['a', 'b']);
  assert.throws(() => csv.readAll({ path: path.join(dir, 'no.csv') }), (e) => e.statusCode === 404);
});

function twoSheetWorkbook() {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Título del informe'], ['COD', 'CANT'], ['A', 1], ['B', 2]]), 'Stock');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['X', 'Y'], ['p', 'q']]), 'Otra');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

test('Excel: dos hojas, header_row y hoja por nombre', () => {
  const buffer = twoSheetWorkbook();
  const sample = excel.readSample({ buffer, options: { header_row: 2 } });
  assert.deepEqual(sample.sheets, ['Stock', 'Otra']);
  assert.deepEqual(sample.fields, ['COD', 'CANT']);
  assert.equal(sample.rows.length, 2);
  const other = excel.readAll({ buffer, options: { sheet_name: 'Otra' } });
  assert.deepEqual(other, [{ X: 'p', Y: 'q' }]);
});

test('Excel: hoja inexistente ⇒ 404 legible', () => {
  assert.throws(() => excel.readAll({ buffer: twoSheetWorkbook(), options: { sheet_name: 'Nada' } }),
    (e) => e.statusCode === 404 && /Nada/.test(e.message));
});

test('findReader: por extensión, forzado y desconocido', () => {
  assert.equal(findReader({ fileName: 'x.CSV' }).format, 'csv');
  assert.equal(findReader({ fileName: 'x.xlsx', format: 'auto' }).format, 'excel');
  assert.equal(findReader({ format: 'excel', fileName: 'x.csv' }).format, 'excel');
  assert.throws(() => findReader({ fileName: 'x.pdf' }), (e) => e.statusCode === 400 && /pdf/.test(e.message));
  assert.throws(() => findReader({ format: 'xml' }), (e) => e.statusCode === 400);
  assert.deepEqual(listReaders().map((r) => r.format), ['csv', 'excel']);
});
