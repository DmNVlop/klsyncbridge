'use strict';

const crypto = require('crypto');
const { getDb } = require('../../config/database');
const { encrypt, decrypt } = require('../../services/encryption.service');
const { AppError, NotFoundError, ConflictError, ValidationError } = require('../../utils/errors');
const { isUncPath } = require('../../core/files/paths');
const { writeAudit, purgeAuditEvents } = require('../../services/audit.service');

const RESOURCE_TYPE = 'network_credential';
const UNC_ONLY_MESSAGE = 'las credenciales de red solo aplican a rutas \\\\servidor\\recurso';
const UNREADABLE_MESSAGE = 'credencial ilegible: vuelve a escribir la contraseña';

// Proyección pública: nunca incluye `password`
const PUBLIC_COLUMNS = `id, name, domain, username, notes, last_test_at, last_test_ok, last_test_message,
  last_test_path, created_at, updated_at, created_by, updated_by`;

function now() { return new Date().toISOString(); }

function serialize(row) {
  if (!row) return null;
  return { ...row, last_test_ok: row.last_test_ok === null || row.last_test_ok === undefined ? null : Boolean(row.last_test_ok) };
}

function listCredentials() {
  return getDb().prepare(`SELECT ${PUBLIC_COLUMNS} FROM network_credentials ORDER BY name ASC`).all().map(serialize);
}

function getCredential(id) {
  const row = getDb().prepare(`SELECT ${PUBLIC_COLUMNS} FROM network_credentials WHERE id = ?`).get(id);
  if (!row) throw new NotFoundError('Credencial de red');
  return serialize(row);
}

/**
 * Credencial con la contraseña descifrada. Solo para `credential-access`: nunca debe llegar a una respuesta HTTP.
 * @returns {{ id: string, domain: string|null, username: string, password: string }}
 */
function getCredentialSecret(id) {
  const row = getDb().prepare('SELECT id, domain, username, password FROM network_credentials WHERE id = ?').get(id);
  if (!row) throw new NotFoundError('Credencial de red');
  try {
    return { id: row.id, domain: row.domain, username: row.username, password: decrypt(row.password) };
  } catch (err) {
    throw new AppError(UNREADABLE_MESSAGE, 'CREDENTIAL_UNREADABLE', 500);
  }
}

function assertNameFree(name, exceptId = null) {
  const row = getDb().prepare('SELECT id FROM network_credentials WHERE name = ?').get(name);
  if (row && row.id !== exceptId) throw new ConflictError('Ya existe una credencial de red con ese nombre');
}

function createCredential(data, actor) {
  assertNameFree(data.name);
  const id = crypto.randomUUID();
  const ts = now();
  const actorId = (actor && actor.id) || null;
  getDb().prepare(`
    INSERT INTO network_credentials (id, name, domain, username, password, notes, created_at, updated_at, created_by, updated_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, data.name, data.domain || null, data.username, encrypt(data.password), data.notes || null, ts, ts, actorId, actorId);
  writeAudit({ actor, action: 'create', resourceType: RESOURCE_TYPE, resourceId: id, summary: `creó la credencial «${data.name}»` });
  return getCredential(id);
}

const FIELD_LABELS = { name: 'nombre', domain: 'dominio', username: 'usuario', password: 'contraseña', notes: 'notas' };

function joinLabels(labels) {
  if (labels.length <= 1) return labels.join('');
  return `${labels.slice(0, -1).join(', ')} y ${labels[labels.length - 1]}`;
}

function updateCredential(id, data, actor) {
  const current = getDb().prepare('SELECT id, name, domain, username, notes FROM network_credentials WHERE id = ?').get(id);
  if (!current) throw new NotFoundError('Credencial de red');
  if (data.name !== undefined) assertNameFree(data.name, id);

  const sets = [];
  const params = [];
  const changed = [];
  for (const field of ['name', 'domain', 'username', 'notes']) {
    if (data[field] === undefined) continue;
    const next = data[field] === '' ? null : data[field];
    if (next === (current[field] === undefined ? null : current[field])) continue;
    sets.push(`${field} = ?`);
    params.push(next);
    changed.push(FIELD_LABELS[field]);
  }
  // Sin contraseña (ausente o vacía) se conserva el cifrado guardado
  if (data.password !== undefined && data.password !== '') {
    sets.push('password = ?');
    params.push(encrypt(data.password));
    changed.push(FIELD_LABELS.password);
  }

  if (sets.length > 0) {
    sets.push('updated_at = ?', 'updated_by = ?');
    params.push(now(), (actor && actor.id) || null, id);
    getDb().prepare(`UPDATE network_credentials SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    writeAudit({ actor, action: 'update', resourceType: RESOURCE_TYPE, resourceId: id, summary: `cambió ${joinLabels(changed)}` });
  }
  return getCredential(id);
}

/** Jobs, conexiones y automatizaciones que usan la credencial. */
function findUsages(id) {
  const db = getDb();
  return {
    jobs: db.prepare('SELECT id, name FROM jobs WHERE output_credential_id = ?').all(id),
    connections: db.prepare('SELECT id, name FROM connections WHERE network_credential_id = ?').all(id),
    // Disparador (carpeta vigilada) o cualquier paso (p. ej. salida de map_export)
    automations: db.prepare(`
      SELECT a.id, a.name FROM automations a
      WHERE a.trigger_config LIKE @pattern
         OR EXISTS (SELECT 1 FROM automation_steps s WHERE s.automation_id = a.id AND s.config LIKE @pattern)
    `).all({ pattern: `%"${id}"%` }),
  };
}

function deleteCredential(id, actor) {
  const current = getDb().prepare('SELECT id, name FROM network_credentials WHERE id = ?').get(id);
  if (!current) throw new NotFoundError('Credencial de red');
  const usages = findUsages(id);
  if (usages.jobs.length + usages.connections.length + usages.automations.length > 0) {
    const err = new ConflictError('La credencial está en uso y no se puede borrar');
    err.details = { usages };
    throw err;
  }
  getDb().prepare('DELETE FROM network_credentials WHERE id = ?').run(id);
  writeAudit({ actor, action: 'delete', resourceType: RESOURCE_TYPE, resourceId: id, summary: `borró la credencial «${current.name}»` });
}

/** Guarda el último resultado de TEST y lo audita (sin secretos). */
function recordTestResult(id, { ok, message, path }, actor) {
  const result = getDb().prepare(`
    UPDATE network_credentials SET last_test_at = ?, last_test_ok = ?, last_test_message = ?, last_test_path = ? WHERE id = ?
  `).run(now(), ok ? 1 : 0, message || null, path || null, id);
  if (result.changes === 0) throw new NotFoundError('Credencial de red');
  writeAudit({
    actor, action: 'test', resourceType: RESOURCE_TYPE, resourceId: id,
    summary: `prueba de acceso ${ok ? 'correcta' : 'fallida'}`,
  });
}

/**
 * Comprueba que una credencial puede asignarse a una ruta (jobs y conexiones): debe existir (404) y la ruta ha de ser UNC (400).
 * Sin credencial no hace nada (cuenta del servicio).
 */
function assertAssignable(credentialId, folderPath) {
  if (!credentialId) return;
  getCredential(credentialId);
  if (!folderPath || !isUncPath(folderPath)) throw new ValidationError(UNC_ONLY_MESSAGE);
}

module.exports = {
  assertAssignable,
  listCredentials, getCredential, getCredentialSecret, createCredential, updateCredential, deleteCredential,
  findUsages, recordTestResult, writeAudit, purgeAuditEvents, UNREADABLE_MESSAGE,
};
