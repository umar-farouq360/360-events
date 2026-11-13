import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { z } from 'zod';
import { configureSecurity } from '../src/middleware/security.middleware.js';
import { validateRequest } from '../src/middleware/validation.middleware.js';
import { withRateLimit, rateLimitPolicies } from '../src/middleware/rate-limit.middleware.js';
import { db } from '../src/db/index.js';
import { rateLimits } from '../src/db/schema/index.js';

describe('Security & Middleware Framework', () => {
  const app = express();
  configureSecurity(app, ['https://app.360events.ng']);

  const testSchema = z.object({
    body: z.object({
      password: z.string().min(8)
    })
  });

  app.post('/test-validation', validateRequest(testSchema), (req, res) => {
    res.status(200).json({ success: true });
  });

  app.get('/test-rate-limit', withRateLimit(rateLimitPolicies.authentication), (req, res) => {
    res.status(200).json({ success: true });
  });

  beforeEach(async () => {
    await db.delete(rateLimits).execute();
  });

  it('should block requests from disallowed origins (CORS)', async () => {
    const res = await request(app)
      .post('/test-validation')
      .set('Origin', 'https://malicious-site.com')
      .send({ password: 'securepassword123' });
    
    expect(res.status).toBe(500); // cors library throws error which gets caught by default handler
    expect(res.text).toContain('Not allowed by CORS');
  });

  it('should prevent validation errors from echoing sensitive secrets', async () => {
    const res = await request(app)
      .post('/test-validation')
      .set('Origin', 'https://app.360events.ng')
      .send({ password: 'short' }); // Invalid password
      
    expect(res.status).toBe(400);
    const body = res.body as { error?: { code?: string } };
    expect(body.error?.code).toBe('VALIDATION_ERROR');
    // Ensure the inputted password is not echoed anywhere in the response body
    expect(JSON.stringify(res.body)).not.toContain('short'); 
  });

  it('should enforce PostgreSQL-backed rate limits and send 429 response', async () => {
    // The authentication policy allows 5 requests
    for (let i = 0; i < 5; i++) {
      const res = await request(app).get('/test-rate-limit');
      expect(res.status).toBe(200);
      expect(res.headers['x-ratelimit-remaining']).toBe(String(5 - (i + 1)));
    }

    // 6th request should fail
    const blockedRes = await request(app).get('/test-rate-limit');
    const blockedBody = blockedRes.body as { error?: { code?: string } };
    expect(blockedRes.status).toBe(429);
    expect(blockedBody.error?.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(blockedRes.headers).toHaveProperty('retry-after');
  });

  it('should extract correct IP behind a proxy when trust proxy is set', async () => {
    await request(app)
      .get('/test-rate-limit')
      .set('X-Forwarded-For', '203.0.113.195'); 

    // Expect the limit to be recorded against the forwarded IP
    const records = await db.select().from(rateLimits);
    expect(records[0].key).toContain('203.0.113.195');
  });
});