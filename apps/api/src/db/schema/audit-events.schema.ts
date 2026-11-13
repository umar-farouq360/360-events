import { 
  pgTable, text, timestamp, jsonb, pgEnum } from 'drizzle-orm/pg-core';

export const dbMigrations = pgTable('db_migrations_history', {
  id: text('id').primaryKey(),
  appliedAt: timestamp('applied_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
});

// P2-T03: Audit Log Schema
export const actorTypeEnum = pgEnum('actor_type', ['user', 'system', 'worker']);

export const auditEvents = pgTable('audit_events', {
  id: text('id').primaryKey(), // UUIDv7
  actorType: actorTypeEnum('actor_type').notNull(),
  actorId: text('actor_id').notNull(),
  action: text('action').notNull(),
  entity: text('entity').notNull(),
  outcome: text('outcome').notNull(),
  requestId: text('request_id'),
  metadata: jsonb('metadata').default('{}').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
});