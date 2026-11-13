import type { Request, Response, NextFunction } from 'express';
import type { Permission, Role } from '../lib/permissions.js';

// Extend Express Request to include our user object
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: {
        id: string;
        role: Role;
        permissions: Permission[];
      };
    }
  }
}

interface HttpError extends Error {
  status?: number;
  code?: string;
}

export const requireAuth = (req: Request, res: Response, next: NextFunction): void => {
  // STUB IDENTITY FOR PHASE 2: Replaced with real session verification in Phase 3
  const stubUserId = req.header('X-Stub-User-Id');
  const stubRole = req.header('X-Stub-Role') as Role | undefined;
  const stubPermissions = req.header('X-Stub-Permissions');

  if (!stubUserId || !stubRole) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
    return;
  }

  req.user = {
    id: stubUserId,
    role: stubRole,
    permissions: stubPermissions ? (stubPermissions.split(',') as Permission[]) : [],
  };

  next();
};

export const requirePermission = (permission: Permission) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user || !req.user.permissions.includes(permission)) {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } });
      return;
    }
    next();
  };
};

/**
 * CONVENTION: 404 vs 403
 * If a user attempts to access a resource they do not own, we return 404 Not Found 
 * instead of 403 Forbidden. This prevents IDOR (Insecure Direct Object Reference) 
 * enumeration scanning, preventing attackers from confirming if an ID exists.
 * 403 is strictly reserved for authenticated users attempting actions they lack role permissions for.
 */
export const checkOwnershipOrNotFound = (resourceOwnerId: string, currentUserId: string): void => {
  if (resourceOwnerId !== currentUserId) {
    // Thrown as an Error to be caught by the global error handler as a 404
    const error: HttpError = Object.assign(new Error('Resource not found'), {
      status: 404,
      code: 'NOT_FOUND',
    });
    throw error;
  }
};