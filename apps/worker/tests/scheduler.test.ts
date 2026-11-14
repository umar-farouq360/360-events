import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import pino from 'pino';
import { databaseUrl } from '@360events/api/database-url';
import { outboxEvents } from '@360events/api/schema';
import { RecurringScheduler } from '../src/lib/scheduler.js';

const logger = pino({ level: 'silent' });
const testSchema = `worker_sched_test_${randomUUID().replaceAll('-', '')}`;
const sql = postgres(databaseUrl, { max: 1 });
const db = drizzle(sql, { schema: { outboxEvents } });

beforeAll(async () => {
  await sql.unsafe(`CREATE SCHEMA ${testSchema}`);
  await sql.unsafe(`SET search_path TO ${testSchema}, public`);
  // Replay the real outbox migration; keep in sync with schema.
  const migrationFile = new URL('../../api/src/db/migrations/0002_fresh_leo.sql', import.meta.url);
  const { readFile } = await import('node:fs/promises');
  const migrationSql = await readFile(migrationFile, 'utf8');
  await sql.unsafe(migrationSql.replaceAll('"public".', `"${testSchema}".`));
});
afterAll(async () => {
  await sql.unsafe(`DROP SCHEMA ${testSchema} CASCADE`);
  await sql.end();
});
beforeEach(async () => {
  await db.delete(outboxEvents);
});

describe('RecurringScheduler single-flight', () => {
  it('N schedulers racing on the same bucket enqueue exactly one job', async () => {
    const schedulers = Array.from({ length: 5 }, () => new RecurringScheduler({ database: db, logger }));
    for (const s of schedulers) s.register({ name: 'cleanup', everyMs: 60_000, jobType: 'cleanup-idempotency-keys' });
    const now = new Date('2026-11-13T21:00:00Z');
    const results = await Promise.all(schedulers.map((s) => s.tickOnce(now)));
    expect(results.reduce((a, b) => a + b, 0)).toBe(1);
    const rows = await db.select().from(outboxEvents).where(eq(outboxEvents.type, 'cleanup-idempotency-keys'));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.dedupeKey).toBe('recurring:cleanup:29694440'); // floor(now/60000)
  });

  it('enqueues again only when the bucket advances', async () => {
    const s = new RecurringScheduler({ database: db, logger });
    s.register({ name: 'cleanup', everyMs: 60_000, jobType: 'cleanup-idempotency-keys' });
    const t0 = new Date('2026-11-13T21:00:00Z');
    expect(await s.tickOnce(t0)).toBe(1);
    expect(await s.tickOnce(new Date(t0.getTime() + 30_000))).toBe(0); // same bucket
    expect(await s.tickOnce(new Date(t0.getTime() + 60_000))).toBe(1); // next bucket
  });

  it('getStatus reports definitions and last bucket', async () => {
    const s = new RecurringScheduler({ database: db, logger });
    s.register({ name: 'cleanup', everyMs: 60_000, jobType: 'cleanup-idempotency-keys' });
    await s.tickOnce(new Date('2026-11-13T21:00:00Z'));
    const status = s.getStatus();
    expect(status.definitions[0]?.name).toBe('cleanup');
    expect(status.definitions[0]?.lastEnqueuedBucket).not.toBeNull();
  });
});