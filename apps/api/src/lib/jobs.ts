import { uuidv7 } from 'uuidv7';
import { outboxEvents } from '../db/schema/outbox-events.schema.js';
import type { Transaction } from './transitions.js';

export interface EnqueueOptions {
  dedupeKey?: string;
  runAt?: Date;
  maxAttempts?: number;
}

/**
 * Enqueues a durable job in the same transaction as the business operation.
 * Utilizes dedupeKey to safely ignore concurrent duplicate requests.
 */
export async function enqueue(
  tx: Transaction,
  type: string,
  payload: Record<string, unknown>,
  options?: EnqueueOptions
): Promise<void> {
  await tx.insert(outboxEvents)
    .values({
      id: uuidv7(),
      type,
      payload,
      dedupeKey: options?.dedupeKey ?? null,
      runAt: options?.runAt ?? new Date(),
      maxAttempts: options?.maxAttempts ?? 3,
    })
    .onConflictDoNothing({ target: outboxEvents.dedupeKey });
}
export { deleteExpiredIdempotencyKeys } from './idempotency-cleanup.js';