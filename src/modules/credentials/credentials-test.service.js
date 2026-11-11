'use strict';

const crypto = require('crypto');
const { ValidationError } = require('../../utils/errors');
const logger = require('../../services/logger.service');
const { parseUncRoot } = require('../../core/network/unc');
const { probeFolder } = require('../../core/files/folder-probe');
const credentialsService = require('./credentials.service');
const { createCredentialAccess, credentialAccess, networkSession } = require('./credential-access.service');

const UNC_ONLY_MESSAGE = 'las credenciales de red solo aplican a rutas \\\\servidor\\recurso';

function defaultDeps() {
  return {
    credentialAccess, probeFolder, session: networkSession, logger,
    getCredential: credentialsService.getCredential,
    recordTestResult: credentialsService.recordTestResult,
  };
}

/** Resumen legible del resultado a partir de los pasos de `probeFolder`. */
function summarize(probe, checkWrite) {
  const failed = probe.steps.find((step) => !step.ok);
  if (failed) return failed.message;
  return checkWrite ? 'Conexión, lectura y escritura correctas.' : 'Conexión y lectura correctas.';
}

/**
 * TEST de acceso por pasos (conectar ⇒ listar ⇒ escribir) a una carpeta de red.
 * - Con `credentialId` y sin `password` usa la credencial guardada y guarda `last_test_*` (con auditoría).
 * - Con `password` (probar antes de guardar) usa una credencial efímera `test:<uuid>` que se desconecta siempre
 *   al terminar. Si el servidor ya está conectado con otra credencial, el paso `connect` sale en rojo con el
 *   mensaje de conflicto: nunca se desconecta la conexión ajena para probar.
 * El resultado no contiene secretos.
 * `pattern` (por defecto `*`) filtra los archivos que cuenta el paso de listado.
 * @returns {Promise<{ ok: boolean, steps: Array<{ name: string, ok: boolean, message: string }>, message: string }>}
 */
async function testFolderAccess(input, actor, overrides = {}) {
  const deps = { ...defaultDeps(), ...overrides };
  const { path, credentialId, checkWrite = false, pattern = '*' } = input;
  if (!parseUncRoot(path)) throw new ValidationError(UNC_ONLY_MESSAGE);

  const useEphemeral = Boolean(input.password);
  // Sin credencial guardada ni contraseña se probaría con la cuenta del servicio y el resultado engañaría
  if (!credentialId && !useEphemeral) throw new ValidationError('Indica la contraseña para probar la credencial');
  let access = deps.credentialAccess;
  let accessId = credentialId;
  let ephemeralId = null;

  if (useEphemeral) {
    let username = input.username;
    let domain = input.domain;
    if (credentialId && !username) {
      const saved = deps.getCredential(credentialId);
      username = saved.username;
      if (domain === undefined) domain = saved.domain;
    }
    if (!username) throw new ValidationError('Indica el usuario de la credencial');
    ephemeralId = `test:${crypto.randomUUID()}`;
    accessId = ephemeralId;
    // La contraseña solo vive en esta clausura, hasta que termina la prueba
    const secret = { id: ephemeralId, domain: domain || null, username, password: input.password };
    access = createCredentialAccess({ getSecret: async () => secret, session: deps.session, logger: deps.logger });
  }

  let probe;
  try {
    probe = await deps.probeFolder(
      { path, pattern, checkWrite },
      { ensureAccess: access.makeEnsureAccess({ path, credentialId: accessId }) },
    );
  } finally {
    if (ephemeralId) {
      try {
        await access.disconnectCredential(ephemeralId);
      } catch (err) {
        deps.logger.warn('No se pudo cancelar la conexión de prueba', { message: err.message });
      }
    }
  }

  const ok = Boolean(probe.accessible) && probe.steps.every((step) => step.ok);
  const message = summarize(probe, checkWrite);
  // Solo la credencial guardada deja huella: una prueba con otra contraseña no representa a la guardada
  if (credentialId && !useEphemeral) {
    deps.recordTestResult(credentialId, { ok, message, path }, actor);
  }
  // Se conservan los campos del probe (accessible, matchingFiles…) para quien ya los consumía
  return { ...probe, ok, steps: probe.steps, message };
}

module.exports = { testFolderAccess };
