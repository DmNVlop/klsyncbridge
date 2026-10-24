'use strict';

const crypto = require('crypto');
const { getDb } = require('../../config/database');
const { AUTOMATION_ITEM_STATUSES: S, AUTOMATION_OUTCOMES: O } = require('../../config/constants');
const { NotFoundError, ConflictError } = require('../../utils/errors');
const { nextRetryAt } = require('../retry/retry-policy');

// Resultados que dejan el ítem en un estado final
const FINAL_STATUS_BY_OUTCOME = { [O.DONE]: S.DONE, [O.REJECTED]: S.REJECTED, [O.INVALID]: S.INVALID };
const DAY_MS = 24 * 60 * 60 * 1000;

const nowIso = () => new Date().toISOString();

function parseItem(row) {
  return row ? { ...row, meta: row.meta ? JSON.parse(row.meta) : null } : null;
}

function getItem(itemId) {
  const row = getDb().prepare('SELECT * FROM work_items WHERE id = ?').get(itemId);
  if (!row) throw new NotFoundError('Archivo');
  return parseItem(row);
}

function findItem(automationId, itemKey) {
  return parseItem(getDb().prepare('SELECT * FROM work_items WHERE automation_id = ? AND item_key = ?').get(automationId, itemKey));
}

/** ¿Existe ya con el mismo tamaño y fecha? Entonces no hace falta releer ni calcular la huella. */
function isKnownUnchanged(automationId, itemKey, { size, mtimeMs }) {
  const item = findItem(automationId, itemKey);
  return Boolean(item && item.meta && item.meta.size === size && item.meta.mtimeMs === mtimeMs);
}

/**
 * Alta o actualización de un archivo en la cola.
 * - nuevo ⇒ pending; mismo contenido ⇒ solo actualiza meta; contenido distinto ⇒ pending con attempts = 0
 *   (si se está procesando, se guarda la huella nueva y completeAttempt lo devolverá a pending).
 * @returns {{ action: 'created'|'unchanged'|'requeued', item }}
 */
function enqueue({ automationId, itemKey, displayName, fingerprint, meta }) {
  const db = getDb();
  const ts = nowIso();
  const metaJson = JSON.stringify(meta || {});
  const existing = findItem(automationId, itemKey);

  if (!existing) {
    const id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO work_items (id, automation_id, item_key, display_name, fingerprint, status, attempts, meta, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
    `).run(id, automationId, itemKey, displayName, fingerprint, S.PENDING, metaJson, ts, ts);
    return { action: 'created', item: getItem(id) };
  }

  if (existing.fingerprint === fingerprint) {
    db.prepare('UPDATE work_items SET display_name = ?, meta = ? WHERE id = ?').run(displayName, metaJson, existing.id);
    return { action: 'unchanged', item: getItem(existing.id) };
  }

  if (existing.status === S.PROCESSING) {
    db.prepare('UPDATE work_items SET fingerprint = ?, display_name = ?, meta = ?, updated_at = ? WHERE id = ?')
      .run(fingerprint, displayName, metaJson, ts, existing.id);
  } else {
    db.prepare(`
      UPDATE work_items SET fingerprint = ?, status = ?, attempts = 0, next_retry_at = NULL,
        display_name = ?, meta = ?, updated_at = ?
      WHERE id = ?
    `).run(fingerprint, S.PENDING, displayName, metaJson, ts, existing.id);
  }
  return { action: 'requeued', item: getItem(existing.id) };
}

/** Toma hasta `limit` ítems pendientes o con reintento vencido (por orden de llegada) y los marca en proceso. */
function claimDue(automationId, limit, now = nowIso()) {
  const db = getDb();
  return db.transaction(() => {
    const rows = db.prepare(`
      SELECT * FROM work_items
      WHERE automation_id = ? AND (status = ? OR (status = ? AND next_retry_at <= ?))
      ORDER BY updated_at ASC
      LIMIT ?
    `).all(automationId, S.PENDING, S.RETRY_WAIT, now, limit);
    const mark = db.prepare('UPDATE work_items SET status = ?, updated_at = ? WHERE id = ?');
    for (const row of rows) mark.run(S.PROCESSING, now, row.id);
    return rows.map((row) => parseItem({ ...row, status: S.PROCESSING, updated_at: now }));
  })();
}

function resolveNextState(current, claimed, outcome, policy, nowMs) {
  // Llegó contenido nuevo mientras se enviaba el anterior: se sube desde cero
  if (current.fingerprint !== claimed.fingerprint) {
    return { status: S.PENDING, attempts: 0, nextRetryAt: null, changedMeanwhile: true };
  }
  if (outcome === O.HALT) return { status: S.PENDING, attempts: current.attempts, nextRetryAt: null };
  const attempts = current.attempts + 1;
  if (FINAL_STATUS_BY_OUTCOME[outcome]) return { status: FINAL_STATUS_BY_OUTCOME[outcome], attempts, nextRetryAt: null };
  const retryAt = nextRetryAt(attempts, policy, nowMs);
  return retryAt
    ? { status: S.RETRY_WAIT, attempts, nextRetryAt: retryAt }
    : { status: S.FAILED, attempts, nextRetryAt: null };
}

/**
 * Registra un intento y fija el nuevo estado del ítem en una sola transacción.
 * @param {object} claimed el ítem tal como lo devolvió claimDue
 * @param {{ outcome, result, durationMs, policy, nowMs? }} attempt
 */
function completeAttempt(claimed, { outcome, result = {}, durationMs, policy, nowMs = Date.now() }) {
  const db = getDb();
  const ts = new Date(nowMs).toISOString();
  return db.transaction(() => {
    const current = getItem(claimed.id);
    const sentFingerprint = result.fingerprint || current.fingerprint;
    const next = resolveNextState(current, claimed, outcome, policy, nowMs);

    db.prepare(`
      INSERT INTO work_item_attempts (id, work_item_id, attempted_at, fingerprint, outcome, http_status, result_status,
        message, external_ref, external_version, duration_ms, triggered_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(), current.id, ts, sentFingerprint, outcome,
      result.http_status ?? null, result.status ?? null, result.message ?? null,
      result.external_ref ?? null, result.external_version ?? null,
      durationMs ?? null, current.requested_by || 'auto',
    );

    db.prepare(`
      UPDATE work_items SET status = ?, attempts = ?, next_retry_at = ?, fingerprint = ?,
        last_http_status = ?, last_result_status = ?, last_message = ?,
        external_ref = COALESCE(?, external_ref), external_version = COALESCE(?, external_version),
        requested_by = NULL, updated_at = ?
      WHERE id = ?
    `).run(
      next.status, next.attempts, next.nextRetryAt,
      next.changedMeanwhile ? current.fingerprint : sentFingerprint,
      result.http_status ?? null, result.status ?? null, result.message ?? null,
      result.external_ref ?? null, result.external_version ?? null,
      ts, current.id,
    );
    return getItem(current.id);
  })();
}

