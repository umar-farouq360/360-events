import type { Request, Response, NextFunction } from 'express';
import { db } from '../db/index.js';
import { rateLimits } from '../db/schema/index.js';
import { sql } from 'drizzle-orm';
import { addSeconds } from 'date-fns';

export interface RateLimitPolicy {
  name: string;
  points: number;       // Max requests
  durationSeconds: number; // Time window
}

export const rateLimitPolicies = {
  authentication: { name: 'auth', points: 5, durationSeconds: 60 * 15 }, // 5 reqs per 15 mins
  passwordReset: { name: 'reset', points: 3, durationSeconds: 60 * 60 }, // 3 reqs per hour
  checkout: { name: 'checkout', points: 10, durationSeconds: 60 },       // 10 reqs per minute
  public: { name: 'public', points: 100, durationSeconds: 60 },          // 100 reqs per min (general API)
};

export function withRateLimit(policy: RateLimitPolicy) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Rely on req.ip (secured by 'trust proxy' in security.ts)
    const identifier = req.ip || 'unknown';
    const key = `${policy.name}:${identifier}`;

    try {
      const now = new Date();
      
      // Upsert rate limit counter (Fixed Window Approach)
      const result = await db.insert(rateLimits)
        .values({
          key,
          points: 1,
          expiresAt: addSeconds(now, policy.durationSeconds)
        })
        .onConflictDoUpdate({
          target: rateLimits.key,
          set: {
            // Reset if expired, otherwise increment
            points: sql`CASE WHEN ${rateLimits.expiresAt} < ${now.toISOString()} THEN 1 ELSE ${rateLimits.points} + 1 END`,
            expiresAt: sql`CASE WHEN ${rateLimits.expiresAt} < ${now.toISOString()} THEN ${addSeconds(now, policy.durationSeconds).toISOString()} ELSE ${rateLimits.expiresAt} END`
          }
        })
        .returning();

      const currentRecord = result[0];

      if (!currentRecord) {
        // Defensive fallback for cases where the database did not return a row.
        next();
        return;
      }

      res.setHeader('X-RateLimit-Limit', policy.points);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, policy.points - currentRecord.points));
      
      if (currentRecord.points > policy.points) {
        const retryAfterSeconds = Math.ceil((currentRecord.expiresAt.getTime() - now.getTime()) / 1000);
        res.setHeader('Retry-After', retryAfterSeconds);
        
        res.status(429).json({
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many requests, please try again later.'
          }
        });
        return;
      }

      next();
    } catch (error) {
      console.error('[RateLimit] Error evaluating policy:', error);
      // Fail open on database errors to prevent blocking legitimate traffic during DB turbulence
      next(); 
    }
  };
}