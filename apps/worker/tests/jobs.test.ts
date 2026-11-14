import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import pino from 'pino';
import { databaseUrl } from '@360events/api/database-url';
import { enqueue } from '@360events/api/jobs';
import { outboxEvents } from '@360events/api/schema';
import { WorkerRunner, type WorkerRunnerOptions } from '../src/lib/runner.js';

const logger = pino({ level: 'silent' });
const testId = randomUUID();
const testSchema = `worker_jobs_test_${randomUUID().replaceAll('-', '')}`;
const testSql = postgres(databaseUrl, { max: 1 });
const testDb = drizzle(testSql);
const workerSqlClients = Array.from({ length: 4 }, () => postgres(databaseUrl, { max: 1 }));
const workerDatabases = workerSqlClients.map((client) => drizzle(client));
let testSchemaCreated = false;
const trackedIds: string[] = [];
const trackedDedupeKeys: string[] = [];

const createRunner = (options: Partial<WorkerRunnerOptions> = {}): WorkerRunner =>
  new WorkerRunner({
    database: testDb,
    logger,
    ...options,
  });

beforeAll(async () => {
  await testSql.unsafe(`CREATE SCHEMA ${testSchema}`);
  testSchemaCreated = true;
  await testSql.unsafe(`SET search_path TO ${testSchema}, public`);
 const migrationsDir = new URL('../../api/src/db/migrations/', import.meta.url);
const migrationFiles = (await readdir(migrationsDir))
  .filter((f) => f.endsWith('.sql'))
  .sort(); // lexicographic = 0000, 0001, ... 0004
for (const file of migrationFiles) {
  const migrationSql = await readFile(new URL(file, migrationsDir), 'utf8');
  await testSql.unsafe(migrationSql.replaceAll('"public".', `"${testSchema}".`));
}
});

afterAll(async () => {
  await Promise.all(workerSqlClients.map((client) => client.end()));
  if (testSchemaCreated) {
    await testSql.unsafe(`DROP SCHEMA ${testSchema} CASCADE`);
  }
  await testSql.end();
});

const enqueueTracked = async (
  type: string,
  payload: Record<string, unknown>,
  options: { maxAttempts?: number; runAt?: Date } = {},
): Promise<string> => {
  const dedupeKey = `${testId}:${randomUUID()}`;
  trackedDedupeKeys.push(dedupeKey);
  await testDb.transaction((tx) => enqueue(tx, type, payload, { ...options, dedupeKey }));
  return dedupeKey;
};

afterEach(async () => {
  if (trackedIds.length > 0) {
    await testDb.delete(outboxEvents).where(inArray(outboxEvents.id, [...trackedIds]));
    trackedIds.length = 0;
  }
  if (trackedDedupeKeys.length > 0) {
    await testDb.delete(outboxEvents).where(inArray(outboxEvents.dedupeKey, [...trackedDedupeKeys]));
    trackedDedupeKeys.length = 0;
  }
});

