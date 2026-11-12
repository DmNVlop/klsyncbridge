'use strict';

/**
 * Binding de WNetAddConnection2W / WNetCancelConnection2W (mpr.dll) mediante koffi.
 *
 * Carga perezosa: koffi solo se carga al primer uso. Si koffi o mpr.dll no están
 * disponibles, isAvailable() devuelve false y connect/disconnect lanzan
 * NetworkAccessError { kind: 'unavailable' }.
 *
 * El `loader` es inyectable para los tests: devuelve { add, cancel }, donde
 *   add(resource, password, user, flags) ⇒ código Win32
 *   cancel(name, flags, force) ⇒ código Win32
 */

const { NetworkAccessError } = require('./net-errors');

const RESOURCETYPE_DISK = 1;
const UNAVAILABLE_MESSAGE = 'Conexión con credenciales no disponible en este equipo';

/**
 * Loader real: enlaza las dos funciones de mpr.dll con koffi (firmas verificadas con koffi 3.3.4).
 * Los tipos de koffi son globales al proceso (un segundo `koffi.struct('NETRESOURCEW')` lanza
 * «Duplicate type name»), así que el enlace se hace una sola vez y se comparte entre instancias.
 */
let processBinding = null;
function koffiLoader() {
  if (!processBinding) processBinding = bindMpr();
  return processBinding;
}

function bindMpr() {
  const koffi = require('koffi');
  const mpr = koffi.load('mpr.dll');
  koffi.struct('NETRESOURCEW', {
    dwScope: 'uint32', dwType: 'uint32', dwDisplayType: 'uint32', dwUsage: 'uint32',
    lpLocalName: 'str16', lpRemoteName: 'str16', lpComment: 'str16', lpProvider: 'str16',
  });
  return {
    add: mpr.func('uint32 __stdcall WNetAddConnection2W(NETRESOURCEW *r, str16 password, str16 user, uint32 flags)'),
    cancel: mpr.func('uint32 __stdcall WNetCancelConnection2W(str16 name, uint32 flags, int force)'),
  };
}

/**
 * @param {{ loader?: () => { add: Function, cancel: Function } }} [options]
 */
function createWinNet({ loader = koffiLoader } = {}) {
  let state = null; // { fns } | { error }

  function load() {
    if (state) return state;
    try {
      state = { fns: loader() };
    } catch (err) {
      state = { error: err };
    }
    return state;
  }

  function requireFns() {
    const s = load();
    if (s.error) throw new NetworkAccessError({ kind: 'unavailable', message: UNAVAILABLE_MESSAGE });
    return s.fns;
  }

  return {
    isAvailable() {
      return !load().error;
    },

    /** Conecta (no persistente, sin letra) a un recurso UNC. `username` ya viene combinado (DOMINIO\usuario). Devuelve el código Win32. */
    connect({ root, username, password }) {
      const fns = requireFns();
      const resource = {
        dwScope: 0, dwType: RESOURCETYPE_DISK, dwDisplayType: 0, dwUsage: 0,
        lpLocalName: null, lpRemoteName: root, lpComment: null, lpProvider: null,
      };
      return fns.add(resource, password, username, 0);
    },

    /** Cancela la conexión a un recurso UNC. Devuelve el código Win32. */
    disconnect(root, { force = false } = {}) {
      const fns = requireFns();
      return fns.cancel(root, 0, force ? 1 : 0);
    },
  };
}

module.exports = { createWinNet };
