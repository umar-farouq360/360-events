import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import pino from 'pino';
import { z } from 'zod';
import dotenv from 'dotenv';
import { db } from '@360events/api/db';
import { WorkerRunner } from './lib/runner.js';
import { RecurringScheduler } from './lib/scheduler.js';
import { getOutboxMetrics } from './lib/metrics.js';
import { createEmailProvider } from './lib/email-factory.js';
import { processNotificationJob } from './handlers/notification-handler.js';
import { processIdempotencyCleanupJob } from './handlers/idempotency-cleanup-handler.js';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  WORKER_PORT: z.coerce.number().default(3001),
  EMAIL_SMTP_URL: z.string().optional(),
  EMAIL_ALLOWED_DOMAINS: z.string().optional(),
  EMAIL_SENDER: z.string().optional(),
});

const env = envSchema.parse(process.env);
const logger = pino({ level: env.NODE_ENV === 'test' ? 'silent' : 'info' });

const runner = new WorkerRunner({ database: db, logger });
const scheduler = new RecurringScheduler({ database: db, logger });

const emailProvider = createEmailProvider({
  NODE_ENV: env.NODE_ENV,
  EMAIL_SMTP_URL: env.EMAIL_SMTP_URL,
  EMAIL_ALLOWED_DOMAINS: env.EMAIL_ALLOWED_DOMAINS,
  EMAIL_SENDER: env.EMAIL_SENDER,
});

// --- Register job handlers (P2-T06: end-to-end worker path) ---
runner.register(
  'notification.send',
  z.object({ notificationId: z.string().min(1) }),
  async (payload) => {
    await processNotificationJob(payload.notificationId, emailProvider);
  },
);

runner.register('cleanup-idempotency-keys', z.object({}).passthrough(), processIdempotencyCleanupJob);

// --- Recurring definitions (P2-T04: single-flight scheduler) ---
scheduler.register({
  name: 'cleanup-idempotency-keys',
  everyMs: 5 * 60_000,
  jobType: 'cleanup-idempotency-keys',
});

const getStatus = async () => ({
  status: 'alive',
  processing: true,
  runner: { registeredHandlers: ['notification.send', 'cleanup-idempotency-keys'] },
  scheduler: scheduler.getStatus(),
  metrics: await getOutboxMetrics(),
});

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'alive' }));
    return;
  }
  if (req.url === '/status') {
    getStatus()
      .then((s) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(s));
      })
      .catch((err: unknown) => {
        logger.error({ err }, 'Status endpoint failed');
        res.writeHead(500);
        res.end();
      });
    return;
  }
  res.writeHead(404);
  res.end();
});

server.listen(env.WORKER_PORT, () => {
  logger.info(`Worker status server listening on port ${env.WORKER_PORT}`);
});

if (env.NODE_ENV !== 'test') {
  runner.start().catch((err: unknown) => {
    logger.fatal({ err }, 'Worker loop crashed completely');
    process.exit(1);
  });
  scheduler.start().catch((err: unknown) => {
    logger.fatal({ err }, 'Scheduler loop crashed completely');
    process.exit(1);
  });
}

let isShuttingDown = false;

const gracefulShutdown = (signal: string): void => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger.info({ signal }, 'Worker received shutdown signal, draining jobs...');

  const shutdownTimeout = setTimeout(() => {
    logger.fatal('Worker forced to shut down after timeout');
    process.exit(1);
  }, 10000);
  shutdownTimeout.unref();

  const finishShutdown = async (): Promise<void> => {
    await scheduler.stop();   // stop enqueueing new recurring jobs first
    await runner.stop();      // then drain in-flight handlers
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    clearTimeout(shutdownTimeout);
    logger.info('Worker shut down cleanly');
    process.exit(0);
  };

  finishShutdown().catch((err: unknown) => {
    logger.error({ err }, 'Error during worker shutdown');
    process.exit(1);
  });
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));