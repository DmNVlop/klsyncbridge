'use strict';

const { AppError } = require('../../utils/errors');

const SOURCE_TYPES = {
  sqlserver: 'sqlserver',
  csv: 'csv',
  excel: 'excel',
};

const registry = {
  [SOURCE_TYPES.sqlserver]: () => require('./sqlserver.source'),
  [SOURCE_TYPES.csv]: () => require('./csv.source'),
  [SOURCE_TYPES.excel]: () => require('./excel.source'),
};

function getSourceService(sourceType) {
  const factory = registry[sourceType];
  if (!factory) {
    throw new AppError(`Tipo de fuente desconocido: "${sourceType}"`, 'UNKNOWN_SOURCE_TYPE', 400);
  }
  return factory();
}

module.exports = { getSourceService, SOURCE_TYPES };
