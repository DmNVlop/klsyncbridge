'use strict';

const logger = require('../../services/logger.service');

function compile(body, record) {
  const varNames = Object.keys(record);
  // eslint-disable-next-line no-new-func
  const fn = new Function(...varNames, `"use strict"; ${body}`);
  return fn(...varNames.map(k => record[k]));
}

/** Evalúa una expresión con las columnas de la fila como variables. Error ⇒ null (y aviso en el log). */
function evaluateExpression(expression, record) {
  try {
    return compile(`return (${expression});`, record);
  } catch (err) {
    logger.warn('Error evaluando expresión de campo', { expression, error: err.message });
    return null;
  }
}

/** Filtro de filas. Sin expresión ⇒ pasa. Error al evaluar ⇒ pasa (comportamiento histórico de los jobs). */
function matchesFilter(record, filterExpression, logMeta = {}) {
  if (!filterExpression) return true;
  try {
    return compile(`return !!(${filterExpression});`, record);
  } catch (err) {
    logger.warn('Error evaluando row_filter_expression', { ...logMeta, expression: filterExpression, error: err.message });
    return true;
  }
}

module.exports = { evaluateExpression, matchesFilter };
