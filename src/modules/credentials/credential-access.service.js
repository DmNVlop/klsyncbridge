'use strict';

const { ValidationError } = require('../../utils/errors');
const logger = require('../../services/logger.service');
const { parseUncRoot } = require('../../core/network/unc');
const { getNetworkSession } = require('../../core/network/network-session');
const { NetworkAccessError } = require('../../core/network/net-errors');
const { describeFsError } = require('../../core/files/paths');
const credentialsService = require('./credentials.service');

const UNC_ONLY_MESSAGE = 'las credenciales de red solo aplican a rutas \\\\servidor\\recurso';
// Códigos de fs que pueden indicar una sesión de red caída o caducada
const RETRYABLE_FS_CODES = new Set(['ENOENT', 'EACCES', 'EPERM', 'UNKNOWN']);

/**
 * Acceso a carpetas de red con credencial: resuelve y descifra justo antes de conectar y reintenta una vez.
 * @param {{ getSecret: Function, session: object, logger: object }} deps
 */
function createCredentialAccess({ getSecret, session, logger: log }) {
  /**
   * Garantiza la conexión con la credencial asignada. Sin credencial no hace nada (cuenta del servicio).
   * @param {{ path: string, credentialId?: string|null, reconnect?: boolean }} target
   */
  async function ensureAccess({ path, credentialId, reconnect = false }) {
    if (!credentialId) return;
    const parsed = parseUncRoot(path);
    if (!parsed) throw new ValidationError(UNC_ONLY_MESSAGE);
    // La contraseña vive solo en estas variables locales
    const secret = await getSecret(credentialId);
    const username = secret.domain ? `${secret.domain}\\${secret.username}` : secret.username;
    await session.ensureConnected(
      { root: parsed.root, credentialId, username, password: secret.password },
      { reconnect },
    );
  }

  /**
   * Ejecuta `fn` con el acceso garantizado. Con credencial, si `fn` falla por un código de red/acceso
   * reconecta y reintenta UNA sola vez; si vuelve a fallar, lanza un error clasificado.
   */
  async function withFolderAccess({ path, credentialId }, fn) {
    if (!credentialId) return fn();
    await ensureAccess({ path, credentialId });
    try {
      return await fn();
    } catch (firstError) {
      if (!firstError || !RETRYABLE_FS_CODES.has(firstError.code)) throw firstError;
      log.warn('Acceso a la carpeta de red fallido, se reconecta una vez', { path, credentialId, code: firstError.code });
      await ensureAccess({ path, credentialId, reconnect: true });
      try {
        return await fn();
      } catch (secondError) {
        if (!secondError || !RETRYABLE_FS_CODES.has(secondError.code)) throw secondError;
        // Permisos: con la credencial conectada, la cuenta no puede; lo arregla una persona (no se reintenta).
        // Resto (ENOENT/UNKNOWN): la red o la ruta pueden volver; reintentable.
        // 'unavailable' queda reservado para «koffi no carga en este equipo».
        const permissionDenied = secondError.code === 'EACCES' || secondError.code === 'EPERM';
        const error = new NetworkAccessError({
          kind: permissionDenied ? 'credential' : 'network',
          message: describeFsError(secondError, path, { hasCredential: true }),
          retryable: !permissionDenied,
        });
        error.fsCode = secondError.code;
        throw error;
      }
    }
  }

  /** Hook para `core/files`: `({ reconnect }) => ensureAccess(...)`. */
  function makeEnsureAccess({ path, credentialId }) {
    return ({ reconnect } = {}) => ensureAccess({ path, credentialId, reconnect });
  }

  function disconnectCredential(id) {
    return session.disconnectCredential(id);
  }

  return { ensureAccess, withFolderAccess, makeEnsureAccess, disconnectCredential };
}

// La sesión real se crea al primer uso (carga perezosa del binding nativo)
const lazySession = {
  ensureConnected: (...args) => getNetworkSession().ensureConnected(...args),
  disconnectCredential: (id) => getNetworkSession().disconnectCredential(id),
};

const credentialAccess = createCredentialAccess({
  getSecret: credentialsService.getCredentialSecret,
  session: lazySession,
  logger,
});

module.exports = { createCredentialAccess, credentialAccess, networkSession: lazySession };
