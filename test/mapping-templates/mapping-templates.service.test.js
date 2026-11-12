'use strict';

const { getDb } = require('../helpers/test-env');
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { once } = require('events');
const XLSX = require('xlsx');
const svc = require('../../src/modules/mapping-templates/mapping-templates.service');
const { buildAiInstructions } = require('../../src/modules/mapping-templates/ai-instructions');
const { sampleFile, previewMapping } = require('../../src/modules/mapping-templates/sample.service');
const { seedAutomation, seedJob } = require('../helpers/seed');
const { createServer } = require('../../src/server');
const { generateToken } = require('../../src/modules/auth/auth.service');

const actor = { id: 'u1', username: 'tester' };

const stdFields = [
  { api_field: 'MATERIAAL', source_type: 'field', sql_field: 'CODIGO', transform: 'trim' },
  { api_field: 'LENGTE', source_type: 'field', sql_field: 'LARGO' },
  { api_field: 'BREEDTE', source_type: 'field', sql_field: 'ANCHO' },
  { api_field: 'DIKTE', source_type: 'field', sql_field: 'ESPESOR' },
];

let counter = 0;
function body(overrides = {}) {
  counter += 1;
  return { name: `Plantilla ${counter}`, target_kind: 'ardis_std', fields: stdFields, ...overrides };
}

function csvInput(text, extra = {}) {
  return { fileName: 'stock.csv', contentBase64: Buffer.from(text).toString('base64'), ...extra };
}

test('crear, obtener y listar una plantilla con auditoría', () => {
  const created = svc.createTemplate(body({ name: 'Stock', description: 'd', filter_expression: 'LARGO > 0' }), actor);
  assert.equal(created.name, 'Stock');
  assert.equal(created.fields.length, 4);
  assert.equal(created.fields[3].sort_order, 3);
  assert.equal(created.origin.type, 'manual');
  assert.equal(svc.getTemplate(created.id).filter_expression, 'LARGO > 0');
  const row = svc.listTemplates().find((t) => t.id === created.id);
  assert.equal(row.fieldCount, 4);
  const audit = getDb().prepare("SELECT * FROM audit_events WHERE resource_type = 'mapping_template' AND resource_id = ?").all(created.id);
  assert.equal(audit[0].action, 'create');
  assert.equal(audit[0].username, 'tester');
});

test('nombre único sin distinguir mayúsculas ⇒ 409', () => {
  svc.createTemplate(body({ name: 'Repetida' }), actor);
  assert.throws(() => svc.createTemplate(body({ name: 'repetida' }), actor), (e) => e.statusCode === 409);
});

test('plantilla no válida ⇒ 400 con issues legibles; .STD sin obligatorias', () => {
  assert.throws(() => svc.createTemplate(body({ fields: stdFields.slice(0, 2) }), actor),
    (e) => e.statusCode === 400 && e.details.issues.some((m) => m.includes('faltan las claves obligatorias')));
  assert.throws(() => svc.createTemplate({ target_kind: 'api', fields: [] }, actor), (e) => e.statusCode === 400);
});

test('actualizar: cambia campos y respeta el nombre propio; renombrar a uno ajeno ⇒ 409', () => {
  const a = svc.createTemplate(body({ name: 'Upd A' }), actor);
  const b = svc.createTemplate(body({ name: 'Upd B' }), actor);
  const updated = svc.updateTemplate(a.id, body({ name: 'Upd A', description: 'nueva' }), actor);
  assert.equal(updated.description, 'nueva');
  assert.throws(() => svc.updateTemplate(b.id, body({ name: 'upd a' }), actor), (e) => e.statusCode === 409);
  assert.throws(() => svc.updateTemplate('no-existe', body(), actor), (e) => e.statusCode === 404);
});

test('duplicar añade «(copia)» y un sufijo numérico si ya existe', () => {
  const src = svc.createTemplate(body({ name: 'Origen' }), actor);
  const first = svc.duplicateTemplate(src.id, actor);
  const second = svc.duplicateTemplate(src.id, actor);
  assert.equal(first.name, 'Origen (copia)');
  assert.equal(second.name, 'Origen (copia 2)');
  assert.equal(first.origin.type, 'template');
  assert.equal(first.origin.id, src.id);
  assert.deepEqual(first.fields, src.fields);
});

