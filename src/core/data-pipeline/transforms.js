'use strict';

const { TRANSFORMS } = require('../../config/constants');

/** Aplica el transform de un campo; el default sustituye a null/undefined antes de transformar. */
function applyTransform(value, transform, defaultValue) {
  const val = (value === null || value === undefined) ? defaultValue : value;
  if (val === null || val === undefined) return null;

  switch (transform) {
    case TRANSFORMS.UPPERCASE: return String(val).toUpperCase();
    case TRANSFORMS.LOWERCASE: return String(val).toLowerCase();
    case TRANSFORMS.TRIM: return String(val).trim();
    case TRANSFORMS.NUMBER: return parseFloat(val);
    case TRANSFORMS.BOOLEAN: return val === 1 || val === true || val === 'true' || val === 'True';
    case TRANSFORMS.DATE_ISO: return val instanceof Date ? val.toISOString() : new Date(val).toISOString();
    case TRANSFORMS.STRING: return String(val);
    case TRANSFORMS.NONE:
    default: return val;
  }
}

module.exports = { applyTransform };
