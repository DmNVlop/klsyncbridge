'use strict';

const crypto = require('crypto');
const { z } = require('zod');
const { getDb } = require('../../config/database');
const { NotFoundError, ConflictError, ValidationError } = require('../../utils/errors');
const { writeAudit } = require('../../services/audit.service');
const {
  TARGET_KINDS, STATIC_SQL_FIELD, EXPRESSION_SQL_FIELD, validateTemplate, toMappingJson,
} = require('./mapping-json.schema');

const RESOURCE_TYPE = 'mapping_template';
const ORIGIN_TYPES = ['job', 'template', 'import', 'manual'];

function now() { return new Date().toISOString(); }
function actorIdOf(actor) { return (actor && actor.id) || null; }

function parseJson(raw, fallback) {
  if (raw === null || raw === undefined || raw === '') return fallback;
  try { return JSON.parse(raw); } catch (err) { return fallback; }
}

// Forma estructural de la entrada (las reglas de contenido las aplica validateTemplate)
const fieldInputSchema = z.object({
  api_field: z.string(),
  source_type: z.enum(['field', 'static', 'expression']).optional(),
  sql_field: z.string().nullable().optional(),
  transform: z.string().nullable().optional(),
  default_value: z.union([z.string(), z.number()]).nullable().optional(),
  expression: z.string().nullable().optional(),
  expression_meta: z.record(z.any()).nullable().optional(),
});

const templateInputSchema = z.object({
  name: z.string().trim().min(1, 'El nombre es obligatorio').max(200),
  description: z.string().max(500).nullable().optional(),
  target_kind: z.enum(TARGET_KINDS),
  filter_expression: z.string().nullable().optional(),
  reader: z.object({ format: z.string().optional(), options: z.record(z.any()).optional() }).nullable().optional(),
  sample_fields: z.array(z.string().max(200)).max(1000).nullable().optional(),
  origin: z.object({
    type: z.enum(ORIGIN_TYPES), id: z.string().nullable().optional(), name: z.string().nullable().optional(),
  }).nullable().optional(),
  fields: z.array(fieldInputSchema),
});

/** Deja cada campo en la forma canónica de `field_maps` (sin ids) y numera el orden. */
function normalizeFields(fields) {
  return fields.map((map, index) => {
    const sourceType = map.source_type || 'field';
    const base = {
      api_field: map.api_field,
      source_type: sourceType,
      sql_field: map.sql_field || null,
      transform: map.transform || 'none',
      default_value: map.default_value === null || map.default_value === undefined ? null : String(map.default_value),
      expression: null,
      expression_meta: null,
      sort_order: index,
    };
    if (sourceType === 'static') return { ...base, sql_field: STATIC_SQL_FIELD, transform: 'none' };
    if (sourceType === 'expression') {
      return {
        ...base, sql_field: map.sql_field || EXPRESSION_SQL_FIELD, expression: map.expression || null,
        expression_meta: map.expression_meta || null,
      };
    }
    return base;
  });
}

/** Valida estructura y reglas de contenido; devuelve la plantilla normalizada o lanza 400 con `details.issues`. */
function parseTemplateInput(body) {
  const parsed = templateInputSchema.safeParse(body);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.') || 'cuerpo'}: ${i.message}`);
    throw new ValidationError('Plantilla de mapeo no válida', { issues });
  }
  const data = parsed.data;
  const template = {
    name: data.name,
    description: data.description || null,
    target_kind: data.target_kind,
    filter_expression: data.filter_expression || null,
    reader: data.reader ? { format: data.reader.format || 'auto', options: data.reader.options || {} } : null,
    sample_fields: data.sample_fields || null,
    origin: data.origin || { type: 'manual' },
    fields: normalizeFields(data.fields),
  };
  const check = validateTemplate(template);
  if (!check.valid) throw new ValidationError('Plantilla de mapeo no válida', { issues: check.issues });
  return template;
}

function hydrate(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    target_kind: row.target_kind,
    fields: parseJson(row.fields, []),
    filter_expression: row.filter_expression,
    reader: parseJson(row.reader, null),
    sample_fields: parseJson(row.sample_fields, null),
    origin: parseJson(row.origin, null),
    created_at: row.created_at,
    created_by: row.created_by,
    updated_at: row.updated_at,
    updated_by: row.updated_by,
  };
}

function listTemplates() {
  return getDb().prepare('SELECT * FROM mapping_templates ORDER BY name COLLATE NOCASE ASC').all().map((row) => {
    const fields = parseJson(row.fields, []);
    return {
      id: row.id, name: row.name, description: row.description, target_kind: row.target_kind,
      fieldCount: fields.length, updated_at: row.updated_at,
    };
  });
}

function getTemplate(id) {
  const row = getDb().prepare('SELECT * FROM mapping_templates WHERE id = ?').get(id);
  if (!row) throw new NotFoundError('Plantilla de mapeo');
  return hydrate(row);
}

function assertNameFree(name, exceptId = null) {
  const row = getDb().prepare('SELECT id FROM mapping_templates WHERE name = ? COLLATE NOCASE').get(name);
  if (row && row.id !== exceptId) throw new ConflictError('Ya existe una plantilla de mapeo con ese nombre');
}

