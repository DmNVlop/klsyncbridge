'use strict';

const sqlServerService = require('../sqlserver.service');
const { AppError } = require('../../utils/errors');

async function test(config) {
  return sqlServerService.testConnection(config);
}

async function getTables(config) {
  return sqlServerService.getTables(config);
}

async function getFields(config, tableName) {
  return sqlServerService.getFields(config, tableName);
}

async function getRecords(config, jobContext) {
  const { table_or_view, sync_mode, date_field, syncState } = jobContext;
  const table = `[${table_or_view}]`;

  let query;
  let params = {};

  if (sync_mode === 'full' || !date_field || !syncState?.last_sync_at) {
    query = `SELECT * FROM ${table}`;
  } else {
    query = `SELECT * FROM ${table} WHERE [${date_field}] > @lastSync ORDER BY [${date_field}] ASC`;
    params = { lastSync: { type: require('mssql').DateTime, value: new Date(syncState.last_sync_at) } };
  }

  return sqlServerService.executeQuery(config, query, params);
}

module.exports = { test, getTables, getFields, getRecords };
