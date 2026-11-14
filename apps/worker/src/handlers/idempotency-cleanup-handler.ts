import { deleteExpiredIdempotencyKeys } from '@360events/api/jobs'; // see step 6 re: export
import type { JobContext } from '../lib/runner.js';

/**
 * Recurring maintenance job: purges idempotency keys whose expires_at has passed.
 * Registered on the runner under the outbox type 'cleanup-idempotency-keys'.
 * Closes the deferred scheduler sub-item from audit Issue #5 (P2-T05).
 */
export async function processIdempotencyCleanupJob(_payload: unknown, _ctx: JobContext): Promise<void> {
  const deleted = await deleteExpiredIdempotencyKeys();
  console.info(`[IdempotencyCleanup] Deleted ${deleted} expired idempotency key(s)`);
}