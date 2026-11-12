'use strict';

const { applyTransform } = require('./transforms');
const { evaluateExpression } = require('./expressions');

function setNestedValue(obj, dotPath, value) {
  const keys = dotPath.split('.');
  let current = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (!current[keys[i]]) current[keys[i]] = {};
    current = current[keys[i]];
  }
  current[keys[keys.length - 1]] = value;
}

/** Valor de un campo del mapeo: 'static' = default_value literal; 'expression'; 'field' (por defecto). */
function resolveFieldValue(map, record) {
  const sourceType = map.source_type || 'field';
  if (sourceType === 'static') return map.default_value ?? null;
  if (sourceType === 'expression') {
    return applyTransform(evaluateExpression(map.expression, record), map.transform, map.default_value);
  }
  return applyTransform(record[map.sql_field], map.transform, map.default_value);
}

function buildPayload(record, fields) {
  const payload = {};
  for (const map of fields) setNestedValue(payload, map.api_field, resolveFieldValue(map, record));
  return payload;
}

module.exports = { setNestedValue, resolveFieldValue, buildPayload };
