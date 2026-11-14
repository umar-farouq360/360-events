import type { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import { eq, and, lt, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import type { ApiErrorResponse } from '@360events/types';
import { db } from '../db/index.js';
import { idempotencyKeys } from '../db/schema/idempotency.schema.js';
import { hashPayload } from '../lib/hash.js';

/** Rows stuck `in_progress` longer than this are assumed crashed and may be reclaimed. */
export const IDEMPOTENCY_STALE_MS = 60_000;

/** TTL for a completed key. Replay after this window is treated as a fresh request. */
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

type IdempotencyRow = typeof idempotencyKeys.$inferSelect;

function requestIdFor(req: Request): string {
  const { id } = req;
  if (typeof id === 'string' && id.length > 0) return id;
  if (typeof id === 'number') return String(id);
  return req.header('x-request-id') ?? randomUUID();
}

function errorEnvelope(
  req: Request,
  status: number,
  code: string,
  message: string,
  res: Response,
): void {
  const body: ApiErrorResponse = {
    error: { code, message, requestId: requestIdFor(req) },
  };
  res.status(status).json(body);
}

async function findKey(scope: string, key: string): Promise<IdempotencyRow | undefined> {
  const rows = await db
    .select()
    .from(idempotencyKeys)
    .where(and(eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.key, key)))
    .limit(1);
  return rows[0];
}

/**
 * Attempt to atomically reclaim a stale in_progress row.
 * Returns the row's id if this caller won the CAS, otherwise undefined.
 * Uses a conditional UPDATE so exactly one racing retry can reclaim.
 */
async function tryReclaimStale(id: string): Promise<boolean> {
  const staleBefore = new Date(Date.now() - IDEMPOTENCY_STALE_MS);
  const result = await db
    .update(idempotencyKeys)
    .set({
      status: 'in_progress',
      requestHash: sql`${idempotencyKeys.requestHash}`, // unchanged; placeholder
      updatedAt: new Date(),
      expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
    })
    .where(
      and(
        eq(idempotencyKeys.id, id),
        eq(idempotencyKeys.status, 'in_progress'),
        lt(idempotencyKeys.updatedAt, staleBefore),
      ),
    )
    .returning({ id: idempotencyKeys.id });
  return result.length > 0;
}

export function withIdempotency(scope: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const key = req.header('Idempotency-Key');
    if (!key) {
      errorEnvelope(req, 400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required', res);
      return;
    }

    const requestHash = hashPayload(req.body);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + IDEMPOTENCY_TTL_MS);

    try {
      // --- Attempt to become the owner of this key ---
      const insertResult = await db
        .insert(idempotencyKeys)
        .values({
          id: uuidv7(),
          scope,
          key,
          requestHash,
          status: 'in_progress',
          expiresAt,
        })
        .onConflictDoNothing({ target: [idempotencyKeys.scope, idempotencyKeys.key] })
        .returning({ id: idempotencyKeys.id });

      if (insertResult.length === 0) {
        // Key exists. Inspect and decide: replay, reject, reclaim, or (if expired) replace.
        const existing = await findKey(scope, key);
        if (!existing) {
          // Row vanished between insert and select (concurrent delete). Treat as conflict.
          errorEnvelope(req, 409, 'IDEMPOTENCY_CONFLICT',
            'Concurrency conflict. Please retry.', res);
          return;
        }

        // --- Expired key is treated as absent: delete and re-insert atomically ---
        if (existing.expiresAt < now) {
          // Delete only if still expired & still the same row (avoid racing a refresh).
          const deleted = await db
            .delete(idempotencyKeys)
            .where(and(
              eq(idempotencyKeys.id, existing.id),
              lt(idempotencyKeys.expiresAt, now),
            ))
            .returning({ id: idempotencyKeys.id });

          if (deleted.length === 0) {
            // Someone else refreshed it in between. Re-read and fall through to normal handling.
            const refreshed = await findKey(scope, key);
            if (!refreshed) {
              errorEnvelope(req, 409, 'IDEMPOTENCY_CONFLICT',
                'Concurrency conflict. Please retry.', res);
              return;
            }
            // Recurse once by re-running the whole handler is overkill; just 409.
            errorEnvelope(req, 409, 'IDEMPOTENCY_IN_PROGRESS',
              'A request with this Idempotency-Key is currently processing.', res);
            return;
          }

          // Expired row removed; try to claim fresh.
          const reclaimInsert = await db
            .insert(idempotencyKeys)
            .values({
              id: uuidv7(),
              scope,
              key,
              requestHash,
              status: 'in_progress',
              expiresAt,
            })
            .onConflictDoNothing({ target: [idempotencyKeys.scope, idempotencyKeys.key] })
            .returning({ id: idempotencyKeys.id });

          if (reclaimInsert.length === 0) {
            errorEnvelope(req, 409, 'IDEMPOTENCY_CONFLICT',
              'Concurrency conflict. Please retry.', res);
            return;
          }
          // Fall through to "lock acquired" below.
        } else if (existing.status === 'in_progress') {
          // --- Stale in_progress: try to reclaim if older than threshold ---
          const staleBefore = new Date(Date.now() - IDEMPOTENCY_STALE_MS);
          if (existing.updatedAt < staleBefore) {
            const reclaimed = await tryReclaimStale(existing.id);
            if (!reclaimed) {
              // Another retry won the reclaim race.
              errorEnvelope(req, 409, 'IDEMPOTENCY_IN_PROGRESS',
                'A request with this Idempotency-Key is currently processing.', res);
              return;
            }
            // We now own it. Update requestHash/expiresAt to reflect this attempt.
            await db
              .update(idempotencyKeys)
              .set({ requestHash, expiresAt, updatedAt: new Date() })
              .where(eq(idempotencyKeys.id, existing.id));
            // Fall through to "lock acquired".
          } else {
            errorEnvelope(req, 409, 'IDEMPOTENCY_IN_PROGRESS',
              'A request with this Idempotency-Key is currently processing.', res);
            return;
          }
        } else if (existing.status === 'completed') {
          if (existing.requestHash !== requestHash) {
            errorEnvelope(req, 422, 'IDEMPOTENCY_KEY_REUSED',
              'Idempotency-Key reused with a different payload.', res);
            return;
          }
          res.status(existing.responseStatus ?? 200).json(existing.responseBody);
          return;
        }
      }

      // --- Lock acquired. Intercept response, persist BEFORE sending. ---
      const originalJson = res.json.bind(res);
      const originalSend = res.send.bind(res);
      const originalEnd = res.end.bind(res) as (
        chunk?: unknown,
        encodingOrCallback?: BufferEncoding | (() => void),
        callback?: () => void,
      ) => Response;
      let persisted = false;

      const persist = async (statusCode: number, body: unknown): Promise<void> => {
        if (persisted) return;
        persisted = true;
        if (statusCode >= 500) {
          // Unlock so client can retry after transient failure.
          await db
            .delete(idempotencyKeys)
            .where(and(eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.key, key)))
            .catch((err) => {
              console.error('[Idempotency] Deletion failed on 5xx:', err);
            });
          return;
        }
        await db
          .update(idempotencyKeys)
          .set({
            status: 'completed',
            responseStatus: statusCode,
            responseBody: body,
            updatedAt: new Date(),
          })
          .where(and(eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.key, key)))
          .catch((err) => {
            console.error('[Idempotency] State update failed:', err);
          });
      };

      // Intercept json() and send() to persist before flushing to the client.
      res.json = function (this: Response, body: unknown): Response {
        void persist(this.statusCode, body).finally(() => {
          res.json = originalJson;
          originalJson(body);
        });
        return this;
      };

      res.send = function (this: Response, body: unknown): Response {
        let parsed: unknown = body;
        if (typeof body === 'string' && this.get('Content-Type')?.includes('application/json')) {
          try { parsed = JSON.parse(body); } catch { /* keep string */ }
        }
        void persist(this.statusCode, parsed).finally(() => {
          res.send = originalSend;
          originalSend(body);
        });
        return this;
      };

      res.end = function (
        this: Response,
        chunk?: unknown,
        encodingOrCallback?: BufferEncoding | (() => void),
        callback?: () => void,
      ): Response {
        // Only intercept end() if neither json/send was used (empty 204 etc).
        if (!persisted) {
          void persist(this.statusCode, undefined).finally(() => {
            res.end = originalEnd;
            originalEnd(chunk, encodingOrCallback, callback);
          });
          return this;
        }
        return originalEnd(chunk, encodingOrCallback, callback);
      };

      next();
    } catch (err) {
      next(err);
    }
  };
}