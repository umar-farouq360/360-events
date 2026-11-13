import { pgTable, varchar, timestamp, jsonb, unique, integer, pgEnum } from 'drizzle-orm/pg-core';

export const idempotencyStatusEnum = pgEnum('idempotency_status', ['in_progress', 'completed']);

export const idempotencyKeys = pgTable('idempotency_keys', {
  id: varchar('id', { length: 36 }).primaryKey(),
  scope: varchar('scope', { length: 100 }).notNull(),
  key: varchar('key', { length: 255 }).notNull(),
  requestHash: varchar('request_hash', { length: 255 }).notNull(),
  status: idempotencyStatusEnum('status').notNull().default('in_progress'),
  resultReference: varchar('result_reference', { length: 255 }),
  responseStatus: integer('response_status'),
  responseBody: jsonb('response_body'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  unqScopeKey: unique('unq_idempotency_scope_key').on(table.scope, table.key)
}));