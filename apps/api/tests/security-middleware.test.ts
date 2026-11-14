import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { configureSecurity } from '../src/middleware/security.middleware.js';
import { validateRequest } from '../src/middleware/validation.middleware.js';
import {
  withRateLimit,
  rateLimitPolicies,
  type RateLimitStore,
} from '../src/middleware/rate-limit.middleware.js';
import { httpLogger } from '../src/lib/logger.js';
import { db } from '../src/db/index.js';
import { rateLimits } from '../src/db/schema/index.js';

describe('Security & Middleware Framework', () => {
  const app = express();
  configureSecurity(app, ['https://app.360events.ng']);
  app.use(httpLogger);

  const testSchema = z.object({
    body: z.object({
      password: z.string().min(8),
    }),
  });

  app.post('/test-validation', validateRequest(testSchema), (_req, res) => {
    res.status(200).json({ success: true });
  });

  app.get(
    '/test-rate-limit',
    withRateLimit(rateLimitPolicies.authentication),
    (_req, res) => {
      res.status(200).json({ success: true });
    },
  );

  beforeEach(async () => {
    await db.delete(rateLimits).execute();
  });

  it('should block requests from disallowed origins (CORS)', async () => {
    const res = await request(app)
      .post('/test-validation')
      .set('Origin', 'https://malicious-site.com')
      .send({ password: 'securepassword123' });

    expect(res.status).toBe(500);
    expect(res.text).toContain('Not allowed by CORS');
  });

  it('should prevent validation errors from echoing sensitive secrets', async () => {
    const res = await request(app)
      .post('/test-validation')
      .set('Origin', 'https://app.360events.ng')
      .send({ password: 'short' });

    expect(res.status).toBe(400);
    const body = res.body as { error?: { code?: string } };
    expect(body.error?.code).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(res.body)).not.toContain('short');
  });

  it('should enforce PostgreSQL-backed rate limits with a request ID in the 429 envelope', async () => {
    for (let i = 0; i < 5; i++) {
      const res = await request(app).get('/test-rate-limit');
      expect(res.status).toBe(200);
      expect(res.headers['x-ratelimit-remaining']).toBe(String(5 - (i + 1)));
    }

    const blockedRes = await request(app)
      .get('/test-rate-limit')
      .set('X-Request-Id', 'rate-limit-blocked-123');
    const blockedBody = blockedRes.body as {
      error?: { code?: string; requestId?: string };
    };

    expect(blockedRes.status).toBe(429);
    expect(blockedBody.error?.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(blockedBody.error?.requestId).toBe('rate-limit-blocked-123');
    expect(blockedRes.headers['x-request-id']).toBe('rate-limit-blocked-123');
    expect(blockedRes.headers).toHaveProperty('retry-after');
  });

  it('should reset the counter after the fixed window expires', async () => {
    await request(app).get('/test-rate-limit');

    const records = await db.select().from(rateLimits);
    const record = records[0];
    if (!record) {
      throw new Error('Expected the rate-limit counter to be persisted');
    }

    await db
      .update(rateLimits)
      .set({ points: 5, expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(rateLimits.key, record.key));

    const resetResponse = await request(app).get('/test-rate-limit');
    expect(resetResponse.status).toBe(200);
    expect(resetResponse.headers['x-ratelimit-remaining']).toBe('4');

    const [resetRecord] = await db
      .select()
      .from(rateLimits)
      .where(eq(rateLimits.key, record.key));
    expect(resetRecord?.points).toBe(1);
    expect(resetRecord?.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('should fail closed when the rate-limit store returns no counter row', async () => {
    const missingRowStore: RateLimitStore = {
      increment: async () => undefined,
    };
    const isolatedApp = express();
    isolatedApp.use(httpLogger);
    isolatedApp.get(
      '/limited',
      withRateLimit(rateLimitPolicies.authentication, missingRowStore),
      (_req, res) => res.status(200).json({ success: true }),
    );

    const response = await request(isolatedApp)
      .get('/limited')
      .set('X-Request-Id', 'missing-counter-456');

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      error: {
        code: 'RATE_LIMIT_UNAVAILABLE',
        message: 'Rate limiting is temporarily unavailable. Please try again later.',
        requestId: 'missing-counter-456',
      },
    });
    expect(response.headers['x-request-id']).toBe('missing-counter-456');
  });

  it('should fail closed when the rate-limit store throws', async () => {
    const failingStore: RateLimitStore = {
      increment: async () => {
        throw new Error('database unavailable');
      },
    };
    const isolatedApp = express();
    isolatedApp.use(httpLogger);
    isolatedApp.get(
      '/limited',
      withRateLimit(rateLimitPolicies.authentication, failingStore),
      (_req, res) => res.status(200).json({ success: true }),
    );

    const response = await request(isolatedApp)
      .get('/limited')
      .set('X-Request-Id', 'store-failure-789');

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('RATE_LIMIT_UNAVAILABLE');
    expect(response.body.error.requestId).toBe('store-failure-789');
    expect(JSON.stringify(response.body)).not.toContain('database unavailable');
    expect(response.headers['x-request-id']).toBe('store-failure-789');
  });

  it('should extract the correct IP behind a proxy when trust proxy is set', async () => {
    await request(app)
      .get('/test-rate-limit')
      .set('X-Forwarded-For', '203.0.113.195');

    const records = await db.select().from(rateLimits);
    expect(records[0]?.key).toContain('203.0.113.195');
  });
});
