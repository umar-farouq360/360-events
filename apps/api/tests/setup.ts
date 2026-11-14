import { beforeAll } from 'vitest';
import { databaseUrl } from '../src/config/database-url.js';
import postgres from 'postgres';
import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(here, '../.env') });

beforeAll(async () => {
  const sql = postgres(databaseUrl, { max: 1, connect_timeout: 3 });
  try {
    await sql`select 1`;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      `\n\n[TEST PREFLIGHT] Cannot reach Postgres at ${databaseUrl.replace(/:[^:@/]+@/, ':***@')}\n` +
      `  ${msg}\n` +
      `  Start it with:  docker compose up -d postgres\n` +
      `  Then wait:      docker compose ps   (until STATUS = healthy)\n`
    );
  } finally {
    await sql.end({ timeout: 1 });
  }
}, 10_000);


export async function setup() {
  const sql = postgres(databaseUrl, { max: 1, connect_timeout: 3 });
  try {
    await sql`SELECT 1`;
  } catch {
    throw new Error(
      `[test setup] Cannot connect to Postgres at ${databaseUrl}.\n` +
      `Run 'docker compose up -d' from the project root first.`
    );
  } finally {
    await sql.end();
  }
}

