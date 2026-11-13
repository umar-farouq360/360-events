import type { Request, Response, NextFunction } from 'express';
import { eq, and } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { db } from '../db/index.js';
import { idempotencyKeys } from '../db/schema/idempotency.schema.js';
import { hashPayload } from '../lib/hash.js';

export function withIdempotency(scope: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const key = req.header('Idempotency-Key');
    if (!key) {
      res.status(400).json({ error: 'Idempotency-Key header is required' });
      return;
    }

    const requestHash = hashPayload(req.body);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24-hour expiration

    try {
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
        // Lock already exists; fetch existing execution state
        const existing = await db.select()
          .from(idempotencyKeys)
          .where(and(eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.key, key)))
          .limit(1)
          .then(result => result[0]);

        if (!existing) {
          res.status(409).json({ code: 'IDEMPOTENCY_CONFLICT', message: 'Concurrency conflict. Please retry.' });
          return;
        }

        if (existing.status === 'in_progress') {
          res.status(409).json({ code: 'IDEMPOTENCY_IN_PROGRESS', message: 'A request with this Idempotency-Key is currently processing.' });
          return;
        }

        if (existing.status === 'completed') {
          if (existing.requestHash !== requestHash) {
            res.status(422).json({ code: 'IDEMPOTENCY_KEY_REUSED', message: 'Idempotency-Key reused with a different payload.' });
            return;
          }
          res.status(existing.responseStatus ?? 200).json(existing.responseBody);
          return;
        }
      }

      // Lock acquired successfully; intercept the outgoing response
      const originalSend = res.send;
      let responseSent = false;

      res.send = function (this: Response, body: unknown): Response {
        if (responseSent) return this;
        responseSent = true;
        this.send = originalSend; // Unbind to prevent recursive loops

        let parsedBody = body;
        if (typeof body === 'string' && this.get('Content-Type')?.includes('application/json')) {
          try {
            parsedBody = JSON.parse(body);
          } catch {
            // Keep original string if parsing fails
          }
        }

        if (this.statusCode >= 500) {
          // Unlocking on 5xx to allow the client to retry a transient server failure safely
          db.delete(idempotencyKeys)
            .where(and(eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.key, key)))
            .execute()
            .catch(err => console.error('[Idempotency] Deletion failed on 500 status:', err));
        } else {
          // Persist 2xx and 4xx results permanently for replay
          db.update(idempotencyKeys)
            .set({
              status: 'completed',
              responseStatus: this.statusCode,
              responseBody: parsedBody,
              updatedAt: new Date(),
            })
            .where(and(eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.key, key)))
            .execute()
            .catch(err => console.error('[Idempotency] State update failed:', err));
        }

        return originalSend.call(this, body);
      };

      next();
    } catch (err) {
      next(err);
    }
  };
}