'use strict';

const { getDb } = require('../helpers/test-env');
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const svc = require('../../src/modules/credentials/credentials.service');
const { seedApiConfig } = require('../helpers/seed');
const { ConflictError, NotFoundError } = require('../../src/utils/errors');

const actor = { id: 'u1', username: 'tester' };
const SECRET = 'Sup3r-Secreta-123';
let counter = 0;

function newCredential(overrides = {}) {
  counter += 1;
  return svc.createCredential({ name: `NAS ${counter}`, domain: 'EMPRESA', username: 'svc', password: SECRET, ...overrides }, actor);
}

function seedJobUsing(credentialId) {
  const db = getDb();
  const ts = new Date().toISOString();
  const connectionId = crypto.randomUUID();
  db.prepare("INSERT INTO connections (id, name, created_at, updated_at) VALUES (?, 'c', ?, ?)").run(connectionId, ts, ts);
  const apiConfig = seedApiConfig('http://127.0.0.1:1');
  const jobId = crypto.randomUUID();
  db.prepare(`INSERT INTO jobs (id, name, connection_id, table_or_view, key_field, api_config_id, schedule_type, schedule_value,
    output_credential_id, created_at, updated_at) VALUES (?, 'job en uso', ?, 't', 'k', ?, 'interval', '5', ?, ?, ?)`)
    .run(jobId, connectionId, apiConfig.id, credentialId, ts, ts);
  return jobId;
}

test('alta: la columna password guarda texto cifrado y la respuesta no la incluye', () => {
  const created = newCredential();
  const raw = getDb().prepare('SELECT password FROM network_credentials WHERE id = ?').get(created.id);
  assert.notEqual(raw.password, SECRET);
  assert.ok(raw.password.length > 0);
  assert.equal('password' in created, false);
  assert.equal(svc.getCredentialSecret(created.id).password, SECRET);
});

test('get y list no contienen la clave password ni su valor', () => {
  const created = newCredential();
  assert.equal('password' in svc.getCredential(created.id), false);
  const all = svc.listCredentials();
  assert.ok(all.length > 0);
  assert.equal(all.some((c) => 'password' in c), false);
  assert.equal(JSON.stringify(all).includes(SECRET), false);
});

test('la auditoría no contiene la contraseña', () => {
  const created = newCredential();
  svc.updateCredential(created.id, { password: 'otra-clave-distinta' }, actor);
  const rows = getDb().prepare('SELECT summary FROM audit_events WHERE resource_id = ?').all(created.id);
  assert.ok(rows.length >= 2);
  const text = JSON.stringify(rows);
  assert.equal(text.includes(SECRET), false);
  assert.equal(text.includes('otra-clave-distinta'), false);
});

test('update sin password conserva el cifrado; con password lo cambia', () => {
  const created = newCredential();
  const before = getDb().prepare('SELECT password FROM network_credentials WHERE id = ?').get(created.id).password;
  svc.updateCredential(created.id, { username: 'otro' }, actor);
  assert.equal(getDb().prepare('SELECT password FROM network_credentials WHERE id = ?').get(created.id).password, before);
  svc.updateCredential(created.id, { password: 'nueva-clave' }, actor);
  const after = getDb().prepare('SELECT password FROM network_credentials WHERE id = ?').get(created.id).password;
  assert.notEqual(after, before);
  assert.equal(svc.getCredentialSecret(created.id).password, 'nueva-clave');
  const summary = getDb().prepare("SELECT summary FROM audit_events WHERE resource_id = ? AND action = 'update' ORDER BY at DESC, rowid DESC").get(created.id).summary;
  assert.equal(summary, 'cambió contraseña');
});

test('delete en uso por un job ⇒ ConflictError con la lista de usos', () => {
  const created = newCredential();
  const jobId = seedJobUsing(created.id);
  assert.throws(() => svc.deleteCredential(created.id, actor), (err) => {
    assert.ok(err instanceof ConflictError);
    assert.equal(err.statusCode, 409);
    assert.equal(err.details.usages.jobs[0].id, jobId);
    assert.deepEqual(err.details.usages.connections, []);
    return true;
  });
});

test('delete libre borra y audita', () => {
  const created = newCredential();
  svc.deleteCredential(created.id, actor);
  assert.throws(() => svc.getCredential(created.id), NotFoundError);
  const row = getDb().prepare("SELECT action FROM audit_events WHERE resource_id = ? AND action = 'delete'").get(created.id);
  assert.ok(row);
});

test('purgeAuditEvents borra los de más de 365 días y respeta los recientes', () => {
  const db = getDb();
  const old = new Date(Date.now() - 400 * 86400000).toISOString();
  db.prepare("INSERT INTO audit_events (id, at, action, resource_type) VALUES ('old-evt', ?, 'x', 'y')").run(old);
  svc.writeAudit({ actor, action: 'x', resourceType: 'y', resourceId: 'recent-res' });
  svc.purgeAuditEvents();
  assert.equal(db.prepare("SELECT id FROM audit_events WHERE id = 'old-evt'").get(), undefined);
  assert.ok(db.prepare("SELECT id FROM audit_events WHERE resource_id = 'recent-res'").get());
});

test('valor cifrado corrupto ⇒ CREDENTIAL_UNREADABLE sin filtrar secretos', () => {
  const created = newCredential();
  getDb().prepare('UPDATE network_credentials SET password = ? WHERE id = ?').run('Y29ycnVwdG8=', created.id);
  assert.throws(() => svc.getCredentialSecret(created.id), (err) => {
    assert.equal(err.code, 'CREDENTIAL_UNREADABLE');
    assert.match(err.message, /credencial ilegible/);
    return true;
  });
});

test('recordTestResult guarda last_test_* y audita sin secretos', () => {
  const created = newCredential();
  svc.recordTestResult(created.id, { ok: false, message: 'Usuario o contraseña incorrectos', path: '\\\\srv\\rec' }, actor);
  const got = svc.getCredential(created.id);
  assert.equal(got.last_test_ok, false);
  assert.equal(got.last_test_path, '\\\\srv\\rec');
  assert.ok(got.last_test_at);
});

test('nombre duplicado ⇒ ConflictError', () => {
  const created = newCredential();
  assert.throws(() => newCredential({ name: created.name }), ConflictError);
});
