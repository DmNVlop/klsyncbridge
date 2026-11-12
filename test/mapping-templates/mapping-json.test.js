'use strict';

require('../helpers/test-env');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateMappingJson, validateTemplate, toMappingJson, fromMappingJson,
} = require('../../src/modules/mapping-templates/mapping-json.schema');

const STD_FIELDS = [
  { target: 'MATERIAAL', source: 'field', sourceField: 'CODIGO', transform: 'trim' },
  { target: 'LENGTE', source: 'field', sourceField: 'LARGO' },
  { target: 'BREEDTE', source: 'field', sourceField: 'ANCHO' },
  { target: 'DIKTE', source: 'expression', expression: 'ESPESOR * 1', transform: 'number', default: '0' },
  { target: 'NOLIMIT', source: 'static', value: '0' },
];

function validDoc(overrides = {}) {
  return {
    kind: 'klsyncbridge.mapping',
    schemaVersion: 1,
    name: 'Stock ERP a Ardis',
    description: 'prueba',
    targetKind: 'ardis_std',
    filterExpression: 'STOCK > 0',
    reader: { format: 'csv', options: { delimiter: ';', encoding: 'utf8', has_header: true } },
    fields: STD_FIELDS,
    ...overrides,
  };
}

test('un documento válido se normaliza a la forma interna de field_maps', () => {
  const result = validateMappingJson(validDoc());
  assert.equal(result.valid, true);
  assert.deepEqual(result.issues, []);
  const { template } = result;
  assert.equal(template.target_kind, 'ardis_std');
  assert.equal(template.filter_expression, 'STOCK > 0');
  assert.equal(template.fields[0].api_field, 'MATERIAAL');
  assert.equal(template.fields[0].sql_field, 'CODIGO');
  assert.equal(template.fields[0].sort_order, 0);
  assert.equal(template.fields[3].source_type, 'expression');
  assert.equal(template.fields[3].default_value, '0');
  assert.equal(template.fields[4].sql_field, '__static__');
  assert.equal(template.fields[4].default_value, '0');
});

test('acepta el JSON como texto y avisa si no es JSON', () => {
  assert.equal(validateMappingJson(JSON.stringify(validDoc())).valid, true);
  const bad = validateMappingJson('{ no es json');
  assert.equal(bad.valid, false);
  assert.match(bad.issues[0], /JSON no válido/);
});

test('transform desconocido ⇒ error legible con la lista de admitidos', () => {
  const fields = STD_FIELDS.map((f, i) => (i === 3 ? { ...f, transform: 'upper2' } : f));
  const { valid, issues } = validateMappingJson(validDoc({ fields }));
  assert.equal(valid, false);
  assert.ok(issues.some((m) => m.startsWith('fields[3].transform: "upper2" no es válido; admitidos: none, uppercase')));
});

test('faltan las claves obligatorias de Ardis ⇒ las nombra', () => {
  const { issues } = validateMappingJson(validDoc({ fields: [STD_FIELDS[0], STD_FIELDS[4]] }));
  assert.ok(issues.some((m) => m.includes('faltan las claves obligatorias de Ardis: LENGTE, BREEDTE, DIKTE')));
});

test('clave STD con carácter no permitido', () => {
  const fields = [...STD_FIELDS, { target: 'MI.CLAVE', source: 'static', value: '1' }];
  const { issues } = validateMappingJson(validDoc({ fields }));
  assert.ok(issues.some((m) => m.startsWith('fields[5].target') && m.includes('MI.CLAVE')));
});

test('source=field sin sourceField, static sin value, expression sin expression', () => {
  const doc = validDoc({
    targetKind: 'api',
    fields: [
      { target: 'a', source: 'field' },
      { target: 'b', source: 'static' },
      { target: 'c', source: 'expression' },
      { target: 'd', source: 'otro' },
    ],
  });
  const { issues } = validateMappingJson(doc);
  assert.ok(issues.includes('fields[0].sourceField: es obligatorio cuando source es "field"'));
  assert.ok(issues.includes('fields[1].value: es obligatorio cuando source es "static"'));
  assert.ok(issues.includes('fields[2].expression: es obligatorio cuando source es "expression"'));
  assert.ok(issues.some((m) => m.startsWith('fields[3].source: "otro" no es válido')));
});

test('expresión con sintaxis inválida ⇒ error sin ejecutar nada', () => {
  globalThis.__klsbExecuted = false;
  const fields = STD_FIELDS.map((f, i) => (i === 3 ? { ...f, expression: 'A +* B' } : f));
  const bad = validateMappingJson(validDoc({ fields }));
  assert.ok(bad.issues.some((m) => m.startsWith('fields[3].expression: la expresión no es válida')));
  // Una expresión válida no se ejecuta al validarla
  const spy = STD_FIELDS.map((f, i) => (i === 3 ? { ...f, expression: '(globalThis.__klsbExecuted = true)' } : f));
  assert.equal(validateMappingJson(validDoc({ fields: spy })).valid, true);
  assert.equal(globalThis.__klsbExecuted, false);
  delete globalThis.__klsbExecuted;
  const badFilter = validateMappingJson(validDoc({ filterExpression: 'STOCK >' }));
  assert.ok(badFilter.issues.some((m) => m.startsWith('filterExpression: la expresión no es válida')));
});

test('kind, versión, targetKind, nombre y campos vacíos', () => {
  const { issues } = validateMappingJson({ kind: 'otro', schemaVersion: 2, targetKind: 'x', fields: [] });
  assert.ok(issues.includes('kind: debe ser "klsyncbridge.mapping"'));
  assert.ok(issues.includes('schemaVersion: debe ser 1'));
  assert.ok(issues.some((m) => m.startsWith('targetKind: "x" no es válido')));
  assert.ok(issues.includes('name: es obligatorio'));
  assert.ok(issues.includes('fields: debe tener al menos un campo'));
});

test('target repetido, más de 500 campos y textos largos', () => {
  const dup = validateMappingJson(validDoc({ targetKind: 'api', fields: [STD_FIELDS[0], STD_FIELDS[0]] }));
  assert.ok(dup.issues.some((m) => m.includes('"MATERIAAL" está repetido')));
  const many = Array.from({ length: 501 }, (_, i) => ({ target: `K${i}`, source: 'static', value: '1' }));
  assert.ok(validateMappingJson(validDoc({ targetKind: 'api', fields: many })).issues.some((m) => m.includes('más de 500')));
  const long = validateMappingJson(validDoc({ description: 'x'.repeat(501) }));
  assert.ok(long.issues.some((m) => m.startsWith('description:')));
});

test('lector con formato o codificación no válidos', () => {
  const { issues } = validateMappingJson(validDoc({ reader: { format: 'xml', options: { encoding: 'utf16' } } }));
  assert.ok(issues.some((m) => m.startsWith('reader.format')));
  assert.ok(issues.some((m) => m.startsWith('reader.options.encoding')));
});

test('ida y vuelta interna ⇔ v1 sin pérdida', () => {
  const first = validateMappingJson(validDoc()).template;
  const json = toMappingJson(first);
  assert.deepEqual(json.fields, STD_FIELDS);
  const second = validateMappingJson(json);
  assert.equal(second.valid, true);
  assert.deepEqual(second.template, first);
  assert.deepEqual(fromMappingJson(toMappingJson(second.template)), first);
});

test('validateTemplate aplica las mismas reglas a la forma interna', () => {
  const template = validateMappingJson(validDoc()).template;
  assert.equal(validateTemplate(template).valid, true);
  const broken = { ...template, fields: template.fields.slice(1) };
  assert.equal(validateTemplate(broken).valid, false);
});
