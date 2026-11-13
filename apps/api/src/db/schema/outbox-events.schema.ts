import { sql } from 'drizzle-orm';
import { 
  pgTable, text, timestamp,
  jsonb, pgEnum, integer, index, check } from 'drizzle-orm/pg-core';


// P2-T04: Transactional Outbox Schema
export const jobStatusEnum = pgEnum('job_status', ['pending', 'processing', 'completed', 'failed']);

export const outboxEvents = pgTable('outbox_events', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  payload: jsonb('payload').default('{}').notNull(),
  dedupeKey: text('dedupe_key').unique(),
  status: jobStatusEnum('status').default('pending').notNull(),
  attempts: integer('attempts').default(0).notNull(),
  maxAttempts: integer('max_attempts').default(3).notNull(),
  runAt: timestamp('run_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  lockedBy: text('locked_by'),
  leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true, mode: 'date' }),
  lastError: text('last_error'),
  completedAt: timestamp('completed_at', { withTimezone: true, mode: 'date' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => [
  index('outbox_pending_run_at_idx').on(table.runAt, table.id)
    .where(sql`${table.status} = 'pending'`),
  index('outbox_processing_lease_idx').on(table.leaseExpiresAt, table.id)
    .where(sql`${table.status} = 'processing'`),
  check('outbox_attempts_check', sql`${table.attempts} >= 0 AND ${table.attempts} <= ${table.maxAttempts}`),
  check('outbox_max_attempts_check', sql`${table.maxAttempts} > 0`),
  check(
    'outbox_processing_lease_check',
    sql`${table.status} <> 'processing' OR (${table.lockedBy} IS NOT NULL AND ${table.leaseExpiresAt} IS NOT NULL)`,
  ),
]);

export type OutboxEvent = typeof outboxEvents.$inferSelect;
export type NewOutboxEvent = typeof outboxEvents.$inferInsert;
