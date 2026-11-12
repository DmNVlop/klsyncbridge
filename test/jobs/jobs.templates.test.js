'use strict';

const { getDb } = require('../helpers/test-env');
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { once } = require('events');
const jobsService = require('../../src/modules/jobs/jobs.service');
const templates = require('../../src/modules/mapping-templates/mapping-templates.service');
const { seedJob } = require('../helpers/seed');
const { createServer } = require('../../src/server');
const { generateToken } = require('../../src/modules/auth/auth.service');

const actor = { id: 'u1', username: 'tester' };

const templateFields = [
  { api_field: 'sku', source_type: 'field', sql_field: 'id', transform: 'trim' },
  { api_field: 'kind', source_type: 'static', sql_field: '__static__', default_value: 'tablero' },
  {
    api_field: 'flag', source_type: 'expression', sql_field: 'name', expression: 'name === "Uno" ? 1 : 0',
    expression_meta: { expr_cond_field: 'name', expr_cond_op: '==', expr_cond_val: 'Uno', expr_then: '1', expr_else: '0' },
  },
];

let counter = 0;
function makeTemplate(overrides = {}) {
  counter += 1;
  return templates.createTemplate({ name: `Plantilla job ${counter}`, target_kind: 'api', fields: templateFields, ...overrides }, actor);
}

test('apply-template sustituye los mapeos por una copia y guarda el origen', () => {
  const job = seedJob();
  jobsService.saveFieldMaps(job.id, [{ sql_field: 'viejo', api_field: 'old' }]);
  const tpl = makeTemplate();

  const result = jobsService.applyTemplate(job.id, tpl.id, actor);
  assert.equal(result.fieldMaps.length, 3);
  assert.deepEqual(result.fieldMaps.map((m) => m.api_field), ['sku', 'kind', 'flag']);
  assert.equal(result.fieldMaps[1].default_value, 'tablero');
  assert.equal(JSON.parse(result.fieldMaps[2].expression_meta).expr_cond_val, 'Uno');
  assert.equal(result.job.mapping_origin.templateId, tpl.id);
  assert.equal(result.job.mapping_origin.templateName, tpl.name);

  // Es una copia: editar la plantilla no toca el job
  templates.updateTemplate(tpl.id, { name: tpl.name, target_kind: 'api', fields: [templateFields[0]] }, actor);
  assert.equal(jobsService.getFieldMaps(job.id).length, 3);

  const audit = getDb().prepare("SELECT action FROM audit_events WHERE resource_type = 'job' AND resource_id = ?").get(job.id);
  assert.equal(audit.action, 'apply_template');
});

test('apply-template: job o plantilla inexistentes ⇒ 404; job en ejecución ⇒ 409', () => {
  const job = seedJob();
  const tpl = makeTemplate();
  assert.throws(() => jobsService.applyTemplate('no-existe', tpl.id, actor), (e) => e.statusCode === 404);
  assert.throws(() => jobsService.applyTemplate(job.id, 'no-existe', actor), (e) => e.statusCode === 404);
  getDb().prepare("UPDATE jobs SET last_run_status = 'running' WHERE id = ?").run(job.id);
  assert.throws(() => jobsService.applyTemplate(job.id, tpl.id, actor), (e) => e.statusCode === 409);
});

test('si falla la plantilla, el mapeo anterior se conserva (transacción)', () => {
  const job = seedJob();
  jobsService.saveFieldMaps(job.id, [{ sql_field: 'a', api_field: 'a' }]);
  assert.throws(() => jobsService.applyTemplate(job.id, 'no-existe', actor));
  assert.equal(jobsService.getFieldMaps(job.id).length, 1);
  assert.equal(jobsService.getJob(job.id).mapping_origin, null);
});

test('duplicar un job: inactivo, mismos ajustes y mapeos, sin snapshot ni sync_state', () => {
  const db = getDb();
  const job = seedJob({ name: 'Original', is_active: true, std_header: { REST: 'R' } });
  jobsService.saveFieldMaps(job.id, templateFields.map((m) => ({ ...m, ...m.expression_meta })));
  db.prepare("INSERT INTO sync_snapshot (job_id, reference, data_hash, last_seen_at) VALUES (?, 'r1', 'h', 'now')").run(job.id);
  db.prepare("INSERT INTO sync_state (job_id, updated_at) VALUES (?, 'now')").run(job.id);

  const copy = jobsService.duplicateJob(job.id, actor);
  assert.equal(copy.name, 'Original (copia)');
  assert.notEqual(copy.id, job.id);
  assert.equal(copy.is_active, false);
  assert.equal(copy.table_or_view, job.table_or_view);
  assert.equal(copy.output_dir, job.output_dir);
  assert.deepEqual(copy.std_header, { REST: 'R' });
  assert.equal(copy.last_run_status, null);

  const originalMaps = jobsService.getFieldMaps(job.id).map(({ id, job_id, created_at, ...rest }) => rest);
  const copyMaps = jobsService.getFieldMaps(copy.id).map(({ id, job_id, created_at, ...rest }) => rest);
  assert.deepEqual(copyMaps, originalMaps);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sync_snapshot WHERE job_id = ?').get(copy.id).n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sync_state WHERE job_id = ?').get(copy.id).n, 0);
  // El original no cambia
  assert.equal(jobsService.getJob(job.id).is_active, true);

  assert.equal(jobsService.duplicateJob(job.id, actor).name, 'Original (copia 2)');
  assert.throws(() => jobsService.duplicateJob('no-existe', actor), (e) => e.statusCode === 404);
});

test('rutas apply-template y duplicate', async () => {
  getDb().prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('jwt_secret', 'test-secret')").run();
  const token = generateToken({ id: 'u1', username: 'tester', role: 'admin' });
  const server = createServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/api/jobs`;
  const call = async (url, payload) => {
    const res = await fetch(`${base}${url}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload || {}),
    });
    return { status: res.status, body: await res.json() };
  };
  try {
    const job = seedJob();
    const tpl = makeTemplate();
    const bad = await call(`/${job.id}/apply-template`, {});
    assert.equal(bad.status, 400);
    const applied = await call(`/${job.id}/apply-template`, { templateId: tpl.id });
    assert.equal(applied.status, 200);
    assert.equal(applied.body.data.fieldMaps.length, 3);
    assert.equal(applied.body.data.job.mapping_origin.templateId, tpl.id);
    const dup = await call(`/${job.id}/duplicate`);
    assert.equal(dup.status, 201);
    assert.equal(dup.body.data.is_active, false);
    assert.equal((await call(`/${crypto.randomUUID()}/duplicate`)).status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
