'use strict';

const crypto = require('crypto');
const { getDb } = require('../config/database');

/**
 * Registra un evento de auditoría. El `summary` no debe contener secretos.
 * @param {{ actor?: { id?: string, username?: string }, action: string, resourceType: string, resourceId?: string, summary?: string }} event
 */
function writeAudit({ actor, action, resourceType, resourceId = null, summary = null }) {
  getDb().prepare(`
    INSERT INTO audit_events (id, at, user_id, username, action, resource_type, resource_id, summary)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(crypto.randomUUID(), new Date().toISOString(), (actor && actor.id) || null, (actor && actor.username) || null,
    action, resourceType, resourceId, summary);
}

/** Borra los eventos de auditoría más antiguos que `days` días. Devuelve cuántos borró. */
function purgeAuditEvents(days = 365) {
  const limit = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  return getDb().prepare('DELETE FROM audit_events WHERE at < ?').run(limit).changes;
}

module.exports = { writeAudit, purgeAuditEvents };
