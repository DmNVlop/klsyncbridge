'use strict';

const { AppError } = require('../../utils/errors');

const CONFLICT_MESSAGE = 'Windows solo admite un usuario por servidor en la sesión del servicio: '
  + 'usa una misma credencial, con permisos sobre todas las carpetas de \\\\SERVIDOR, en todas ellas';

const CREDENTIAL_MESSAGES = {
  1326: 'Usuario o contraseña incorrectos',
  86: 'La contraseña no es correcta',
  1330: 'La contraseña de la cuenta ha caducado',
  1331: 'La cuenta está deshabilitada',
  1909: 'La cuenta está bloqueada',
  2202: 'El nombre de usuario no es válido',
  5: 'Acceso denegado: la cuenta no tiene permisos sobre el recurso',
};

const NETWORK_MESSAGES = {
  53: 'No se encuentra la ruta de red: el servidor no es accesible',
  67: 'No se encuentra el nombre del recurso compartido',
  1222: 'La red no está disponible',
  1311: 'No hay servidores de inicio de sesión disponibles',
  64: 'El nombre de red ya no está disponible',
  121: 'Tiempo de espera agotado al conectar con el servidor',
};

/**
 * Clasifica un código Win32 devuelto por WNetAddConnection2W / WNetCancelConnection2W.
 * @param {number} code
 * @returns {{ kind: 'credential'|'conflict'|'network'|'unknown', retryable: boolean, message: string }}
 */
function classifyWinError(code) {
  if (CREDENTIAL_MESSAGES[code]) return { kind: 'credential', retryable: false, message: CREDENTIAL_MESSAGES[code] };
  if (code === 1219) return { kind: 'conflict', retryable: false, message: CONFLICT_MESSAGE };
  if (NETWORK_MESSAGES[code]) return { kind: 'network', retryable: true, message: NETWORK_MESSAGES[code] };
  return { kind: 'unknown', retryable: false, message: `Error de red de Windows (código ${code})` };
}

const STATUS_BY_KIND = { credential: 400, conflict: 400, network: 503, unavailable: 503, unknown: 500 };

class NetworkAccessError extends AppError {
  /**
   * @param {{ kind: string, message: string, winCode?: number, retryable?: boolean }} info
   */
  constructor({ kind, message, winCode = null, retryable = false }) {
    super(message, `NETWORK_ACCESS_${String(kind).toUpperCase()}`, STATUS_BY_KIND[kind] || 500);
    this.name = 'NetworkAccessError';
    this.kind = kind;
    this.winCode = winCode;
    this.retryable = retryable;
  }
}

module.exports = { classifyWinError, NetworkAccessError, CONFLICT_MESSAGE };