describe('Durable Jobs and Outbox (P2-T04)', () => {
  it('deduplicates enqueue requests and rolls back with the business transaction', async () => {
    const dedupeKey = `${testId}:dedupe`;
    trackedDedupeKeys.push(dedupeKey);

    await testDb.transaction(async (tx) => {
      await enqueue(tx, 'email.send', { to: 'test@example.com' }, { dedupeKey });
      await enqueue(tx, 'email.send', { to: 'test@example.com' }, { dedupeKey });
    });

    const rows = await testDb.select().from(outboxEvents).where(eq(outboxEvents.dedupeKey, dedupeKey));
    expect(rows).toHaveLength(1);

    const rollbackKey = `${testId}:rollback`;
    trackedDedupeKeys.push(rollbackKey);
    await expect(testDb.transaction(async (tx) => {
      await enqueue(tx, 'email.send', { to: 'rollback@example.com' }, { dedupeKey: rollbackKey });
      throw new Error('Simulated business transaction failure');
    })).rejects.toThrow('Simulated business transaction failure');

    const rolledBack = await testDb.select().from(outboxEvents).where(eq(outboxEvents.dedupeKey, rollbackKey));
    expect(rolledBack).toHaveLength(0);
  });

  it('claims many jobs across workers without overlapping executions, renewing long leases', async () => {
    const jobIds = Array.from({ length: 4 }, () => randomUUID());
    await Promise.all(jobIds.map((jobId) => enqueueTracked('counter.increment', { jobId })));

    const executions = new Map<string, number>();
    const active = new Map<string, number>();
    const maxActive = new Map<string, number>();
    const payloadSchema = z.object({ jobId: z.string() });
    const runners = workerDatabases.map((database) => {
      const runner = createRunner({ database, leaseDurationMs: 900 });
      runner.register('counter.increment', payloadSchema, async ({ jobId }) => {
        executions.set(jobId, (executions.get(jobId) ?? 0) + 1);
        const activeCount = (active.get(jobId) ?? 0) + 1;
        active.set(jobId, activeCount);
        maxActive.set(jobId, Math.max(maxActive.get(jobId) ?? 0, activeCount));
        // Intentionally longer than leaseDurationMs (900ms) to test lease renewal logic.
                await new Promise((resolve) => setTimeout(resolve, 1200));
        active.set(jobId, (active.get(jobId) ?? 1) - 1);
      });
      return runner;
    });

    await Promise.all(runners.map(async (runner) => {
      while (await runner.pollOnce()) {
        // Continue until this worker finds no currently eligible job.
      }
    }));

    expect([...executions.values()]).toHaveLength(jobIds.length);
    expect([...executions.values()].every((count) => count === 1)).toBe(true);
    expect([...maxActive.values()].every((count) => count === 1)).toBe(true);

    const rows = await testDb.select().from(outboxEvents).where(inArray(outboxEvents.dedupeKey, [...trackedDedupeKeys]));
    expect(rows).toHaveLength(jobIds.length);
    expect(rows.every((row) => row.status === 'completed')).toBe(true);
  });

  it('reclaims expired leases and dead-letters jobs that exhausted attempts before crashing', async () => {
    const reclaimId = `${testId}:reclaim`;
    const exhaustedId = `${testId}:exhausted`;
    trackedIds.push(reclaimId, exhaustedId);
    const expiredAt = new Date(Date.now() - 60_000);

    await testDb.insert(outboxEvents).values([
      {
        id: reclaimId,
        type: 'crash.job',
        payload: {},
        status: 'processing',
        attempts: 1,
        maxAttempts: 3,
        runAt: expiredAt,
        lockedBy: 'crashed-worker',
        leaseExpiresAt: expiredAt,
      },
      {
        id: exhaustedId,
        type: 'crash.job',
        payload: {},
        status: 'processing',
        attempts: 3,
        maxAttempts: 3,
        runAt: expiredAt,
        lockedBy: 'crashed-worker',
        leaseExpiresAt: expiredAt,
      },
    ]);

    let reclaimed = false;
    const runner = createRunner();
    runner.register('crash.job', z.object({}), () => {
      reclaimed = true;
      return Promise.resolve();
    });

    await runner.pollOnce();

    const rows = await testDb.select().from(outboxEvents).where(inArray(outboxEvents.id, [reclaimId, exhaustedId]));
    const reclaimedRow = rows.find((row) => row.id === reclaimId);
    const exhaustedRow = rows.find((row) => row.id === exhaustedId);
    expect(reclaimed).toBe(true);
    expect(reclaimedRow?.status).toBe('completed');
    expect(reclaimedRow?.attempts).toBe(2);
    expect(exhaustedRow?.status).toBe('failed');
  });

  it('does not let a former lease owner overwrite the replacement worker result', async () => {
    const dedupeKey = await enqueueTracked('fenced.job', {});
    let releaseFirstHandler: (() => void) | undefined;
    let signalFirstHandler: (() => void) | undefined;
    const firstHandlerStarted = new Promise<void>((resolve) => {
      signalFirstHandler = resolve;
    });
    const firstHandlerGate = new Promise<void>((resolve) => {
      releaseFirstHandler = resolve;
    });
    const schema = z.object({});
    const formerOwner = createRunner({ leaseDurationMs: 300 });
    formerOwner.register('fenced.job', schema, async () => {
      signalFirstHandler?.();
      await firstHandlerGate;
    });

    const formerAttempt = formerOwner.pollOnce();
    await firstHandlerStarted;
    await testDb.update(outboxEvents)
      .set({ leaseExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(outboxEvents.dedupeKey, dedupeKey));

    let replacementRan = false;
    const replacementOwner = createRunner();
    replacementOwner.register('fenced.job', schema, () => {
      replacementRan = true;
      return Promise.resolve();
    });
    await replacementOwner.pollOnce();

    releaseFirstHandler?.();
    await formerAttempt;

    const [row] = await testDb.select().from(outboxEvents).where(eq(outboxEvents.dedupeKey, dedupeKey));
    expect(replacementRan).toBe(true);
    expect(row?.status).toBe('completed');
    expect(row?.attempts).toBe(2);
  });

  it('applies deterministic backoff and dead-letters after the configured attempts', async () => {
    const now = new Date(Date.now() - 10_000);
    const dedupeKey = await enqueueTracked('fail.always', {}, { maxAttempts: 2, runAt: now });
    let scheduledAttempt = 0;
    const runner = createRunner({
      retryDelayMs: (attempt) => {
        scheduledAttempt = attempt;
        return 3000;
      },
    });
    runner.register('fail.always', z.object({}), () => Promise.reject(new Error('I always fail')));

    await runner.pollOnce();
    const [retryRow] = await testDb.select().from(outboxEvents).where(eq(outboxEvents.dedupeKey, dedupeKey));
    expect(retryRow?.status).toBe('pending');
    expect(retryRow?.attempts).toBe(1);
    expect(retryRow?.lastError).toBe('I always fail');
    expect(scheduledAttempt).toBe(1);
    expect(retryRow?.runAt.getTime()).toBeGreaterThan(retryRow?.createdAt.getTime() ?? 0);

    expect(await runner.pollOnce()).toBe(false);
    await testDb.update(outboxEvents)
      .set({ runAt: new Date(Date.now() - 1000) })
      .where(eq(outboxEvents.dedupeKey, dedupeKey));
    await runner.pollOnce();

    const [failedRow] = await testDb.select().from(outboxEvents).where(eq(outboxEvents.dedupeKey, dedupeKey));
    expect(failedRow?.status).toBe('failed');
    expect(failedRow?.attempts).toBe(2);
  });

  it('waits for an active handler to finish when stopped', async () => {
    const dedupeKey = await enqueueTracked('shutdown.job', {});
    let releaseHandler: (() => void) | undefined;
    let signalStarted: (() => void) | undefined;
    const handlerStarted = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    const handlerGate = new Promise<void>((resolve) => {
      releaseHandler = resolve;
    });
    const runner = createRunner();
    runner.register('shutdown.job', z.object({}), async () => {
      signalStarted?.();
      await handlerGate;
    });

    const loop = runner.start(5);
    await handlerStarted;
    let stopped = false;
    const stop = runner.stop().then(() => {
      stopped = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(stopped).toBe(false);
    releaseHandler?.();
    await stop;
    await loop;

    const [row] = await testDb.select().from(outboxEvents).where(eq(outboxEvents.dedupeKey, dedupeKey));
    expect(row?.status).toBe('completed');
  });
});
