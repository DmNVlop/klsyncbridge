'use strict';

const path = require('path');

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

module.exports = { normalizeItemKey, isUncPath, isAbsoluteWindowsPath, matchesPattern, describeFsError };
