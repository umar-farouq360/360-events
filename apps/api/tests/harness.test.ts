import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Sql } from 'postgres';
import {
  closeConcurrencyConnections,
  openConcurrencyConnections,
} from './harness.js';

describe('PostgreSQL concurrency harness', () => {
  let connections: Sql[];

  beforeAll(async () => {
    connections = openConcurrencyConnections(2);
    await connections[0]!.unsafe(`
      CREATE TABLE concurrency_harness_rows (
        id text PRIMARY KEY,
        value integer NOT NULL
      )
    `);
  });

  afterAll(async () => {
    try {
      await connections[0]?.unsafe('DROP TABLE IF EXISTS concurrency_harness_rows');
    } catch (err) {
      // Optionally log the error or ignore if the connection is already closed
    }
    await closeConcurrencyConnections(connections);
  });

  afterEach(async () => {
    // Clean up all rows after each test to avoid interference
    await connections?.[0]?.unsafe('DELETE FROM concurrency_harness_rows');
  });

  it('uses independent physical PostgreSQL connections', async () => {
    const [first, second] = connections;
    const [firstPid, secondPid] = await Promise.all([
      first<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`,
      second<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`,
    ]);

    expect(firstPid[0]?.pid).toBeTypeOf('number');
    expect(secondPid[0]?.pid).toBeTypeOf('number');
    expect(firstPid[0]?.pid).not.toBe(secondPid[0]?.pid);
  });

  it('skips a row locked by another transaction instead of blocking', async () => {
    const [locker, contender] = connections;
    const rowId = randomUUID();
    await locker`
      INSERT INTO concurrency_harness_rows (id, value)
      VALUES (${rowId}, 1)
    `;

    let signalLockAcquired: () => void = () => {};
    let releaseLock: () => void = () => {};
    const lockAcquired = new Promise<void>((resolve) => {
      signalLockAcquired = resolve;
    });
    const lockRelease = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    const lockTransaction = (async () => {
      await locker`BEGIN`;
      await locker`
        SELECT id
        FROM concurrency_harness_rows
        WHERE id = ${rowId}
        FOR UPDATE
      `;
      signalLockAcquired();
      await lockRelease;
      await locker`COMMIT`;
    })();

    try {
      await lockAcquired;
      const skipped = await contender<{ id: string }>`
        SELECT id
        FROM concurrency_harness_rows
        WHERE id = ${rowId}
        FOR UPDATE SKIP LOCKED
      `;

      expect(skipped).toHaveLength(0);
    } finally {
      releaseLock();
      await lockTransaction;
      // Row cleanup is now handled in afterEach
    }
  });
});
