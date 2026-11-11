'use strict';

/**
 * Binding mínimo (versión del spike) de WNetAddConnection2W / WNetCancelConnection2W
 * de mpr.dll mediante koffi. La versión final, inyectable, llega en la tarea 7.
 *
 * Carga perezosa: si koffi o mpr.dll no están disponibles, el módulo no lanza al
 * hacer require; isAvailable() devuelve false y getLoadError() guarda el motivo.
 *
 * Diferencias con las firmas del plan (koffi 3.3.4): ninguna. Se mantienen
 * `koffi.struct` con campos 'str16', `lib.func('uint32 __stdcall ...')` y `null`
 * para pasar un str16 nulo (lpLocalName, lpComment, lpProvider).
 */

const RESOURCETYPE_DISK = 1;

let state = null; // { fns } | { error }

function load() {
  if (state) return state;
  try {
    const koffi = require('koffi');
    const mpr = koffi.load('mpr.dll');
    const NETRESOURCEW = koffi.struct('NETRESOURCEW', {
      dwScope: 'uint32', dwType: 'uint32', dwDisplayType: 'uint32', dwUsage: 'uint32',
      lpLocalName: 'str16', lpRemoteName: 'str16', lpComment: 'str16', lpProvider: 'str16',
    });
    void NETRESOURCEW;
    state = {
      add: mpr.func('uint32 __stdcall WNetAddConnection2W(NETRESOURCEW *r, str16 password, str16 user, uint32 flags)'),
      cancel: mpr.func('uint32 __stdcall WNetCancelConnection2W(str16 name, uint32 flags, int force)'),
    };
  } catch (err) {
    state = { error: err };
  }
  return state;
}

function isAvailable() {
  return !load().error;
}

function getLoadError() {
  return load().error || null;
}

function requireLoaded() {
  const s = load();
  if (s.error) throw new Error(`win-net no disponible: ${s.error.message}`);
  return s;
}

/** Conecta (no persistente, sin letra) a un recurso UNC. Devuelve el código Win32 (0 = OK). */
function addConnection({ remoteName, user, password }) {
  const s = requireLoaded();
  const resource = {
    dwScope: 0, dwType: RESOURCETYPE_DISK, dwDisplayType: 0, dwUsage: 0,
    lpLocalName: null, lpRemoteName: remoteName, lpComment: null, lpProvider: null,
  };
  return s.add(resource, password, user, 0);
}

/** Cancela la conexión a un recurso UNC. Devuelve el código Win32 (0 = OK). */
function cancelConnection(remoteName, { force = false } = {}) {
  const s = requireLoaded();
  return s.cancel(remoteName, 0, force ? 1 : 0);
}

module.exports = { isAvailable, getLoadError, addConnection, cancelConnection };
