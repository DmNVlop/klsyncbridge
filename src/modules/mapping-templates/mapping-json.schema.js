'use strict';

const { z } = require('zod');
const { TRANSFORMS } = require('../../config/constants');
const { checkExpressionSyntax } = require('../../core/data-pipeline/expressions');
const { STD_KEY_PATTERN, REQUIRED_KEYS } = require('../../core/outputs/ardis-std/std-keys');

const KIND = 'klsyncbridge.mapping';
const SCHEMA_VERSION = 1;
const TARGET_KINDS = ['api', 'ardis_std'];
const SOURCES = ['field', 'static', 'expression'];
const READER_FORMATS = ['auto', 'csv', 'excel'];
const ENCODINGS = ['utf8', 'latin1'];
const MAX_FIELDS = 500;
const MAX_TEXT = 500;

// Marcadores internos de field_maps para los orígenes sin columna (los usa el editor de mapeo)
const STATIC_SQL_FIELD = '__static__';
const EXPRESSION_SQL_FIELD = '__expr__';

const transformValues = Object.values(TRANSFORMS);
const text = (max = MAX_TEXT) => z.string().max(max, { message: `no puede superar ${max} caracteres` });

const fieldSchema = z.object({
  target: text().min(1, { message: 'es obligatorio' }),
  source: z.string(),
  sourceField: text().optional().nullable(),
  value: text().optional().nullable(),
  expression: text().optional().nullable(),
  transform: z.string().optional().nullable(),
  default: z.union([z.string().max(MAX_TEXT), z.number()]).optional().nullable(),
});

const readerSchema = z.object({
  format: z.string().optional(),
  options: z.object({
    delimiter: text(5).optional(),
    encoding: z.string().optional(),
    has_header: z.boolean().optional(),
    sheet_name: text(100).optional(),
    header_row: z.number().int().min(1).max(1000).optional(),
  }).optional(),
});

const mappingJsonSchema = z.object({
  kind: z.string(),
  schemaVersion: z.number(),
  name: text(200).optional().nullable(),
  description: text().optional().nullable(),
  targetKind: z.string(),
  filterExpression: text().optional().nullable(),
  reader: readerSchema.optional().nullable(),
  fields: z.array(fieldSchema),
}).superRefine((doc, ctx) => {
  const add = (path, message) => ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });

  // Reglas de contenido aquí (y no en el esquema base) para devolver todos los errores a la vez
  if (!doc.name || doc.name.trim() === '') add(['name'], 'es obligatorio');
  if (doc.fields.length === 0) add(['fields'], 'debe tener al menos un campo');
  if (doc.fields.length > MAX_FIELDS) add(['fields'], `no puede tener más de ${MAX_FIELDS} campos`);
  if (doc.kind !== KIND) add(['kind'], `debe ser "${KIND}"`);
  if (doc.schemaVersion !== SCHEMA_VERSION) add(['schemaVersion'], `debe ser ${SCHEMA_VERSION}`);
  if (!TARGET_KINDS.includes(doc.targetKind)) {
    add(['targetKind'], `"${doc.targetKind}" no es válido; admitidos: ${TARGET_KINDS.join(', ')}`);
  }
  if (doc.filterExpression) {
    const error = checkExpressionSyntax(doc.filterExpression, 'filter');
    if (error) add(['filterExpression'], `la expresión no es válida: ${error}`);
  }
  if (doc.reader) {
    if (doc.reader.format !== undefined && !READER_FORMATS.includes(doc.reader.format)) {
      add(['reader', 'format'], `"${doc.reader.format}" no es válido; admitidos: ${READER_FORMATS.join(', ')}`);
    }
    const encoding = doc.reader.options && doc.reader.options.encoding;
    if (encoding !== undefined && !ENCODINGS.includes(encoding)) {
      add(['reader', 'options', 'encoding'], `"${encoding}" no es válido; admitidos: ${ENCODINGS.join(', ')}`);
    }
  }

  const seen = new Set();
  doc.fields.forEach((field, index) => {
    const at = (key) => ['fields', index, key];
    if (!SOURCES.includes(field.source)) {
      add(at('source'), `"${field.source}" no es válido; admitidos: ${SOURCES.join(', ')}`);
    } else if (field.source === 'field' && !field.sourceField) {
      add(at('sourceField'), 'es obligatorio cuando source es "field"');
    } else if (field.source === 'static' && (field.value === undefined || field.value === null)) {
      add(at('value'), 'es obligatorio cuando source es "static"');
    } else if (field.source === 'expression') {
      if (!field.expression) {
        add(at('expression'), 'es obligatorio cuando source es "expression"');
      } else {
        const error = checkExpressionSyntax(field.expression, 'field');
        if (error) add(at('expression'), `la expresión no es válida: ${error}`);
      }
    }
    if (field.transform && !transformValues.includes(field.transform)) {
      add(at('transform'), `"${field.transform}" no es válido; admitidos: ${transformValues.join(', ')}`);
    }
    if (doc.targetKind === 'ardis_std' && field.target && !STD_KEY_PATTERN.test(field.target)) {
      add(at('target'), `"${field.target}" no es una clave válida del almacén .STD (solo letras, números, "_" y "$")`);
    }
    if (field.target) {
      if (seen.has(field.target)) add(at('target'), `"${field.target}" está repetido`);
      seen.add(field.target);
    }
  });

  if (doc.targetKind === 'ardis_std') {
    const missing = REQUIRED_KEYS.filter((key) => !seen.has(key));
    if (missing.length > 0) add(['fields'], `faltan las claves obligatorias de Ardis: ${missing.join(', ')}`);
  }
});

