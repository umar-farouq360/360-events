import express, { type Express } from 'express';
import { httpLogger } from './lib/logger.js';
import { healthRoutes } from './routes/health.js';
import { errorHandler, notFoundHandler } from './middleware/error.middleware.js';
import { configureSecurity } from './middleware/security.middleware.js';
import { registry } from './lib/route-registry.js';
import { env } from './config/env.js';

export const buildApp = (): Express => {
  const app = express();
  registry.reset();                 // ← fresh registry per app instance
  configureSecurity(app, env.ALLOWED_ORIGINS);
  app.use(httpLogger);
  for (const def of healthRoutes) registry.register(app, def);
  registry.verifyNoUnregisteredRoutes(app);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
};