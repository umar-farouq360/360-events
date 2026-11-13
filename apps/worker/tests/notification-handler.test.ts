import { describe, it, expect, beforeEach, vi } from 'vitest';
import { processNotificationJob } from '../src/handlers/notification-handler';
import { db } from '../../api/src/db';
import { notifications, notificationAttempts } from '../../api/src/db/schema/index';
import { eq } from 'drizzle-orm';
import { SmtpEmailProvider } from '../src/lib/email';
import { uuidv7 } from 'uuidv7';

describe('Notification Pipeline', () => {
  beforeEach(async () => {
    await db.delete(notificationAttempts).execute();
    await db.delete(notifications).execute();
  });

  it('should process a notification and update status to sent', async () => {
    const mockProvider = new SmtpEmailProvider('smtp://mock', true);
    vi.spyOn(mockProvider, 'sendEmail').mockResolvedValue({ messageId: 'mock-123' });

    const notificationId = uuidv7();
    await db.insert(notifications).values({
      id: notificationId,
      recipient: 'test@example.com',
      type: 'VERIFY_EMAIL',
      dedupeKey: 'verify-test-1',
      payload: { token: 'secret-xyz' }
    });

    await processNotificationJob(notificationId, mockProvider);

    const record = await db.query.notifications.findFirst({ where: eq(notifications.id, notificationId) });
    expect(record?.status).toBe('sent');
    
    const attempt = await db.query.notificationAttempts.findFirst({ where: eq(notificationAttempts.notificationId, notificationId) });
    expect(attempt?.providerReference).toBe('mock-123');
  });

  it('should block non-whitelisted emails in non-production environments', async () => {
    const mockProvider = new SmtpEmailProvider('smtp://mock', false, ['360events.ng']); // Only allow internal domain
    
    const result = await mockProvider.sendEmail({
      to: 'hacker@malicious.com',
      subject: 'Test',
      textBody: 'Test'
    });

    expect(result.messageId).toBe('blocked-by-guard');
  });

  it('should handle provider outages safely without crashing the business state', async () => {
    const mockProvider = new SmtpEmailProvider('smtp://mock', true);
    vi.spyOn(mockProvider, 'sendEmail').mockResolvedValue({ error: 'Connection Timeout' });

    const notificationId = uuidv7();
    await db.insert(notifications).values({
      id: notificationId,
      recipient: 'test@example.com',
      type: 'VERIFY_EMAIL',
      dedupeKey: 'verify-test-2',
      payload: { token: 'secret-xyz' }
    });

    await expect(processNotificationJob(notificationId, mockProvider)).rejects.toThrow('Email delivery failed');

    const record = await db.query.notifications.findFirst({ where: eq(notifications.id, notificationId) });
    expect(record?.status).toBe('failed'); // Ready for dead-letter/retry queue logic
  });
});