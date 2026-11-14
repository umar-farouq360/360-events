import 'dotenv/config';
import { beforeAll } from 'vitest';
import postgres from 'postgres';
import { databaseUrl } from '../src/config/database-url.js';

beforeAll(async () => {
  const sql = postgres(databaseUrl, { max: 1, connect_timeout: 3 });
  try {
    await sql`SELECT 1`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const safeUrl = databaseUrl.replace(/:[^:@/]+@/, ':***@');
    throw new Error(
      '\n\n[TEST PREFLIGHT] Cannot reach the isolated PostgreSQL test database at ' +
      safeUrl +
      '\n  ' +
      message +
      '\n  Start it with: docker compose up -d postgres\n' +
      '  Check status:   docker compose ps\n',
    );
  } finally {
    await sql.end({ timeout: 1 });
  }
}, 10_000);
