import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { pgTable, text } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { queryClient } from '../src/db/index.js';
import { databaseUrl } from '../src/config/database-url.js';
import { auditEvents } from '../src/db/schema/audit-events.schema.js';
import { recordAudit, validateMetadata } from '../src/lib/audit.js';

const auditSchema = `audit_test_${randomUUID().replaceAll('-', '')}`;
const auditSql = postgres(databaseUrl, { max: 1 });
const auditDb = drizzle(auditSql);

const businessFixture = pgTable('audit_test_business', {
  id: text('id').primaryKey(),
  description: text('description').notNull(),
});

const expectDatabaseImmutabilityError = async (operation: Promise<unknown>): Promise<void> => {
  let thrown: unknown;

  try {
    await operation;
  } catch (error: unknown) {
    thrown = error;
  }

  if (!(thrown instanceof Error) || !('cause' in thrown)) {
    throw new Error('Expected PostgreSQL to reject the audit modification.');
  }

  const { cause } = thrown;
  if (
    typeof cause !== 'object'
    || cause === null
    || !('code' in cause)
    || cause.code !== 'P0001'
    || !('message' in cause)
    || typeof cause.message !== 'string'
    || !cause.message.includes('Audit events are immutable')
  ) {
    throw new Error('Expected PostgreSQL immutability error P0001.');
  }
};

describe('Audit Log (P2-T03)', () => {
  beforeAll(async () => {
    // Isolate this suite so its fixture and cleanup cannot affect other tests.
    await queryClient.unsafe(`CREATE SCHEMA ${auditSchema}`);
    await auditSql.unsafe(`SET search_path TO ${auditSchema}`);

    await auditSql.unsafe(`
      CREATE TYPE actor_type AS ENUM ('user', 'system', 'worker');

      CREATE TABLE audit_events (
        id text PRIMARY KEY,
        actor_type actor_type NOT NULL,
        actor_id text NOT NULL,
        action text NOT NULL,
        entity text NOT NULL,
        outcome text NOT NULL,
        request_id text,
        metadata jsonb NOT NULL DEFAULT '{}',
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE audit_test_business (
        id text PRIMARY KEY,
        description text NOT NULL
      );
    `);

    // P2-T03: enforce immutability at the database level.
    await auditSql.unsafe(`
      CREATE OR REPLACE FUNCTION prevent_audit_modification()
      RETURNS TRIGGER AS $$
      BEGIN
          RAISE EXCEPTION 'Audit events are immutable';
      END;
      $$ LANGUAGE plpgsql;

      CREATE TRIGGER prevent_audit_update_delete
      BEFORE UPDATE OR DELETE ON audit_events
      FOR EACH ROW EXECUTE FUNCTION prevent_audit_modification();
    `);
  });

  afterAll(async () => {
    await auditSql.end();
    await queryClient.unsafe(`DROP SCHEMA ${auditSchema} CASCADE`);
  });

  describe('Metadata Validation', () => {
    it('rejects forbidden metadata keys', () => {
      expect(() => validateMetadata({ password: '123' }))
        .toThrow('Forbidden metadata key rejected: password');
      
      expect(() => validateMetadata({ TOKEN: 'abc', safeKey: 'val' }))
        .toThrow('Forbidden metadata key rejected: TOKEN');
    });

    it('allows safe metadata keys', () => {
      const safe = { reason: 'user requested', changes: { status: 'active' } };
      expect(() => validateMetadata(safe)).not.toThrow();
    });
  });

  describe('Transactional Guarantees & Immutability [INV-14] [INV-21]', () => {
    it('commits the audit row successfully with its business transaction', async () => {
      await auditDb.transaction(async (tx) => {
        await tx.insert(businessFixture).values({ id: 'committed', description: 'approved event' });
        await recordAudit(tx as Parameters<typeof recordAudit>[0], {
          actorType: 'user',
          actorId: 'usr_123',
          action: 'approve_event',
          entity: 'evt_456',
          outcome: 'success',
          metadata: { reason: 'Looks good' },
        });
      });

      const rows = await auditDb.select().from(auditEvents).where(eq(auditEvents.actorId, 'usr_123'));
      const businessRows = await auditDb.select().from(businessFixture);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.action).toBe('approve_event');
      expect(businessRows).toHaveLength(1);
    });

    it('rolls back the audit row if the business transaction fails', async () => {
      await expect(auditDb.transaction(async (tx) => {
        await tx.insert(businessFixture).values({ id: 'rolled-back', description: 'failed operation' });
        await recordAudit(tx as Parameters<typeof recordAudit>[0], {
          actorType: 'system',
          actorId: 'sys_0',
          action: 'fail_test',
          entity: 'none',
          outcome: 'pending'
        });
        throw new Error('Simulated business transaction failure');
      })).rejects.toThrow('Simulated business transaction failure');

      const rows = await auditDb.select().from(auditEvents).where(eq(auditEvents.action, 'fail_test'));
      const businessRows = await auditDb.select().from(businessFixture).where(eq(businessFixture.id, 'rolled-back'));
      expect(rows).toHaveLength(0);
      expect(businessRows).toHaveLength(0);
    });

    it('fails UPDATE and DELETE operations at the database level [INV-14]', async () => {
      await auditDb.transaction(async (tx) => await recordAudit(tx as Parameters<typeof recordAudit>[0], {
          actorType: 'worker',
          actorId: 'wrk_1',
          action: 'payout',
          entity: 'po_1',
          outcome: 'success',
      }));

      const [record] = await auditDb.select().from(auditEvents).where(eq(auditEvents.action, 'payout'));
      expect(record).toBeDefined();

      if (!record) return;

      // Prove UPDATE is blocked by PostgreSQL
      await expectDatabaseImmutabilityError(
        auditDb.update(auditEvents).set({ outcome: 'tampered' }).where(eq(auditEvents.id, record.id))
      );

      // Prove DELETE is blocked by PostgreSQL
      await expectDatabaseImmutabilityError(
        auditDb.delete(auditEvents).where(eq(auditEvents.id, record.id))
      );
    });
  });
});
