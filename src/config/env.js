'use strict';

const { z } = require('zod');
const { resolveEnvFilePath, loadEnvFile } = require('./env-file');

// Cargar .env si existe
loadEnvFile(resolveEnvFilePath());

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  PORT: z.coerce.number().int().min(1024).max(65535).default(3847),
  DATA_DIR: z.string().default('./data'),
  LOG_DIR: z.string().default('./logs'),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  LOG_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Variables de entorno inválidas:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

module.exports = parsed.data;
