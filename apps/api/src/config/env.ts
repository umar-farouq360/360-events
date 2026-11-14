import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';

const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(here, '../../.env') });
// Optional repo-root fallback (does not override vars already set).
loadEnv({ path: resolve(here, '../../../../.env') });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z
    .string()
    .url()
    .default('postgres://postgres:postgres@localhost:5435/360events_dev'),
  ALLOWED_ORIGINS: z
    .string()
    .default('https://localhost://3000')
    .transform((s) => s.split(',').map((o) => o.trim()).filter(Boolean)),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const missingVars = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
  throw new Error(`Environment validation failed. Invalid or missing variables: ${missingVars}`);
}

export const env = parsed.data;