import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { databaseUrl } from '../src/config/database-url.js';

describe('clean database migrations', () => {
  it('applies every committed migration and creates the expected schema', async () => {
    const sql = postgres(databaseUrl, { max: 1 });
    try {
      const tables = await sql`
        SELECT
          to_regclass('public.audit_events')::text AS audit_events,
          to_regclass('public.outbox_events')::text AS outbox_events,
          to_regclass('public.idempotency_keys')::text AS idempotency_keys,
          to_regclass('public.notifications')::text AS notifications,
          to_regclass('public.notification_attempts')::text AS notification_attempts,
          to_regclass('public.rate_limits')::text AS rate_limits
      `;

      expect(tables[0]).toEqual({
        audit_events: 'audit_events',
        outbox_events: 'outbox_events',
        idempotency_keys: 'idempotency_keys',
        notifications: 'notifications',
        notification_attempts: 'notification_attempts',
        rate_limits: 'rate_limits',
      });

      const journalUrl = new URL('../src/db/migrations/meta/_journal.json', import.meta.url);
      const journal = JSON.parse(await readFile(journalUrl, 'utf8')) as {
        entries: unknown[];
      };
      const migrations = await sql`
        SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations
      `;

      expect(migrations[0]?.count).toBe(journal.entries.length);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });
});