/** Al arrancar el servicio: lo que quedó en proceso vuelve a pendiente (reenviar es seguro: la plataforma responde UNCHANGED). */
function resetProcessing() {
  return getDb().prepare('UPDATE work_items SET status = ?, updated_at = ? WHERE status = ?')
    .run(S.PENDING, nowIso(), S.PROCESSING).changes;
}

/** Botón «Reintentar»: vuelve a pending y el siguiente intento quedará registrado como manual:<usuario>. */
function requestManualRetry(itemId, username) {
  const item = getItem(itemId);
  if (item.status === S.PROCESSING) throw new ConflictError('El archivo se está procesando ahora mismo');
  getDb().prepare(`
    UPDATE work_items SET status = ?, attempts = 0, next_retry_at = NULL, requested_by = ?, updated_at = ?
    WHERE id = ?
  `).run(S.PENDING, `manual:${username}`, nowIso(), itemId);
  return getItem(itemId);
}

function nextDueAt(automationId) {
  const row = getDb().prepare('SELECT MIN(next_retry_at) AS next FROM work_items WHERE automation_id = ? AND status = ?')
    .get(automationId, S.RETRY_WAIT);
  return row ? row.next : null;
}

function escapeLike(text) {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Listado paginado en servidor, más recientes primero. */
function listItems(automationId, { status, search, page = 1, perPage = 25 } = {}) {
  const where = ['automation_id = ?'];
  const params = [automationId];
  if (status) { where.push('status = ?'); params.push(status); }
  if (search) { where.push("display_name LIKE ? ESCAPE '\\'"); params.push(`%${escapeLike(search)}%`); }
  const clause = where.join(' AND ');
  const db = getDb();
  const total = db.prepare(`SELECT COUNT(*) AS n FROM work_items WHERE ${clause}`).get(...params).n;
  const rows = db.prepare(`SELECT * FROM work_items WHERE ${clause} ORDER BY updated_at DESC LIMIT ? OFFSET ?`)
    .all(...params, perPage, (page - 1) * perPage)
    .map(parseItem);
  return { rows, total };
}

function listAttempts(itemId) {
  getItem(itemId);
  return getDb().prepare('SELECT * FROM work_item_attempts WHERE work_item_id = ? ORDER BY attempted_at DESC LIMIT 200').all(itemId);
}

function countsByStatus(automationId) {
  const counts = Object.fromEntries(Object.values(S).map((s) => [s, 0]));
  const rows = getDb().prepare('SELECT status, COUNT(*) AS n FROM work_items WHERE automation_id = ? GROUP BY status').all(automationId);
  for (const row of rows) counts[row.status] = row.n;
  return counts;
}

/** Historial: se purgan intentos de más de `days` días; los work_items nunca (son el estado de cada archivo). */
function purgeAttempts(days) {
  const cutoff = new Date(Date.now() - days * DAY_MS).toISOString();
  return getDb().prepare('DELETE FROM work_item_attempts WHERE attempted_at < ?').run(cutoff).changes;
}

module.exports = {
  getItem,
  isKnownUnchanged,
  enqueue,
  claimDue,
  completeAttempt,
  resetProcessing,
  requestManualRetry,
  nextDueAt,
  listItems,
  listAttempts,
  countsByStatus,
  purgeAttempts,
};
