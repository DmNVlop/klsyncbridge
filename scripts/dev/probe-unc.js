'use strict';

/**
 * Prueba manual de credenciales de red (UNC) con WNetAddConnection2W.
 *
 * Uso:  node scripts/dev/probe-unc.js <\\servidor\recurso> <usuario>
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
const { createWinNet } = require('../../src/core/network/win-net');
const { classifyWinError } = require('../../src/core/network/net-errors');

function out(line) {
  process.stdout.write(`${line}\n`);
}

function describe(code) {
  return code === 0 ? '0 (OK)' : `${code} [${classifyWinError(code).kind}] ${classifyWinError(code).message}`;
}

function printHelp() {
  out('Uso: node scripts/dev/probe-unc.js <\\\\servidor\\recurso> <usuario>');
  out('La contraseña se toma de la variable de entorno KLSYNC_PROBE_PASSWORD.');
}

async function main() {
  const [root, username] = process.argv.slice(2);
  if (!root || !username) {
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

  const winNet = createWinNet();
  if (!winNet.isAvailable()) {
    out('1) Carga de koffi: FALLO (no disponible en este equipo)');
    return 1;
  }
  out('1) Carga de koffi: OK');

  let connected = false;
  let failed = false;
  try {
    const addCode = winNet.connect({ root, username, password });
    out(`2) connect: ${addCode === 0 ? 'OK' : 'FALLO'} código ${describe(addCode)}`);
    if (addCode !== 0) {
      failed = true;
    } else {
      connected = true;
      try {
        const entries = await fs.promises.readdir(root);
        out(`3) readdir: OK, ${entries.length} entradas`);
        out(`   Primeras 10: ${entries.slice(0, 10).join(', ') || '(vacío)'}`);
      } catch (err) {
        failed = true;
        out(`3) readdir: FALLO (${err.code || ''} ${err.message})`);
      }
    }
  } catch (err) {
    failed = true;
    out(`2) connect: FALLO (${err.message})`);
  } finally {
    if (connected) {
      try {
        const cancelCode = winNet.disconnect(root, { force: true });
        out(`4) disconnect: ${cancelCode === 0 ? 'OK' : 'FALLO'} código ${describe(cancelCode)}`);
        if (cancelCode !== 0) failed = true;
      } catch (err) {
        failed = true;
        out(`4) disconnect: FALLO (${err.message})`);
      }
    }
  }
  return failed ? 1 : 0;
}

main().then(
  (code) => { process.exitCode = code; },
  (err) => { out(`ERROR inesperado: ${err.message}`); process.exitCode = 1; },
);
