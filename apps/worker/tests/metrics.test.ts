import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { databaseUrl } from '@360events/api/database-url';
import { outboxEvents } from '@360events/api/schema';
import { getOutboxMetrics, inspectJobs } from '../src/lib/metrics.js';

const testSchema = `worker_metrics_test_${randomUUID().replaceAll('-', '')}`;
const sql = postgres(databaseUrl, { max: 1 });
const db = drizzle(sql, { schema: { outboxEvents } });

beforeAll(async () => {
  await sql.unsafe(`CREATE SCHEMA ${testSchema}`);
  await sql.unsafe(`SET search_path TO ${testSchema}, public`);
  const { readFile } = await import('node:fs/promises');
  const migrationFile = new URL('../../api/src/db/migrations/0002_fresh_leo.sql', import.meta.url);
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

describe('outbox metrics', () => {
  it('counts by status and reports dead-lettered and oldest pending age', async () => {
    const now = new Date('2026-11-13T21:00:00Z');
    await db.insert(outboxEvents).values([
      { id: randomUUID(), type: 'a', payload: {}, status: 'pending', runAt: new Date(now.getTime() - 90_000) },
      { id: randomUUID(), type: 'a', payload: {}, status: 'pending', runAt: now },
      { id: randomUUID(), type: 'a', payload: {}, status: 'processing', attempts: 1, lockedBy: 'w', leaseExpiresAt: new Date(now.getTime() + 60_000) },
      { id: randomUUID(), type: 'a', payload: {}, status: 'completed', completedAt: now },
      { id: randomUUID(), type: 'a', payload: {}, status: 'failed', attempts: 3, maxAttempts: 3 },
    ]);
    const m = await getOutboxMetrics(now);
    expect(m).toMatchObject({ pending: 2, processing: 1, completed: 1, failed: 1, deadLettered: 1 });
    expect(m.oldestPendingAgeSeconds).toBe(90);
  });

  it('inspectJobs filters by status and clamps limit', async () => {
    await db.insert(outboxEvents).values([
      { id: randomUUID(), type: 'a', payload: {}, status: 'failed', attempts: 1, maxAttempts: 1 },
      { id: randomUUID(), type: 'b', payload: {}, status: 'pending' },
    ]);
    const failed = await inspectJobs({ status: 'failed' });
    expect(failed.map((r) => r.type)).toEqual(['a']);
    const clamped = await inspectJobs({ limit: 10_000 });
    expect(clamped.length).toBeLessThanOrEqual(500);
  });
});