function pathToString(path) {
  return path.reduce((acc, part) => (typeof part === 'number' ? `${acc}[${part}]` : (acc ? `${acc}.${part}` : String(part))), '');
}

/**
 * Convierte los errores de zod en frases legibles, pensadas para pegarlas de vuelta a una IA.
 * @param {import('zod').ZodError} zodError
 * @returns {string[]}
 */
function formatIssues(zodError) {
  return zodError.issues.map((issue) => {
    const where = pathToString(issue.path) || 'JSON';
    if (issue.code === 'invalid_type') {
      if (issue.received === 'undefined') return `${where}: es obligatorio`;
      return `${where}: se esperaba ${issue.expected} y se ha recibido ${issue.received}`;
    }
    return `${where}: ${issue.message}`;
  });
}

/** JSON v1 ⇒ forma interna (snake_case, igual que `field_maps`). Asume un documento ya validado. */
function fromMappingJson(json) {
  return {
    name: json.name.trim(),
    description: json.description || null,
    target_kind: json.targetKind,
    filter_expression: json.filterExpression || null,
    reader: json.reader ? { format: json.reader.format || 'auto', options: json.reader.options || {} } : null,
    fields: json.fields.map((field, index) => {
      const base = {
        api_field: field.target,
        source_type: field.source,
        sql_field: null,
        transform: 'none',
        default_value: null,
        expression: null,
        expression_meta: null,
        sort_order: index,
      };
      if (field.source === 'static') {
        return { ...base, sql_field: STATIC_SQL_FIELD, default_value: String(field.value) };
      }
      const withTransform = {
        ...base,
        transform: field.transform || 'none',
        default_value: field.default === undefined || field.default === null ? null : String(field.default),
      };
      if (field.source === 'expression') return { ...withTransform, sql_field: EXPRESSION_SQL_FIELD, expression: field.expression };
      return { ...withTransform, sql_field: field.sourceField };
    }),
  };
}

/** Forma interna ⇒ JSON v1 (sin `expression_meta`, que es solo del editor visual). */
function toMappingJson(template) {
  const doc = {
    kind: KIND,
    schemaVersion: SCHEMA_VERSION,
    name: template.name,
    targetKind: template.target_kind,
    fields: (template.fields || []).map((map) => {
      const sourceType = map.source_type || 'field';
      const field = { target: map.api_field, source: sourceType };
      if (sourceType === 'static') {
        field.value = map.default_value === null || map.default_value === undefined ? '' : String(map.default_value);
        return field;
      }
      if (sourceType === 'expression') field.expression = map.expression;
      else field.sourceField = map.sql_field;
      if (map.transform && map.transform !== 'none') field.transform = map.transform;
      if (map.default_value !== null && map.default_value !== undefined && map.default_value !== '') field.default = String(map.default_value);
      return field;
    }),
  };
  if (template.description) doc.description = template.description;
  if (template.filter_expression) doc.filterExpression = template.filter_expression;
  if (template.reader) doc.reader = template.reader;
  return doc;
}

/**
 * Valida un JSON v1 sin guardar nada.
 * @returns {{ valid: boolean, issues: string[], template: object|null }} `template` en forma interna si es válido
 */
function validateMappingJson(input) {
  let value = input;
  if (typeof input === 'string') {
    try {
      value = JSON.parse(input);
    } catch (err) {
      return { valid: false, issues: [`JSON no válido: ${err.message}`], template: null };
    }
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { valid: false, issues: ['JSON: se esperaba un objeto'], template: null };
  }
  const result = mappingJsonSchema.safeParse(value);
  if (!result.success) return { valid: false, issues: formatIssues(result.error), template: null };
  return { valid: true, issues: [], template: fromMappingJson(result.data) };
}

/** Aplica a una plantilla en forma interna las mismas reglas que al JSON v1 (única fuente de verdad). */
function validateTemplate(template) {
  const result = validateMappingJson(toMappingJson(template));
  return { valid: result.valid, issues: result.issues };
}

module.exports = {
  KIND, SCHEMA_VERSION, TARGET_KINDS, STATIC_SQL_FIELD, EXPRESSION_SQL_FIELD,
  mappingJsonSchema, formatIssues, fromMappingJson, toMappingJson, validateMappingJson, validateTemplate,
};
