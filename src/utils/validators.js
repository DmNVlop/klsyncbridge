'use strict';

const { z } = require('zod');
const {
  AUTH_TYPES, SYNC_MODES, SCHEDULE_TYPES, HTTP_METHODS, TRANSFORMS, OP_MODES, ITEM_TYPES,
  DESTINATION_MODES, FILE_RETENTION,
} = require('../config/constants');
const { isUncPath } = require('../core/files/paths');

const uuidSchema = z.string().uuid();

const UNC_ONLY_MESSAGE = 'las credenciales de red solo aplican a rutas \\\\servidor\\recurso';

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(25),
});

const loginSchema = z.object({
  username: z.string().min(1).max(100).trim(),
  password: z.string().min(1),
});

const firstRunSchema = z.object({
  password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres').max(200),
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

const sqlserverConfigSchema = z.object({
  host: z.string().min(1).max(500).trim(),
  port: z.coerce.number().int().min(1).max(65535).default(1433),
  database_name: z.string().min(1).max(200).trim(),
  username: z.string().min(1).max(200).trim(),
  password: z.string().min(1),
  encrypt: z.boolean().default(true),
  trust_cert: z.boolean().default(false),
});

const csvConfigSchema = z.object({
  file_path: z.string().min(1).max(1000),
  delimiter: z.string().min(1).max(5).default(','),
  encoding: z.string().default('utf8'),
  has_header: z.boolean().default(true),
});

const excelConfigSchema = z.object({
  file_path: z.string().min(1).max(1000),
  sheet_name: z.string().max(200).optional().nullable(),
  header_row: z.coerce.number().int().min(1).default(1),
});

const configSchemas = {
  sqlserver: sqlserverConfigSchema,
  csv: csvConfigSchema,
  excel: excelConfigSchema,
};

const createConnectionSchema = z.object({
  name: z.string().min(1).max(200).trim(),
  source_type: z.enum(['sqlserver', 'csv', 'excel']).default('sqlserver'),
  config: z.record(z.unknown()).default({}),
}).superRefine((val, ctx) => {
  const schema = configSchemas[val.source_type];
  if (!schema) return;
  const result = schema.safeParse(val.config);
  if (!result.success) {
    result.error.issues.forEach(issue => {
      ctx.addIssue({ ...issue, path: ['config', ...issue.path] });
    });
  } else {
    val.config = result.data;
  }
});

const updateConnectionSchema = z.object({
  name: z.string().min(1).max(200).trim().optional(),
  source_type: z.enum(['sqlserver', 'csv', 'excel']).optional(),
  config: z.record(z.unknown()).optional(),
}).superRefine((val, ctx) => {
  if (!val.source_type || !val.config) return;
  const schema = configSchemas[val.source_type]?.partial();
  if (!schema) return;
  const result = schema.safeParse(val.config);
  if (!result.success) {
    result.error.issues.forEach(issue => {
      ctx.addIssue({ ...issue, path: ['config', ...issue.path] });
    });
  } else {
    val.config = result.data;
  }
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
  payload_schema: z.record(z.unknown()).optional().nullable(),
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
  api_config_id: uuidSchema.optional().nullable(),
  schedule_type: z.enum(Object.values(SCHEDULE_TYPES)),
  schedule_value: z.string().min(1).max(200),
  is_active: z.boolean().default(false),
  item_type: z.enum(Object.values(ITEM_TYPES)),
  op_mode: z.enum(Object.values(OP_MODES)).default('snapshot'),
  op_passthrough_field: z.string().max(200).optional().nullable(),
  send_empty_sync: z.boolean().default(false),
  batch_size: z.number().int().min(1).max(5000).default(500),
  batch_concurrency: z.number().int().min(1).max(10).default(2),
  row_filter_enabled: z.boolean().default(false),
  row_filter_expression: z.string().max(2000).optional().nullable(),
  destination_mode: z.enum(Object.values(DESTINATION_MODES)).default('endpoint'),
  file_formats: z.string().max(20).optional().nullable(),
  output_dir: z.string().max(500).optional().nullable(),
  csv_delimiter: z.string().min(1).max(5).default(';'),
  file_retention: z.enum(Object.values(FILE_RETENTION)).default('keep_all'),
  example_schema_api_id: uuidSchema.optional().nullable(),
  output_credential_id: uuidSchema.optional().nullable(),
});

function passthroughRefine(data) {
  if (data.op_mode === OP_MODES.PASSTHROUGH && !data.op_passthrough_field) return false;
  return true;
}
const passthroughMsg = { message: 'op_passthrough_field es requerido cuando op_mode es "passthrough"', path: ['op_passthrough_field'] };

function destinationSuperRefine(data, ctx) {
  // Credencial de red: solo con carpeta de salida UNC (si el output_dir no viene, lo comprueba el servicio con el estado guardado)
  if (data.output_credential_id && data.output_dir && !isUncPath(data.output_dir)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: UNC_ONLY_MESSAGE, path: ['output_credential_id'] });
  }
  // En updates parciales que no tocan el destino, destination_mode llega undefined — no validar nada acá
  if (data.destination_mode === undefined) return;
  const mode = data.destination_mode;
  if (mode !== DESTINATION_MODES.FILE && !data.api_config_id) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'api_config_id es requerido cuando destination_mode es "endpoint" o "both"', path: ['api_config_id'] });
  }
  if (mode !== DESTINATION_MODES.ENDPOINT) {
    if (!data.output_dir) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'output_dir es requerido cuando destination_mode incluye archivo', path: ['output_dir'] });
    }
    const formats = String(data.file_formats || '').split(',').map(f => f.trim()).filter(Boolean);
    if (formats.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'file_formats es requerido (csv, json, o ambos) cuando destination_mode incluye archivo', path: ['file_formats'] });
    }
  }
}

