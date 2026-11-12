'use strict';

/**
 * Consulta y arranque del servicio de Windows con sc.exe, y espera a que llegue a RUNNING.
 * node-windows `svc.start()` no avisa si el arranque falla (solo escribe en el Visor de eventos),
 * así que el estado real se comprueba siempre con sc.exe.
 */

const { execFileSync } = require('child_process');
const { decodeCp850 } = require('./windows-console');

const SERVICE_ID = 'klsyncbridge.exe';
const SC_SERVICE_NOT_FOUND = 1060;
const SC_SERVICE_ALREADY_RUNNING = 1056;

// Los nombres de estado salen en inglés en cualquier idioma de Windows; solo cambia la etiqueta («ESTADO», «STATE»…).
const STATE_REGEX = /:\s*\d+\s+(STOPPED|START_PENDING|STOP_PENDING|RUNNING|CONTINUE_PENDING|PAUSE_PENDING|PAUSED)\b/i;
// «CÓDIGO_DE_SALIDA_DE_WIN32 : 1077 (0x435)» / «WIN32_EXIT_CODE : 1077 (0x435)»; el código propio del servicio no lleva WIN32.
const WIN32_EXIT_CODE_REGEX = /WIN32[^\r\n:]*:\s*(\d+)\s*\(0x/i;

/** Nombre del estado (p. ej. RUNNING) de la salida de `sc query`, o null si no se reconoce. */
function parseServiceState(text) {
  const match = STATE_REGEX.exec(String(text || ''));
  return match ? match[1].toUpperCase() : null;
}

/** `{ state, win32ExitCode }` de la salida de `sc query` (cada uno null si no aparece). */
function parseServiceStatus(text) {
  const exit = WIN32_EXIT_CODE_REGEX.exec(String(text || ''));
  return { state: parseServiceState(text), win32ExitCode: exit ? Number(exit[1]) : null };
}

/** Ejecuta sc.exe y devuelve su salida ya decodificada (OEM 850). Si falla, lanza un error con `status` y `output`. */
function defaultExec(args) {
  try {
    return decodeCp850(execFileSync('sc.exe', args, { stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000 }));
  } catch (err) {
    const wrapped = new Error(err.message);
    wrapped.status = err.status;
    wrapped.code = err.code;
    wrapped.output = decodeCp850(err.stdout || Buffer.alloc(0)) + decodeCp850(err.stderr || Buffer.alloc(0));
    throw wrapped;
  }
}

/** Estado del servicio: `{ installed: false }` si no existe (1060) o `{ installed, state, win32ExitCode }`. */
function queryServiceState(id = SERVICE_ID, { exec = defaultExec } = {}) {
  let output;
  try {
    output = exec(['query', id]);
  } catch (err) {
    if (err.status === SC_SERVICE_NOT_FOUND) return { installed: false };
    throw new Error(`No se pudo consultar el servicio ${id} con sc.exe (código ${err.status ?? err.code ?? 'desconocido'})`);
  }
  return { installed: true, ...parseServiceStatus(output) };
}

/** Pide a Windows que arranque el servicio; si ya estaba en marcha (1056) no es un error. */
function startService(id = SERVICE_ID, { exec = defaultExec } = {}) {
  try {
    exec(['start', id]);
  } catch (err) {
    if (err.status === SC_SERVICE_ALREADY_RUNNING) return;
    const detail = err.output ? `: ${String(err.output).trim()}` : '';
    throw new Error(`No se pudo arrancar el servicio ${id} con sc.exe (código ${err.status ?? err.code ?? 'desconocido'})${detail}`);
  }
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Deja el servicio en RUNNING: lo arranca si está parado (hasta `maxStartAttempts` veces) y espera a que llegue.
 * Lanza un error en español si no está instalado, si se agotan los intentos o si pasa `timeoutMs`.
 */
async function ensureServiceRunning(id = SERVICE_ID, {
  timeoutMs = 60000,
  pollMs = 1000,
  maxStartAttempts = 3,
  query = (serviceId) => queryServiceState(serviceId),
  start = (serviceId) => startService(serviceId),
  sleep = defaultSleep,
} = {}) {
  const deadline = Date.now() + timeoutMs;
  let attempts = 0;
  let last = {};

  while (Date.now() < deadline) {
    last = query(id);
    if (!last.installed) throw new Error(`El servicio ${id} no está instalado en Windows`);

    if (last.state === 'RUNNING') return last.state;

    if (last.state === 'STOPPED') {
      if (attempts >= maxStartAttempts) {
        throw new Error(`El servicio ${id} se detiene tras ${attempts} intentos de arranque (código Win32: ${last.win32ExitCode ?? 'desconocido'})`);
      }
      attempts += 1;
      start(id);
    }
    // START_PENDING, STOP_PENDING, CONTINUE_PENDING, estado no reconocido…: esperar y volver a mirar.
    await sleep(pollMs);
  }

  throw new Error(
    `El servicio ${id} no llegó a RUNNING en ${Math.round(timeoutMs / 1000)} s (estado: ${last.state ?? 'desconocido'}, código Win32: ${last.win32ExitCode ?? 'desconocido'})`,
  );
}

module.exports = {
  SERVICE_ID,
  parseServiceState,
  parseServiceStatus,
  queryServiceState,
  startService,
  ensureServiceRunning,
};
