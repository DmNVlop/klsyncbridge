'use strict';

const { applyTransform } = require('./transforms');
const { evaluateExpression, matchesFilter } = require('./expressions');
const { setNestedValue, resolveFieldValue, buildPayload } = require('./mapping');

/**
 * Filtro ⇒ mapeo sobre todas las filas. Lo usan los jobs (salidas de conjunto completo) y, en 3b, el paso map_export.
 * @returns {{ items: Array<{ payload: object, record: object }>, filteredOut: number }}
 */
function runPipeline({ records, filterExpression = null, fields, logMeta = {} }) {
  const items = [];
  let filteredOut = 0;
  for (const record of records) {
    if (!matchesFilter(record, filterExpression, logMeta)) { filteredOut++; continue; }
    items.push({ payload: buildPayload(record, fields), record });
  }
  return { items, filteredOut };
}

module.exports = {
  applyTransform, evaluateExpression, matchesFilter, setNestedValue, resolveFieldValue, buildPayload, runPipeline,
};
