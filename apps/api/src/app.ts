import express, { type Express } from 'express';
import { httpLogger } from './lib/logger.js';
import { healthRouter } from './routes/health.js';
import { errorHandler } from './middleware/error.middleware.js';

export const buildApp = (): Express => {
  const app = express();

  app.use(httpLogger);
  app.use(express.json());

  app.use('/health', healthRouter);

  // Catch-all for undefined routes
  app.use((req, res) => {
    res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: 'The requested resource was not found.',
        requestId: req.id,
      },
    });
  });

  app.use(errorHandler);

  return app;
};