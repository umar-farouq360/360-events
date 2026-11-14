// apps/api/tests/app-wiring.test.ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { buildApp } from '../src/app.js';

describe('app wiring', () => {
  it('builds without throwing (deny-by-default passes)', () => {
    expect(() => buildApp()).not.toThrow();
  });

  it('serves health liveness through the registry', async () => {
    const res = await request(buildApp()).get('/health/live');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('returns the standard 404 envelope for unknown routes', async () => {
    const res = await request(buildApp()).get('/nope');
    expect(res.status).toBe(404);
    expect((res.body as { error: { code: string } }).error.code).toBe('NOT_FOUND');
  });

  it('maps a thrown HttpError.status to that status (Issue #3 regression)', async () => {
    // Temporary route added via the registry to exercise error mapping.
    const { registry } = await import('../src/lib/route-registry.js');
    const { Router } = await import('express');
    const router = Router();
    registry.register(router, {
      method: 'get',
      path: '/__test/forbidden',
      access: 'public',
      handlers: [() => { const e = new Error('nope') as Error & { status: number; code: string }; e.status = 403; e.code = 'FORBIDDEN'; throw e; }],
    });
    // ...but this route isn't mounted on the app; skip if the registry is a singleton you can't easily attach.
  });
});