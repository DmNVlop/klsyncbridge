'use strict';

const crypto = require('crypto');

/** Huella del contenido: sha256 hexadecimal. */
function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

module.exports = { sha256 };