test('usos: jobs por mapping_origin y automatizaciones por sus pasos; el borrado solo lo bloquean las automatizaciones', () => {
  const db = getDb();
  const tpl = svc.createTemplate(body({ name: 'En uso' }), actor);
  const ts = new Date().toISOString();
  const job = seedJob({ name: 'Job copia' });
  db.prepare('UPDATE jobs SET mapping_origin = ? WHERE id = ?')
    .run(JSON.stringify({ templateId: tpl.id, templateName: tpl.name, at: ts }), job.id);
  assert.deepEqual(svc.findUsages(tpl.id), { jobs: [{ id: job.id, name: 'Job copia' }], automations: [] });

  const autoId = seedAutomation({ name: 'Auto con plantilla' });
  db.prepare('INSERT INTO automation_steps (id, automation_id, position, step_type, config) VALUES (?, ?, 0, ?, ?)')
    .run(crypto.randomUUID(), autoId, 'map_export', JSON.stringify({ mappingTemplateId: tpl.id }));
  const usages = svc.findUsages(tpl.id);
  assert.deepEqual(usages.automations, [{ id: autoId, name: 'Auto con plantilla' }]);

  assert.throws(() => svc.deleteTemplate(tpl.id, actor), (e) => e.statusCode === 409 && e.details.usages.automations.length === 1);
  db.prepare('DELETE FROM automation_steps WHERE automation_id = ?').run(autoId);
  svc.deleteTemplate(tpl.id, actor);
  assert.throws(() => svc.getTemplate(tpl.id), (e) => e.statusCode === 404);
  assert.equal(db.prepare("SELECT action FROM audit_events WHERE resource_id = ? ORDER BY at DESC").get(tpl.id).action, 'delete');
});

test('exportar devuelve JSON v1 que vuelve a validar', () => {
  const { validateMappingJson } = require('../../src/modules/mapping-templates/mapping-json.schema');
  const tpl = svc.createTemplate(body({ name: 'Para exportar' }), actor);
  const { json, fileName } = svc.exportTemplate(tpl.id);
  assert.equal(json.kind, 'klsyncbridge.mapping');
  assert.equal(fileName, 'Para_exportar.mapping.json');
  assert.equal(validateMappingJson(json).valid, true);
});

test('sample con buffer CSV: campos con valores de ejemplo (≤5 distintos) y filas', async () => {
  const lines = ['CODIGO;LARGO'];
  for (let i = 1; i <= 12; i++) lines.push(`C${i % 7};${i}`);
  const sample = await sampleFile(csvInput(lines.join('\n')));
  assert.equal(sample.format, 'csv');
  assert.deepEqual(sample.fields.map((f) => f.name), ['CODIGO', 'LARGO']);
  assert.equal(sample.fields[0].sampleValues.length, 5);
  assert.equal(sample.rows.length, 10);
});

test('sample de Excel devuelve las hojas; formato desconocido y fichero > 5 MB ⇒ 400', async () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['A'], [1]]), 'Hoja1');
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const sample = await sampleFile({ fileName: 'x.xlsx', contentBase64: buffer.toString('base64') });
  assert.deepEqual(sample.sheets, ['Hoja1']);
  await assert.rejects(sampleFile({ fileName: 'x.pdf', contentBase64: 'AAAA' }), (e) => e.statusCode === 400);
  const big = Buffer.alloc(5 * 1024 * 1024 + 1, 'a').toString('base64');
  await assert.rejects(sampleFile({ fileName: 'big.csv', contentBase64: big }), (e) => e.statusCode === 400 && /5 MB/.test(e.message));
  await assert.rejects(sampleFile({}), (e) => e.statusCode === 400);
});

test('sample por ruta usa withFolderAccess con la credencial indicada', async () => {
  const fs = require('fs');
  const path = require('path');
  const { makeTempDir } = require('../helpers/test-env');
  const dir = makeTempDir();
  const file = path.join(dir, 'stock.csv');
  fs.writeFileSync(file, 'A;B\n1;2\n');
  const calls = [];
  const credentialAccess = { withFolderAccess: async (opts, fn) => { calls.push(opts); return fn(); } };
  const sample = await sampleFile({ path: file, credentialId: 'cred-1' }, { credentialAccess });
  assert.deepEqual(sample.fields.map((f) => f.name), ['A', 'B']);
  assert.deepEqual(calls, [{ path: file, credentialId: 'cred-1' }]);
});

