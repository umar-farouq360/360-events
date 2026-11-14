import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import type { ApiErrorResponse } from '@360events/types';
import { addSeconds } from 'date-fns';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { rateLimits } from '../db/schema/index.js';
import { logger } from '../lib/logger.js';

export interface RateLimitPolicy {
  name: string;
  points: number;
  durationSeconds: number;
}

interface RateLimitCounter {
  points: number;
  expiresAt: Date;
}

export interface RateLimitStore {
  increment(input: {
    key: string;
    policy: RateLimitPolicy;
    now: Date;
  }): Promise<RateLimitCounter | undefined>;
}

export const rateLimitPolicies = {
  authentication: { name: 'auth', points: 5, durationSeconds: 60 * 15 },
  passwordReset: { name: 'reset', points: 3, durationSeconds: 60 * 60 },
  checkout: { name: 'checkout', points: 10, durationSeconds: 60 },
  public: { name: 'public', points: 100, durationSeconds: 60 },
} satisfies Record<string, RateLimitPolicy>;

const postgresRateLimitStore: RateLimitStore = {
  async increment({ key, policy, now }) {
    const nextExpiry = addSeconds(now, policy.durationSeconds);
    const nowTimestamp = now.toISOString();
    const nextExpiryTimestamp = nextExpiry.toISOString();

    const result = await db
      .insert(rateLimits)
      .values({
        key,
        points: 1,
        expiresAt: nextExpiry,
      })
      .onConflictDoUpdate({
        target: rateLimits.key,
        set: {
          points: sql`CASE WHEN ${rateLimits.expiresAt} <= ${nowTimestamp}::timestamptz THEN 1 ELSE ${rateLimits.points} + 1 END`,
          expiresAt: sql`CASE WHEN ${rateLimits.expiresAt} <= ${nowTimestamp}::timestamptz THEN ${nextExpiryTimestamp}::timestamptz ELSE ${rateLimits.expiresAt} END`,
        },
      })
      .returning();

    return result[0];
  },
};

function sendRateLimitUnavailable(
  res: Response,
  requestId: string,
): void {
  const body: ApiErrorResponse = {
    error: {
      code: 'RATE_LIMIT_UNAVAILABLE',
      message: 'Rate limiting is temporarily unavailable. Please try again later.',
      requestId,
    },
  };

  res.setHeader('X-Request-Id', requestId);
  res.status(503).json(body);
}

export function withRateLimit(
  policy: RateLimitPolicy,
  store: RateLimitStore = postgresRateLimitStore,
) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const requestId = String(req.id ?? randomUUID());
    res.setHeader('X-Request-Id', requestId);

    // req.ip is derived from the configured trusted-proxy boundary.
    const identifier = req.ip || 'unknown';
    const key = `${policy.name}:${identifier}`;

    try {
      const now = new Date();
      const currentRecord = await store.increment({ key, policy, now });

      if (!currentRecord) {
        logger.error(
          { requestId, policy: policy.name },
          'Rate-limit store returned no counter record',
        );
        sendRateLimitUnavailable(res, requestId);
        return;
      }

      res.setHeader('X-RateLimit-Limit', policy.points);
      res.setHeader(
        'X-RateLimit-Remaining',
        Math.max(0, policy.points - currentRecord.points),
      );

      if (currentRecord.points > policy.points) {
        const retryAfterSeconds = Math.max(
          1,
          Math.ceil((currentRecord.expiresAt.getTime() - now.getTime()) / 1000),
        );
        res.setHeader('Retry-After', retryAfterSeconds);

        const body: ApiErrorResponse = {
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many requests, please try again later.',
            requestId,
          },
        };
        res.status(429).json(body);
        return;
      }

      next();
    } catch (error) {
      logger.error(
        { err: error, requestId, policy: policy.name },
        'Rate-limit store is unavailable',
      );
      sendRateLimitUnavailable(res, requestId);
    }
  };
}
