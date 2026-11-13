import { it, expect } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { Role, Permission } from '../../src/lib/permissions.js';

export interface AuthMatrixScenario {
  role?: Role;
  permissions?: Permission[];
  expectedStatus: number;
}

/**
 * Generates test blocks for a specific route against a matrix of roles and permissions.
 */
export function generateAuthorisationMatrix(
  app: Express,
  method: 'get' | 'post' | 'put' | 'patch' | 'delete',
  path: string,
  scenarios: Record<string, AuthMatrixScenario>
) {
  for (const [description, scenario] of Object.entries(scenarios)) {
    it(`should return ${scenario.expectedStatus} for ${description}`, async () => {
      const req = request(app)[method](path);

      if (scenario.role) {
        req.set('X-Stub-User-Id', 'test-user-123');
        req.set('X-Stub-Role', scenario.role);
        if (scenario.permissions && scenario.permissions.length > 0) {
          req.set('X-Stub-Permissions', scenario.permissions.join(','));
        }
      }

      const res = await req.send({});
      expect(res.status).toBe(scenario.expectedStatus);
    });
  }
}