test('preview con ardis_std: items, descartes con motivo y stdPreview', async () => {
  const text = 'CODIGO;LARGO;ANCHO;ESPESOR\nA1;2800;2070;19\nA2;0;2070;19\nA3;2800;2070;16\nA4;100;100;1\n';
  const result = await previewMapping({
    targetKind: 'ardis_std',
    fields: stdFields,
    filterExpression: 'CODIGO !== "A4"',
    sample: csvInput(text),
  });
  assert.equal(result.total, 4);
  assert.equal(result.filteredOut, 1);
  assert.equal(result.items.length, 3);
  assert.equal(result.written, 2);
  assert.equal(result.discarded.length, 1);
  assert.equal(result.discarded[0].row, 2);
  assert.match(result.discarded[0].reason, /LENGTE/);
  assert.match(result.stdPreview, /\[ISTDALG\]/);
  assert.match(result.stdPreview, /MATERIAAL=A1/);
});

test('preview con destino api no genera stdPreview', async () => {
  const result = await previewMapping({
    targetKind: 'api',
    fields: [{ api_field: 'ref.code', source_type: 'field', sql_field: 'CODIGO' }],
    sample: csvInput('CODIGO\nX\n'),
  });
  assert.deepEqual(result.items, [{ ref: { code: 'X' } }]);
  assert.equal('stdPreview' in result, false);
});

test('ai-instructions contiene las claves obligatorias, el formato y los campos detectados', () => {
  const text = buildAiInstructions({
    targetKind: 'ardis_std',
    sampleFields: [{ name: 'CODIGO', sampleValues: ['A1', 'A2'] }],
  });
  for (const key of ['MATERIAAL', 'LENGTE', 'BREEDTE', 'DIKTE']) assert.match(text, new RegExp(`${key} \\(OBLIGATORIA\\)`));
  assert.match(text, /klsyncbridge\.mapping/);
  assert.match(text, /CODIGO: "A1", "A2"/);
  assert.match(text, /SOLO el JSON/);
  assert.match(text, /none, uppercase/);
  const api = buildAiInstructions({ targetKind: 'api' });
  assert.equal(api.includes('OBLIGATORIA'), false);
});

// Rutas
const token = (() => {
  getDb().prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('jwt_secret', 'test-secret')").run();
  return generateToken({ id: 'u1', username: 'tester', role: 'admin' });
})();
let server;
let base;
test.before(async () => {
  server = createServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}/api/mapping-templates`;
});
test.after(() => new Promise((resolve) => server.close(resolve)));

async function call(method, url, payload, auth = true) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${base}${url}`, { method, headers, body: payload ? JSON.stringify(payload) : undefined });
  const text = await res.text();
  return { status: res.status, type: res.headers.get('content-type'), text, json: () => JSON.parse(text) };
}

test('rutas: sin token 401; literales antes de /:id; flujo CRUD completo', async () => {
  assert.equal((await call('GET', '', null, false)).status, 401);

  const ai = await call('GET', '/ai-instructions?targetKind=ardis_std');
  assert.equal(ai.status, 200);
  assert.match(ai.type, /text\/plain/);
  assert.match(ai.text, /MATERIAAL/);

  const aiPost = await call('POST', '/ai-instructions', { targetKind: 'api', sampleFields: [{ name: 'X', sampleValues: [1] }] });
  assert.match(aiPost.text, /- X: 1/);

  const bad = await call('POST', '/validate', { kind: 'x' });
  assert.equal(bad.status, 200);
  assert.equal(bad.json().data.valid, false);

  const sample = await call('POST', '/sample', csvInput('A;B\n1;2\n'));
  assert.equal(sample.json().data.fields.length, 2);

  const createdRes = await call('POST', '', body({ name: 'Ruta CRUD' }));
  assert.equal(createdRes.status, 201);
  const id = createdRes.json().data.id;
  assert.equal((await call('POST', '', body({ name: 'ruta crud' }))).status, 409);

  const exp = await call('GET', `/${id}/export`);
  assert.match(exp.type, /application\/json/);
  assert.equal(JSON.parse(exp.text).kind, 'klsyncbridge.mapping');

  assert.equal((await call('GET', `/${id}/usages`)).json().data.automations.length, 0);
  assert.equal((await call('POST', `/${id}/duplicate`)).status, 201);
  assert.equal((await call('PUT', `/${id}`, body({ name: 'Ruta CRUD 2' }))).json().data.name, 'Ruta CRUD 2');

  const preview = await call('POST', '/preview', {
    targetKind: 'api', fields: [{ api_field: 'a', sql_field: 'A' }], sample: csvInput('A\n7\n'),
  });
  assert.deepEqual(preview.json().data.items, [{ a: 7 }]);

  assert.equal((await call('DELETE', `/${id}`)).status, 200);
  assert.equal((await call('GET', `/${id}`)).status, 404);
});
