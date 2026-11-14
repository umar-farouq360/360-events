import { db } from '@360events/api/db';
import { notifications, notificationAttempts } from '@360events/api/schema';
import { eq, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import type { EmailProvider, EmailPayload } from '../lib/email.js';
import { renderTemplate } from '../lib/templates.js';

export async function processNotificationJob(
  notificationId: string, 
  emailProvider: EmailProvider
): Promise<void> {
  const [record] = await db
    .select()
    .from(notifications)
    .where(eq(notifications.id, notificationId))
    .limit(1);

  if (!record || record.status === 'sent') {
    return; // Deduplication: Already processed or missing
  }

  // Type assertion safe by schema validation on insert
  const payloadData = record.payload as Record<string, unknown>; 
  
  const emailPayload: EmailPayload = {
    to: record.recipient,
    subject: renderTemplate(record.type, 'subject', payloadData),
    textBody: renderTemplate(record.type, 'text', payloadData),
    htmlBody: renderTemplate(record.type, 'html', payloadData)
  };

  const { messageId, error } = await emailProvider.sendEmail(emailPayload);

// Always record the attempt; persist the terminal/in-progress status in the same tx.
await db.transaction(async (tx) => {
  await tx.insert(notificationAttempts).values({
    id: uuidv7(),
    notificationId: record.id,
    providerReference: messageId ?? null,
    error: error ?? null,
  });

  await tx.update(notifications)
    .set({ status: error ? 'failed' : 'sent', updatedAt: sql`NOW()` })
    .where(eq(notifications.id, record.id));
});

if (error) {
  console.error(`[Notification] Failed to send ${record.type} to ${record.recipient}. Error: ${error}`);
  throw new Error(`Email delivery failed for ${notificationId}`); // outside tx → retry, but state is committed
}
console.info(`[Notification] Successfully sent ${record.type} to ${record.recipient}`);}