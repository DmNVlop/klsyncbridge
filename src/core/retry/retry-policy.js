'use strict';

/**
 * Fecha ISO del próximo intento tras `attempts` intentos fallidos, o null si se agotaron.
 * @param {number} attempts intentos ya hechos (≥ 1)
 * @param {{ delaysMs: number[], maxAttempts: number }} policy
 */
function nextRetryAt(attempts, policy, nowMs = Date.now()) {
  if (attempts >= policy.maxAttempts) return null;
  const { delaysMs } = policy;
  const delay = delaysMs[Math.min(attempts - 1, delaysMs.length - 1)];
  return new Date(nowMs + delay).toISOString();
}

module.exports = { nextRetryAt };
