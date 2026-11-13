import { 
    pgTable, varchar, timestamp, integer } from 'drizzle-orm/pg-core';

export const rateLimits = pgTable('rate_limits', {
  key: varchar('key', { length: 255 }).primaryKey(), // Format: {policy}:{identifier}
  points: integer('points').notNull().default(0),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});