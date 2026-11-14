import type { Request, Response } from 'express';
import { queryClient } from '../db/index.js';
import { logger } from '../lib/logger.js';
import type { RouteDefinition } from '../lib/route-registry.js';

const live = (_req: Request, res: Response): void => {
  res.status(200).json({ status: 'ok' });
};

const ready = async (_req: Request, res: Response): Promise<void> => {
  try {
    await queryClient`SELECT 1`;
    res.status(200).json({ status: 'ready' });
  } catch (error) {
    logger.error({ err: error }, 'Readiness check failed');
    res.status(503).json({ status: 'unavailable' });
  }
};

export const healthRoutes: RouteDefinition[] = [
  { method: 'get', path: '/health/live',  access: 'public', handlers: [live]  },
  { method: 'get', path: '/health/ready', access: 'public', handlers: [ready] },
];