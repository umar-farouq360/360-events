import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { db } from '../src/db/index.js';
import { idempotencyKeys } from '../src/db/schema/idempotency.schema.js';
import { withIdempotency } from '../src/middleware/idempotency.middleware.js';
import { eq } from 'drizzle-orm';

interface ReservationBody {
  triggerError?: boolean;
  amount?: number;
}

interface ReservationResponse {
  id?: string;
  amount?: number;
  status?: string;
}

interface IdempotencyErrorResponse {
  code?: string;
}

describe('Idempotency Middleware', () => {
  const app = express();
  app.use(express.json());

  app.post('/api/reservations', withIdempotency('reservations'), (req, res) => {
    const body = req.body as ReservationBody;
    if (body.triggerError) {
      res.status(500).json({ error: 'Internal Server Error' });
      return;
    }
    // Simulate slight delay to test race conditions
    setTimeout(() => {
      res.status(201).json({ id: 'res_123', amount: body.amount, status: 'confirmed' });
    }, 50);
  });

  beforeEach(async () => {
    await db.delete(idempotencyKeys).execute(); // Reset DB state
  });

  it('should process a fresh request and cache the response', async () => {
    const res = await request(app)
      .post('/api/reservations')
      .set('Idempotency-Key', 'test-key-1')
      .send({ amount: 5000 });

    expect(res.status).toBe(201);
    expect((res.body as ReservationResponse).status).toBe('confirmed');

    // Wait for DB async update to finish in background
    await new Promise(resolve => setTimeout(resolve, 50));
    
    const dbRecord = await db.select().from(idempotencyKeys).where(eq(idempotencyKeys.key, 'test-key-1'));
    expect(dbRecord[0]?.status).toBe('completed');
  });

  it('should return cached response for exactly repeated request', async () => {
    await request(app).post('/api/reservations').set('Idempotency-Key', 'test-key-2').send({ amount: 100 });
    
    await new Promise(resolve => setTimeout(resolve, 50)); // Ensure background DB update

    const replayRes = await request(app)
      .post('/api/reservations')
      .set('Idempotency-Key', 'test-key-2')
      .send({ amount: 100 });

    expect(replayRes.status).toBe(201);
    expect((replayRes.body as ReservationResponse).status).toBe('confirmed');
  });

  it('should return 422 if Idempotency-Key is reused with different payload', async () => {
    await request(app).post('/api/reservations').set('Idempotency-Key', 'test-key-3').send({ amount: 100 });
    await new Promise(resolve => setTimeout(resolve, 50));

    const rejectedRes = await request(app)
      .post('/api/reservations')
      .set('Idempotency-Key', 'test-key-3')
      .send({ amount: 200 }); // Different amount

    expect(rejectedRes.status).toBe(422);
    expect((rejectedRes.body as IdempotencyErrorResponse).code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('should return 409 Conflict for concurrent requests', async () => {
    const req1 = request(app).post('/api/reservations').set('Idempotency-Key', 'test-key-4').send({ amount: 300 });
    const req2 = request(app).post('/api/reservations').set('Idempotency-Key', 'test-key-4').send({ amount: 300 });

    const [res1, res2] = await Promise.all([req1, req2]);
    
    const statuses = [res1.status, res2.status];
    expect(statuses).toContain(201);
    expect(statuses).toContain(409); // One must be blocked as in_progress
  });

  it('should clean up the idempotency key on 500 server error', async () => {
    await request(app)
      .post('/api/reservations')
      .set('Idempotency-Key', 'test-key-5')
      .send({ triggerError: true });

    await new Promise(resolve => setTimeout(resolve, 50));

    const dbRecord = await db.select().from(idempotencyKeys).where(eq(idempotencyKeys.key, 'test-key-5'));
    expect(dbRecord.length).toBe(0); // Should be deleted allowing future retries
  });
});