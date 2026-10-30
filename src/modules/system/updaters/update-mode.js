'use strict';

// El Setup registra el servicio con KLSYNC_ENV_FILE (datos en ProgramData): se actualiza con el Setup del Release.
// Sin esa variable es una instalación antigua (carpeta propia): se actualiza con el ZIP de master.
function getUpdateMode(source = process.env) {
  return source.KLSYNC_ENV_FILE ? 'installer' : 'legacy-zip';
}

module.exports = { getUpdateMode };
