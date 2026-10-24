'use strict';

const { z } = require('zod');
const { AUTOMATION_ITEM_STATUSES } = require('../../config/constants');

const pluginRefSchema = z.object({
  type: z.string().min(1, 'Elige un tipo'),
  config: z.record(z.any()).default({}),
});

const automationBodySchema = z.object({
  name: z.string().trim().min(1, 'El nombre es obligatorio').max(150),
  description: z.string().trim().max(1000).nullable().optional(),
  is_active: z.boolean().default(true),
  trigger: pluginRefSchema,
  steps: z.array(pluginRefSchema).min(1, 'Añade al menos un paso'),
});

const testFolderSchema = z.object({
  path: z.string().trim().min(1, 'Indica la carpeta'),
  pattern: z.string().trim().min(1).default('*.xml'),
});

const workItemsFilterSchema = z.object({
  status: z.enum(Object.values(AUTOMATION_ITEM_STATUSES)).optional(),
  search: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(25),
});

module.exports = { automationBodySchema, testFolderSchema, workItemsFilterSchema };
