'use strict';

const path = require('path');
const { AppError } = require('../../utils/errors');

// Rutas siempre con semántica Windows (el servicio corre en Windows), también en tests.
const win = path.win32;

/** Clave estable de un archivo: ruta Windows normalizada en minúsculas (Windows no distingue mayúsculas). */
function normalizeItemKey(filePath) {
  return win.normalize(filePath).toLowerCase();
}

function isUncPath(p) {
  return /^\\\\[^\\]+\\[^\\]+/.test(win.normalize(p));
}

/** Local con unidad (C:\…) o de red (\\servidor\recurso\…). */
function isAbsoluteWindowsPath(p) {
  const normalized = win.normalize(p);
  return /^[a-zA-Z]:\\/.test(normalized) || isUncPath(normalized);
}

/**
 * Valida y normaliza una ruta de origen o salida configurada por el usuario.
 * Acepta absoluta local (C:\...) o UNC (\\servidor\recurso\...). Nunca resuelve una relativa contra `cwd`.
 * @param {string} p
 * @returns {string} ruta normalizada con semántica Windows
 * @throws {AppError} INVALID_PATH (400) si no es una ruta absoluta válida
 */
function resolveConfiguredPath(p) {
  const invalid = (message) => new AppError(message, 'INVALID_PATH', 400);
  if (typeof p !== 'string' || p.trim() === '') throw invalid('La ruta está vacía');
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(p)) throw invalid('La ruta contiene caracteres no permitidos');
  const slashed = p.replace(/\//g, '\\');
  if (slashed.startsWith('\\\\?\\') || slashed.startsWith('\\\\.\\')) {
    throw invalid('No se admiten rutas de dispositivo (\\\\?\\ o \\\\.\\)');
  }
  const normalized = win.normalize(slashed);
  if (!isAbsoluteWindowsPath(normalized)) {
    throw invalid('La ruta debe ser absoluta (C:\\carpeta o \\\\servidor\\recurso)');
  }
  return normalized;
}

function patternToRegExp(pattern) {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i');
}

/** Comodines * y ?, sin distinguir mayúsculas. */
function matchesPattern(fileName, pattern) {
  return patternToRegExp(pattern).test(fileName);
}

const FS_ERROR_MESSAGES = {
  ENOENT: 'la carpeta no existe o la ruta de red no está disponible',
  ENOTDIR: 'la ruta no es una carpeta',
  EACCES: 'acceso denegado',
  EPERM: 'acceso denegado',
  EBUSY: 'la carpeta está bloqueada por otro proceso',
  ETIMEDOUT: 'tiempo de espera agotado al acceder a la red',
  EHOSTUNREACH: 'el servidor de red no responde',
  ENETUNREACH: 'la red no está disponible',
  EINVAL: 'ruta no válida',
};

const SERVICE_ACCOUNT_HINT = 'Si es una ruta de red, el servicio debe ejecutarse con una cuenta con permisos sobre ella (LocalSystem no accede a carpetas de red).';

/** Error del sistema de archivos ⇒ mensaje en español para la UI (con la pista de la cuenta del servicio en rutas UNC). */
function describeFsError(err, folderPath) {
  const reason = FS_ERROR_MESSAGES[err && err.code] || (err && err.message) || 'error desconocido';
  const base = `No se puede acceder a la carpeta: ${reason}.`;
  return folderPath && isUncPath(folderPath) ? `${base} ${SERVICE_ACCOUNT_HINT}` : base;
}

module.exports = { normalizeItemKey, isUncPath, isAbsoluteWindowsPath, resolveConfiguredPath, matchesPattern, describeFsError };
