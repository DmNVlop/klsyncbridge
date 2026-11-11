'use strict';

/**
 * Prueba manual de credenciales de red (UNC) con WNetAddConnection2W.
 *
 * Uso:  node scripts/dev/probe-unc.js <\servidor\recurso> <usuario>
 * La contraseña se lee SOLO de la variable de entorno KLSYNC_PROBE_PASSWORD
 * (nunca por argumento ni se imprime).
 *
 * Excepción a la regla «sin console.log»: es un script de consola fuera de src/,
 * por eso escribe con process.stdout.write.
 *
 * Códigos de salida: 0 todo OK, 1 algún paso falló, 2 uso incorrecto.
 */

const os = require('os');
const fs = require('fs');
const winNet = require('../../src/core/network/win-net');

// Mapa local de códigos Win32 habituales (aún no existe net-errors).
const WIN32_NAMES = {
  0: 'OK',
  5: 'ACCESS_DENIED',
  53: 'BAD_NETPATH',
  67: 'BAD_NET_NAME',
  86: 'INVALID_PASSWORD',
  1219: 'SESSION_CREDENTIAL_CONFLICT',
  1326: 'LOGON_FAILURE',
};

function out(line) {
  process.stdout.write(`${line}\n`);
}

function describe(code) {
  return WIN32_NAMES[code] ? `${code} (${WIN32_NAMES[code]})` : String(code);
}

function printHelp() {
  out('Uso: node scripts/dev/probe-unc.js <\\\\servidor\\recurso> <usuario>');
  out('La contraseña se toma de la variable de entorno KLSYNC_PROBE_PASSWORD.');
}

async function main() {
  const [remoteName, user] = process.argv.slice(2);
  if (!remoteName || !user) {
    printHelp();
    return 2;
  }
  const password = process.env.KLSYNC_PROBE_PASSWORD;
  if (!password) {
    out('ERROR: falta la variable de entorno KLSYNC_PROBE_PASSWORD.');
    return 2;
  }

  out(`Cuenta de ejecución: ${os.userInfo().username}`);
  out(`USERDOMAIN: ${process.env.USERDOMAIN || '(no definido)'}`);

  if (!winNet.isAvailable()) {
    const err = winNet.getLoadError();
    out(`1) Carga de koffi: FALLO (${err ? err.message : 'desconocido'})`);
    return 1;
  }
  out('1) Carga de koffi: OK');

  let connected = false;
  let failed = false;
  try {
    const addCode = winNet.addConnection({ remoteName, user, password });
    out(`2) addConnection: ${addCode === 0 ? 'OK' : 'FALLO'} código ${describe(addCode)}`);
    if (addCode !== 0) {
      failed = true;
    } else {
      connected = true;
      try {
        const entries = await fs.promises.readdir(remoteName);
        out(`3) readdir: OK, ${entries.length} entradas`);
        out(`   Primeras 10: ${entries.slice(0, 10).join(', ') || '(vacío)'}`);
      } catch (err) {
        failed = true;
        out(`3) readdir: FALLO (${err.code || ''} ${err.message})`);
      }
    }
  } catch (err) {
    failed = true;
    out(`2) addConnection: FALLO (${err.message})`);
  } finally {
    if (connected) {
      try {
        const cancelCode = winNet.cancelConnection(remoteName, { force: true });
        out(`4) cancelConnection: ${cancelCode === 0 ? 'OK' : 'FALLO'} código ${describe(cancelCode)}`);
        if (cancelCode !== 0) failed = true;
      } catch (err) {
        failed = true;
        out(`4) cancelConnection: FALLO (${err.message})`);
      }
    }
  }
  return failed ? 1 : 0;
}

main().then(
  (code) => { process.exitCode = code; },
  (err) => { out(`ERROR inesperado: ${err.message}`); process.exitCode = 1; },
);