const createJobSchema = jobBaseSchema.refine(passthroughRefine, passthroughMsg).superRefine(destinationSuperRefine);
const updateJobSchema = jobBaseSchema.partial().refine(passthroughRefine, passthroughMsg).superRefine(destinationSuperRefine);

const logsFilterSchema = z.object({
  job_id: uuidSchema.optional(),
  status: z.enum(['running', 'success', 'error', 'partial']).optional(),
  date_from: z.string().datetime().optional(),
  date_to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(25),
});

// --- Credenciales de red (UNC) ---

// Dominio vacío o solo espacios ⇒ null
const optionalDomainSchema = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
  z.string().trim().max(100).nullable().optional(),
);

const createNetworkCredentialSchema = z.object({
  name: z.string().trim().min(1).max(100),
  domain: optionalDomainSchema,
  username: z.string().trim().min(1).max(100),
  password: z.string().min(1).max(256),
  notes: z.string().max(500).optional().nullable(),
});

// En la edición, una contraseña vacía o ausente conserva la guardada
const updateNetworkCredentialSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  domain: optionalDomainSchema,
  username: z.string().trim().min(1).max(100).optional(),
  password: z.preprocess(
    (value) => (value === '' || value === null ? undefined : value),
    z.string().min(1).max(256).optional(),
  ),
  notes: z.string().max(500).optional().nullable(),
});

const testNetworkCredentialSchema = z.object({
  path: z.string().min(1).max(500).refine((value) => isUncPath(value), { message: UNC_ONLY_MESSAGE }),
  credentialId: uuidSchema.optional(),
  domain: optionalDomainSchema,
  username: z.string().trim().min(1).max(100).optional(),
  password: z.string().max(256).optional(),
  checkWrite: z.boolean().optional(),
}).refine((value) => Boolean(value.credentialId || value.username), {
  message: 'indica una credencial guardada o un usuario',
  path: ['credentialId'],
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
  firstRunSchema,
  createUserSchema,
  updateUserSchema,
  createConnectionSchema,
  updateConnectionSchema,
  sqlserverConfigSchema,
  csvConfigSchema,
  excelConfigSchema,
  createApiConfigSchema,
  updateApiConfigSchema,
  createNetworkCredentialSchema,
  updateNetworkCredentialSchema,
  testNetworkCredentialSchema,
  fieldMapEntrySchema,
  createJobSchema,
  updateJobSchema,
  logsFilterSchema,
  paginationSchema,
  uuidSchema,
};
