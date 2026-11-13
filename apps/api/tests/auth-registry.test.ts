import { describe, it, expect } from 'vitest';
import express, { Router } from 'express';
import { registry } from '../src/lib/route-registry.js';
import { PERMISSIONS } from '../src/lib/permissions.js';
import { generateAuthorisationMatrix } from './helpers/auth-matrix.js';
import { checkOwnershipOrNotFound } from '../src/middleware/auth.middleware.js';

describe('Authorisation Framework & Route Registry', () => {
  const app = express();
  const router = Router();
  
  // Register sample routes using the Registry
  registry.register(router, {
    method: 'get',
    path: '/public',
    access: 'public',
    handlers: [(req, res) => { res.status(200).json({ ok: true }); }]
  });

  registry.register(router, {
    method: 'post',
    path: '/protected/customer',
    access: 'authenticated',
    handlers: [(req, res) => { res.status(201).json({ ok: true }); }]
  });

  registry.register(router, {
    method: 'delete',
    path: '/protected/admin/events',
    access: { permission: PERMISSIONS.EVENTS_APPROVE },
    handlers: [(req, res) => { res.status(200).json({ ok: true }); }]
  });

  app.use('/api', router);

  describe('Deny-By-Default Registry Enforcement', () => {
    it('should successfully verify when all routes are registered', () => {
      expect(() => registry.verifyNoUnregisteredRoutes(app)).not.toThrow();
    });

    it('should fail startup if an unregistered route is mounted directly to Express', () => {
      const rogueApp = express();
      rogueApp.get('/backdoor', (req, res) => res.send('hacked'));
      
      expect(() => registry.verifyNoUnregisteredRoutes(rogueApp))
        .toThrow(/SECURITY FATAL: Unregistered routes detected/);
    });
  });

  describe('Authorisation Matrix Tests', () => {
    describe('GET /api/public', () => {
      generateAuthorisationMatrix(app, 'get', '/api/public', {
        'anonymous user': { expectedStatus: 200 },
        'authenticated customer': { role: 'customer', expectedStatus: 200 }
      });
    });

    describe('POST /api/protected/customer', () => {
      generateAuthorisationMatrix(app, 'post', '/api/protected/customer', {
        'anonymous user': { expectedStatus: 401 },
        'authenticated customer': { role: 'customer', expectedStatus: 201 },
        'authenticated admin': { role: 'admin', expectedStatus: 201 }
      });
    });

    describe('DELETE /api/protected/admin/events', () => {
      generateAuthorisationMatrix(app, 'delete', '/api/protected/admin/events', {
        'anonymous user': { expectedStatus: 401 },
        'authenticated customer': { role: 'customer', expectedStatus: 403 },
        'admin without specific permission': { role: 'admin', expectedStatus: 403 },
        'admin with permission': { 
          role: 'admin', 
          permissions: [PERMISSIONS.EVENTS_APPROVE], 
          expectedStatus: 200 
        }
      });
    });
  });

  describe('Ownership vs 404 Convention', () => {
    it('should throw a 404 error when user IDs do not match (IDOR protection)', () => {
      try {
        checkOwnershipOrNotFound('owner-abc', 'attacker-xyz');
        expect.fail('Should have thrown an error');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(Error);
        expect(err).toHaveProperty('status', 404);
        expect(err).toHaveProperty('code', 'NOT_FOUND');
      }
    });

    it('should pass silently when ownership matches', () => {
      expect(() => checkOwnershipOrNotFound('owner-abc', 'owner-abc')).not.toThrow();
    });
  });
});