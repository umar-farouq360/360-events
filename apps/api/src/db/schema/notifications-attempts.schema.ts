import { pgTable, varchar, timestamp, text } from 'drizzle-orm/pg-core';
import { notifications } from './notifications.schema.js';

export const notificationAttempts = pgTable('notification_attempts', {
  id: varchar('id', { length: 36 }).primaryKey(),
  notificationId: varchar('notification_id', { length: 36 }).notNull().references(() => notifications.id, { onDelete: 'cascade' }),
  providerReference: varchar('provider_reference', { length: 255 }),
  error: text('error'),
  attemptedAt: timestamp('attempted_at', { withTimezone: true }).notNull().defaultNow(),
});

export type NotificationAttempt = typeof notificationAttempts.$inferSelect;
export type NewNotificationAttempt = typeof notificationAttempts.$inferInsert;