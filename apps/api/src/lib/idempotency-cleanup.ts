import { lt } from 'drizzle-orm';
import { db } from '../db/index.js';
import { idempotencyKeys } from '../db/schema/idempotency.schema.js';

/**
 * Deletes idempotency keys whose expires_at has passed.
 * Safe to call concurrently; idempotent.
 * Intended to be invoked periodically by the worker scheduler (see Issue #6 / P2-T04).
 */
export async function deleteExpiredIdempotencyKeys(): Promise<number> {
  const result = await db
    .delete(idempotencyKeys)
    .where(lt(idempotencyKeys.expiresAt, new Date()))
    .returning({ id: idempotencyKeys.id });
  return result.length;
}

/** Test/DI hook: how many expired keys are currently present. */
export async function countExpiredIdempotencyKeys(now: Date = new Date()): Promise<number> {
  const rows = await db
    .select({ id: idempotencyKeys.id })
    .from(idempotencyKeys)
    .where(lt(idempotencyKeys.expiresAt, now));
  return rows.length;
}