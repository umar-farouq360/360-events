import { pgTable, varchar, timestamp, jsonb, unique, pgEnum } from 'drizzle-orm/pg-core';

export const notificationStatusEnum = pgEnum('notification_status', ['pending', 'sent', 'failed']);

export const notifications = pgTable('notifications', {
  id: varchar('id', { length: 36 }).primaryKey(),
  eventId: varchar('event_id', { length: 36 }), 
  recipient: varchar('recipient', { length: 255 }).notNull(),
  type: varchar('type', { length: 50 }).notNull(),
  dedupeKey: varchar('dedupe_key', { length: 255 }).notNull(),
  status: notificationStatusEnum('status').notNull().default('pending'),
  payload: jsonb('payload').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  unqDedupeKey: unique('unq_notifications_dedupe_key').on(table.dedupeKey)
}));

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;