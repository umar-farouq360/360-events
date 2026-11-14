import 'dotenv/config';
import { config as loadEnv } from 'dotenv';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(here, '../.env'), override: false });

const DEFAULT_TEST_DATABASE_URL =
  'postgres://postgres:postgres@localhost:5435/360events_test';

function getTestDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;
  const parsed = new URL(url);
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));

  if (!databaseName.endsWith('_test')) {
    throw new Error(
      '[TEST DATABASE] Refusing to reset a database whose name does not end in "_test". ' +
      'Set TEST_DATABASE_URL to a dedicated test database, for example ' +
      'postgres://postgres:postgres@localhost:5435/360events_test.',
    );
  }

  return url;
}

async function ensureDatabaseExists(testDatabaseUrl: string): Promise<void> {
  const target = new URL(testDatabaseUrl);
  const databaseName = decodeURIComponent(target.pathname.replace(/^\/+/, ''));
  const maintenance = new URL(testDatabaseUrl);
  maintenance.pathname = '/postgres';

  const admin = postgres(maintenance.toString(), { max: 1, connect_timeout: 5 });
  try {
    const existing = await admin<{ exists: number }[]>\`
      SELECT 1 AS exists FROM pg_database WHERE datname = ${databaseName}
    \`;

    if (existing.length === 0) {
      const quotedName = databaseName.replace(/"/g, '""');
      try {
        await admin.unsafe(\`CREATE DATABASE "${quotedName}"\`);
      } catch (error) {
        if (
          typeof error !== 'object' ||
          error === null ||
          !('code' in error) ||
          error.code !== '42P04'
        ) {
          throw error;
        }
      }
    }
  } finally {
    await admin.end({ timeout: 5 });
  }
}

export default async function setup(): Promise<void> {
  const testDatabaseUrl = getTestDatabaseUrl();
  await ensureDatabaseExists(testDatabaseUrl);

  const sql = postgres(testDatabaseUrl, { max: 1, connect_timeout: 5 });
  try {
    await sql\`DROP SCHEMA IF EXISTS public CASCADE\`;
    await sql\`CREATE SCHEMA public AUTHORIZATION CURRENT_USER\`;

    const db = drizzle(sql);
    await migrate(db, {
      migrationsFolder: resolve(here, '../src/db/migrations'),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(\`[TEST DATABASE] Failed to reset and migrate the test database: ${message}\`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}
