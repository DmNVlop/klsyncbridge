'use strict';

/**
 * Gestor único de conexiones de red (UNC con credenciales) del proceso.
 *
 * Windows solo admite un usuario por servidor en la sesión del servicio (error 1219), así que el
 * registro es `servidor ⇒ { credentialId, shares }` y los `connect` de un mismo servidor se
 * serializan con una cola por servidor (dos jobs contra el mismo recurso comparten una conexión).
 * Servidores distintos no se bloquean entre sí.
 *
 * La contraseña solo viaja a `winNet.connect`: nunca se guarda en el registro ni se escribe en el logger.
 * `core/` no importa de `modules/`: el logger llega por parámetro.
 */

const { parseUncRoot } = require('./unc');
const { classifyWinError, NetworkAccessError, conflictMessage } = require('./net-errors');

/**
 * @param {{ winNet: object, logger: object }} deps
 */
function createNetworkSession({ winNet, logger }) {
  /** server ⇒ { credentialId, shares: Map(shareKey ⇒ { share, root, connectedAt }) } */
  const registry = new Map();
  /** server ⇒ Promise (cola que serializa las operaciones del servidor) */
  const queues = new Map();

  function enqueue(server, task) {
    const tail = (queues.get(server) || Promise.resolve()).then(task);
    queues.set(server, tail.catch(() => undefined));
    return tail;
  }

  async function connectOnce({ parsed, credentialId, username, password }, reconnect) {
    const { server, share } = parsed;
    const shareKey = share.toLowerCase();
    let entry = registry.get(server);

    if (entry && entry.credentialId !== credentialId) {
      throw new NetworkAccessError({ kind: 'conflict', message: conflictMessage(server, 'credential') });
    }
    if (entry && entry.shares.has(shareKey)) {
      if (!reconnect) return;
      await winNet.disconnect(parsed.root, { force: true });
      entry.shares.delete(shareKey);
    }

    const code = await winNet.connect({ root: parsed.root, username, password });
    if (code !== 0) {
      // Un servidor sin recursos conectados no debe seguir reservado para esta credencial
      // (p. ej. tras una reconexión fallida), o bloquearía a las demás con un conflicto falso.
      if (entry && entry.shares.size === 0) registry.delete(server);
      const info = classifyWinError(code, { server });
      logger.warn('No se pudo conectar con el recurso de red', { server, share, credentialId, winCode: code, kind: info.kind });
      throw new NetworkAccessError({ ...info, winCode: code });
    }

    if (!entry) {
      entry = { credentialId, shares: new Map() };
      registry.set(server, entry);
    }
    entry.shares.set(shareKey, { share, root: parsed.root, connectedAt: new Date().toISOString() });
    logger.info('Conexión de red establecida', { server, share, credentialId });
  }

  /**
   * Garantiza que el recurso UNC está conectado con la credencial indicada.
   * @param {{ root: string, credentialId: string, username: string, password: string }} target
   * @param {{ reconnect?: boolean }} [options]
   */
  function ensureConnected({ root, credentialId, username, password }, { reconnect = false } = {}) {
    const parsed = parseUncRoot(root);
    if (!parsed) {
      return Promise.reject(new NetworkAccessError({ kind: 'unknown', message: 'La ruta no es un recurso de red válido (\\\\servidor\\recurso)' }));
    }
    return enqueue(parsed.server, () => connectOnce({ parsed, credentialId, username, password }, reconnect));
  }

  async function disconnectServer(server) {
    const entry = registry.get(server);
    if (!entry) return;
    for (const { share, root } of entry.shares.values()) {
      try {
        const code = await winNet.disconnect(root, { force: true });
        if (code !== 0) logger.warn('No se pudo cancelar la conexión de red', { server, share, winCode: code });
      } catch (err) {
        logger.warn('Error al cancelar la conexión de red', { server, share, message: err.message });
      }
    }
    registry.delete(server);
    logger.info('Conexiones de red canceladas', { server, credentialId: entry.credentialId });
  }

  /** Cancela todos los recursos conectados con esa credencial (al editarla o borrarla). */
  function disconnectCredential(credentialId) {
    const servers = [...registry.entries()].filter(([, e]) => e.credentialId === credentialId).map(([s]) => s);
    return Promise.all(servers.map((server) => enqueue(server, () => disconnectServer(server)))).then(() => undefined);
  }

  /** Cancela todas las conexiones (al parar el servicio). */
  function disconnectAll() {
    return Promise.all([...registry.keys()].map((server) => enqueue(server, () => disconnectServer(server)))).then(() => undefined);
  }

  /** Conexiones activas para la pantalla «Sistema». Sin contraseñas. */
  function listConnections() {
    const list = [];
    for (const [server, entry] of registry) {
      for (const { share, connectedAt } of entry.shares.values()) {
        list.push({ server, share, credentialId: entry.credentialId, connectedAt });
      }
    }
    return list;
  }

  return { ensureConnected, disconnectCredential, disconnectAll, listConnections };
}

let singleton = null;

/** Instancia única del proceso, creada al primer uso con el win-net real y el logger real. */
function getNetworkSession() {
  if (!singleton) {
    const { createWinNet } = require('./win-net');
    const logger = require('../../services/logger.service');
    singleton = createNetworkSession({ winNet: createWinNet(), logger });
  }
  return singleton;
}

module.exports = { createNetworkSession, getNetworkSession };
