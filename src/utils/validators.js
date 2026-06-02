'use strict';

const { z } = require('zod');
const { AUTH_TYPES, SYNC_MODES, SCHEDULE_TYPES, HTTP_METHODS, TRANSFORMS, OP_MODES, ITEM_TYPES } = require('../config/constants');

const uuidSchema = z.string().uuid();

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(25),
});

const loginSchema = z.object({
  username: z.string().min(1).max(100).trim(),
  password: z.string().min(1),
});

const createUserSchema = z.object({
  username: z.string().min(3, 'Mínimo 3 caracteres').max(100).trim().regex(/^[a-zA-Z0-9_.-]+$/, 'Solo letras, números, guiones y puntos'),
  password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres').max(200),
});

const updateUserSchema = z.object({
  username: z.string().min(3).max(100).trim().optional(),
  password: z.string().min(8).max(200).optional(),
  is_active: z.boolean().optional(),
});

const createConnectionSchema = z.object({
  name: z.string().min(1).max(200).trim(),
  host: z.string().min(1).max(500).trim(),
  port: z.coerce.number().int().min(1).max(65535).default(1433),
  database_name: z.string().min(1).max(200).trim(),
  username: z.string().min(1).max(200).trim(),
  password: z.string().min(1),
  encrypt: z.boolean().default(true),
  trust_cert: z.boolean().default(false),
});

const updateConnectionSchema = createConnectionSchema.partial().extend({
  password: z.string().min(1).optional(),
});

const createApiConfigSchema = z.object({
  name: z.string().min(1).max(200).trim(),
  base_url: z.string().url(),
  endpoint_path: z.string().min(1).max(500),
  method: z.enum(HTTP_METHODS),
  headers_json: z.string().optional().nullable(),
  body_template: z.string().optional().nullable(),
  auth_type: z.enum(Object.values(AUTH_TYPES)),
  auth_config: z.record(z.unknown()).optional().nullable(),
});

const updateApiConfigSchema = createApiConfigSchema.partial();

const fieldMapEntrySchema = z.object({
  sql_field: z.string().min(1).max(200),
  api_field: z.string().min(1).max(500),
  transform: z.enum(Object.values(TRANSFORMS)).default('none'),
  default_value: z.string().nullable().optional(),
  sort_order: z.number().int().default(0),
});

const jobBaseSchema = z.object({
  name: z.string().min(1).max(200).trim(),
  description: z.string().max(1000).optional().nullable(),
  connection_id: uuidSchema,
  table_or_view: z.string().min(1).max(500),
  key_field: z.string().min(1).max(200),
  sync_mode: z.enum(Object.values(SYNC_MODES)).default('incremental'),
  date_field: z.string().max(200).optional().nullable(),
  api_config_id: uuidSchema,
  schedule_type: z.enum(Object.values(SCHEDULE_TYPES)),
  schedule_value: z.string().min(1).max(200),
  is_active: z.boolean().default(false),
  item_type: z.enum(Object.values(ITEM_TYPES)),
  op_mode: z.enum(Object.values(OP_MODES)).default('snapshot'),
  op_passthrough_field: z.string().max(200).optional().nullable(),
  send_empty_sync: z.boolean().default(false),
});

function passthroughRefine(data) {
  if (data.op_mode === OP_MODES.PASSTHROUGH && !data.op_passthrough_field) return false;
  return true;
}
const passthroughMsg = { message: 'op_passthrough_field es requerido cuando op_mode es "passthrough"', path: ['op_passthrough_field'] };

const createJobSchema = jobBaseSchema.refine(passthroughRefine, passthroughMsg);
const updateJobSchema = jobBaseSchema.partial().refine(passthroughRefine, passthroughMsg);

const logsFilterSchema = z.object({
  job_id: uuidSchema.optional(),
  status: z.enum(['running', 'success', 'error', 'partial']).optional(),
  date_from: z.string().datetime().optional(),
  date_to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(25),
});

function validate(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) {
    const { ValidationError } = require('./errors');
    throw new ValidationError(
      'Datos de entrada inválidos',
      result.error.flatten().fieldErrors
    );
  }
  return result.data;
}

module.exports = {
  validate,
  loginSchema,
  createUserSchema,
  updateUserSchema,
  createConnectionSchema,
  updateConnectionSchema,
  createApiConfigSchema,
  updateApiConfigSchema,
  fieldMapEntrySchema,
  createJobSchema,
  updateJobSchema,
  logsFilterSchema,
  paginationSchema,
  uuidSchema,
};