function insertTemplate(template, actor) {
  const id = crypto.randomUUID();
  const ts = now();
  const actorId = actorIdOf(actor);
  const origin = template.origin ? JSON.stringify({ ...template.origin, at: ts }) : null;
  getDb().prepare(`
    INSERT INTO mapping_templates (id, name, description, target_kind, fields, filter_expression, reader, sample_fields,
      origin, created_at, created_by, updated_at, updated_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, template.name, template.description, template.target_kind, JSON.stringify(template.fields),
    template.filter_expression, template.reader ? JSON.stringify(template.reader) : null,
    template.sample_fields ? JSON.stringify(template.sample_fields) : null, origin, ts, actorId, ts, actorId);
  return id;
}

function createTemplate(body, actor) {
  const template = parseTemplateInput(body);
  assertNameFree(template.name);
  const id = insertTemplate(template, actor);
  const isImport = template.origin && template.origin.type === 'import';
  writeAudit({
    actor, action: isImport ? 'import' : 'create', resourceType: RESOURCE_TYPE, resourceId: id,
    summary: `${isImport ? 'importó' : 'creó'} la plantilla de mapeo «${template.name}» (${template.fields.length} campos)`,
  });
  return getTemplate(id);
}

function updateTemplate(id, body, actor) {
  const current = getTemplate(id);
  const template = parseTemplateInput(body);
  assertNameFree(template.name, id);
  const origin = template.origin && body.origin ? { ...template.origin, at: now() } : current.origin;
  getDb().prepare(`
    UPDATE mapping_templates SET name = ?, description = ?, target_kind = ?, fields = ?, filter_expression = ?, reader = ?,
      sample_fields = ?, origin = ?, updated_at = ?, updated_by = ?
    WHERE id = ?
  `).run(template.name, template.description, template.target_kind, JSON.stringify(template.fields),
    template.filter_expression, template.reader ? JSON.stringify(template.reader) : null,
    template.sample_fields ? JSON.stringify(template.sample_fields) : (current.sample_fields ? JSON.stringify(current.sample_fields) : null),
    origin ? JSON.stringify(origin) : null, now(), actorIdOf(actor), id);
  writeAudit({
    actor, action: 'update', resourceType: RESOURCE_TYPE, resourceId: id,
    summary: `modificó la plantilla de mapeo «${template.name}» (${template.fields.length} campos)`,
  });
  return getTemplate(id);
}

/** Nombre libre para una copia: «X (copia)», «X (copia 2)», … */
function freeCopyName(baseName) {
  let candidate = `${baseName} (copia)`;
  let n = 2;
  while (getDb().prepare('SELECT 1 FROM mapping_templates WHERE name = ? COLLATE NOCASE').get(candidate)) {
    candidate = `${baseName} (copia ${n})`;
    n += 1;
  }
  return candidate;
}

function duplicateTemplate(id, actor) {
  const source = getTemplate(id);
  const copyId = insertTemplate({
    ...source,
    name: freeCopyName(source.name),
    origin: { type: 'template', id: source.id, name: source.name },
  }, actor);
  const copy = getTemplate(copyId);
  writeAudit({
    actor, action: 'duplicate', resourceType: RESOURCE_TYPE, resourceId: copyId,
    summary: `duplicó la plantilla «${source.name}» como «${copy.name}»`,
  });
  return copy;
}

/**
 * Usos de la plantilla. Los jobs (copia, solo informativo) vienen de `jobs.mapping_origin`; las automatizaciones, del JSON
 * de configuración de sus pasos (única fuente de verdad de los usos de pasos).
 */
function findUsages(id) {
  const db = getDb();
  return {
    jobs: db.prepare("SELECT id, name FROM jobs WHERE json_extract(mapping_origin, '$.templateId') = ?").all(id),
    automations: db.prepare(`
      SELECT DISTINCT a.id, a.name FROM automations a
      JOIN automation_steps s ON s.automation_id = a.id
      WHERE s.config LIKE ?
      ORDER BY a.name
    `).all(`%"${id}"%`),
  };
}

function deleteTemplate(id, actor) {
  const current = getTemplate(id);
  const usages = findUsages(id);
  // Los jobs llevan una copia: no bloquean el borrado; los pasos de automatización sí (referencia viva)
  if (usages.automations.length > 0) {
    const err = new ConflictError('La plantilla está en uso por automatizaciones y no se puede borrar');
    err.details = { usages };
    throw err;
  }
  getDb().prepare('DELETE FROM mapping_templates WHERE id = ?').run(id);
  writeAudit({ actor, action: 'delete', resourceType: RESOURCE_TYPE, resourceId: id, summary: `borró la plantilla de mapeo «${current.name}»` });
}

/** JSON v1 listo para descargar y el nombre de fichero sugerido. */
function exportTemplate(id) {
  const template = getTemplate(id);
  const safeName = template.name.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'plantilla';
  return { json: toMappingJson(template), fileName: `${safeName}.mapping.json` };
}

module.exports = {
  listTemplates, getTemplate, createTemplate, updateTemplate, duplicateTemplate, deleteTemplate,
  findUsages, exportTemplate, parseTemplateInput, normalizeFields,
};
