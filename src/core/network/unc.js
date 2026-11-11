'use strict';

/**
 * Extrae servidor y recurso compartido de una ruta UNC.
 * `root` usa el servidor en minúsculas (clave de la cola de conexiones) y el recurso con su caso original.
 * Devuelve null si no es UNC, si es `\\?\` o `\\.\`, o si falta servidor o recurso.
 * @param {string} p
 * @returns {{ server: string, share: string, root: string } | null}
 */
function parseUncRoot(p) {
  if (typeof p !== 'string') return null;
  const normalized = p.replace(/\//g, '\\');
  if (!normalized.startsWith('\\\\')) return null;
  const [server, share] = normalized.slice(2).split('\\');
  if (!server || !share) return null;
  if (server === '?' || server === '.') return null;
  const serverKey = server.toLowerCase();
  return { server: serverKey, share, root: `\\\\${serverKey}\\${share}` };
}

module.exports = { parseUncRoot };
