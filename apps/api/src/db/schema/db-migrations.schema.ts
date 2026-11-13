import { 
  pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const dbMigrations = pgTable('db_migrations_history', {
  id: text('id').primaryKey(),
  appliedAt: timestamp('applied_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
});
