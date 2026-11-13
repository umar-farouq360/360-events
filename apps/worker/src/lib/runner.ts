import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '@360events/api/schema';
import type { Logger } from 'pino';
import type { ZodType } from 'zod';

export interface JobContext {
  /** Aborted when this runner loses its lease; handlers should stop work when possible. */
  signal: AbortSignal;
}

/** Handlers must be idempotent because an interrupted job can be delivered again. */
export type JobHandler<TPayload = Record<string, unknown>> = (payload: TPayload, context: JobContext) => Promise<void>;

interface RawOutboxRow extends Record<string, unknown> {
  id: string;
  type: string;
  payload: unknown;
  attempts: number;
  max_attempts: number;
  locked_by: string;
  lease_expires_at: Date | string;
}

interface IdRow extends Record<string, unknown> {
  id: string;
}

interface RegisteredHandler {
  run(payload: unknown, context: JobContext): Promise<void>;
}

export interface WorkerRunnerOptions {
  database: PostgresJsDatabase<typeof schema>;
  logger: Logger;
  leaseDurationMs?: number;
  retryDelayMs?: (attempt: number) => number;
}

export class WorkerRunner {
  private readonly handlers = new Map<string, RegisteredHandler>();
  private readonly workerId = randomUUID();
  private readonly leaseDurationMs: number;
  private readonly retryDelayMs: (attempt: number) => number;
  private loopPromise: Promise<void> | undefined;
  private wakePoll: (() => void) | undefined;
  private isRunning = false;

  constructor(private readonly options: WorkerRunnerOptions) {
    this.leaseDurationMs = options.leaseDurationMs ?? 5 * 60 * 1000;
    this.retryDelayMs = options.retryDelayMs ?? ((attempt) => {
      const exponent = Math.max(0, attempt - 1);
      const base = Math.min(5 * 60 * 1000, 10 * 1000 * 2 ** exponent);
      return Math.round(base + Math.random() * base * 0.2);
    });

    if (this.leaseDurationMs < 3) {
      throw new Error('leaseDurationMs must be at least 3 milliseconds');
    }
  }

  public register<TPayload>(
    type: string,
    payloadSchema: ZodType<TPayload>,
    handler: JobHandler<TPayload>,
  ): void {
    if (this.handlers.has(type)) {
      throw new Error(`A handler is already registered for job type '${type}'`);
    }

    this.handlers.set(type, {
      run: async (payload, context) => handler(payloadSchema.parse(payload), context),
    });
  }

  /** Claims one eligible row without waiting for rows locked by other workers. */
  private async claimJob(): Promise<RawOutboxRow | null> {
    const database = this.options.database;

    // A crashed worker consumes the attempt it claimed; never exceed the row's limit.
    await database.execute(sql`
      UPDATE outbox_events
      SET status = 'failed',
          last_error = COALESCE(last_error, 'Worker lease expired after the maximum attempts'),
          locked_by = NULL,
          lease_expires_at = NULL
      WHERE attempts >= max_attempts
        AND (
          status = 'pending'
          OR (status = 'processing' AND lease_expires_at <= NOW())
        )
    `);

    const ownerToken = `${this.workerId}:${randomUUID()}`;
    const result = await database.execute<RawOutboxRow>(sql`
      WITH candidate AS (
        SELECT id
        FROM outbox_events
        WHERE attempts < max_attempts
          AND run_at <= NOW()
          AND (
            status = 'pending'
            OR (status = 'processing' AND lease_expires_at <= NOW())
          )
        ORDER BY run_at, id
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE outbox_events AS job
      SET status = 'processing',
          locked_by = ${ownerToken},
          lease_expires_at = NOW() + (${this.leaseDurationMs} * INTERVAL '1 millisecond'),
          attempts = job.attempts + 1
      FROM candidate
      WHERE job.id = candidate.id
      RETURNING job.id, job.type, job.payload, job.attempts,
        job.max_attempts, job.locked_by, job.lease_expires_at
    `);

    return result[0] ?? null;
  }

  private async renewLease(id: string, ownerToken: string): Promise<boolean> {
    const result = await this.options.database.execute<IdRow>(sql`
      UPDATE outbox_events
      SET lease_expires_at = NOW() + (${this.leaseDurationMs} * INTERVAL '1 millisecond')
      WHERE id = ${id}
        AND status = 'processing'
        AND locked_by = ${ownerToken}
        AND lease_expires_at > NOW()
      RETURNING id
    `);
    return result.length > 0;
  }

  private async markCompleted(id: string, ownerToken: string): Promise<boolean> {
    const result = await this.options.database.execute<IdRow>(sql`
      UPDATE outbox_events
      SET status = 'completed', completed_at = NOW(), last_error = NULL,
          locked_by = NULL, lease_expires_at = NULL
      WHERE id = ${id}
        AND status = 'processing'
        AND locked_by = ${ownerToken}
        AND lease_expires_at > NOW()
      RETURNING id
    `);
    return result.length > 0;
  }

  private async markFailed(job: RawOutboxRow, errorMessage: string): Promise<boolean> {
    const exhausted = job.attempts >= job.max_attempts;
    const retryDelay = this.retryDelayMs(job.attempts);
    const result = await this.options.database.execute<IdRow>(sql`
      UPDATE outbox_events
      SET status = ${exhausted ? 'failed' : 'pending'},
          last_error = ${errorMessage.slice(0, 4000)},
          locked_by = NULL,
          lease_expires_at = NULL,
          run_at = NOW() + (${retryDelay} * INTERVAL '1 millisecond')
      WHERE id = ${job.id}
        AND status = 'processing'
        AND locked_by = ${job.locked_by}
        AND lease_expires_at > NOW()
      RETURNING id
    `);
    return result.length > 0;
  }

  private async runClaimedJob(job: RawOutboxRow): Promise<void> {
    const handler = this.handlers.get(job.type);
    if (!handler) {
      await this.markFailed(job, `No handler registered for job type '${job.type}'`);
      return;
    }

    const controller = new AbortController();
    const renewalIntervalMs = Math.max(1, Math.floor(this.leaseDurationMs / 3));
    let leaseLost = false;
    let renewal: Promise<void> | undefined;

    const heartbeat = setInterval(() => {
      if (renewal) return;

      renewal = this.renewLease(job.id, job.locked_by)
        .then((renewed) => {
          if (!renewed) {
            leaseLost = true;
            controller.abort(new Error('Job lease was lost'));
          }
        })
        .catch((error: unknown) => {
          leaseLost = true;
          controller.abort(error);
          this.options.logger.error({ jobId: job.id, error }, 'Job lease renewal failed');
        })
        .finally(() => {
          renewal = undefined;
        });
    }, renewalIntervalMs);

    let failed = false;
    let failure: unknown;
    try {
      await handler.run(job.payload, { signal: controller.signal });
    } catch (error: unknown) {
      failed = true;
      failure = error;
    } finally {
      clearInterval(heartbeat);
      if (renewal) await renewal;
    }

    if (leaseLost) {
      this.options.logger.warn({ jobId: job.id }, 'Job finished after its lease was lost; leaving it for recovery');
      return;
    }

    if (failed) {
      const message = failure instanceof Error ? failure.message : 'Unknown execution error';
      this.options.logger.error({ jobId: job.id, error: failure }, 'Job execution failed');
      const updated = await this.markFailed(job, message);
      if (!updated) {
        this.options.logger.warn({ jobId: job.id }, 'Job failure was not recorded because this worker no longer owns it');
      }
      return;
    }

    const updated = await this.markCompleted(job.id, job.locked_by);
    if (!updated) {
      this.options.logger.warn({ jobId: job.id }, 'Job completion was not recorded because this worker no longer owns it');
    }
  }

  public async pollOnce(): Promise<boolean> {
    const job = await this.claimJob();
    if (!job) return false;

    await this.runClaimedJob(job);
    return true;
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const finish = (): void => {
        clearTimeout(timer);
        if (this.wakePoll === finish) this.wakePoll = undefined;
        resolve();
      };
      const timer = setTimeout(finish, ms);
      this.wakePoll = finish;
    });
  }

  private async runLoop(pollIntervalMs: number): Promise<void> {
    this.options.logger.info({ workerId: this.workerId }, 'Worker runner started');
    while (this.isRunning) {
      try {
        const processed = await this.pollOnce();
        if (!processed && this.isRunning) await this.wait(pollIntervalMs);
      } catch (error: unknown) {
        this.options.logger.error({ error }, 'Worker polling loop encountered an error');
        if (this.isRunning) await this.wait(5000);
      }
    }
  }

  public start(pollIntervalMs = 2000): Promise<void> {
    if (this.loopPromise) throw new Error('Worker runner is already started');
    if (pollIntervalMs < 1) throw new Error('pollIntervalMs must be positive');

    this.isRunning = true;
    this.loopPromise = this.runLoop(pollIntervalMs).finally(() => {
      this.isRunning = false;
      this.loopPromise = undefined;
    });
    return this.loopPromise;
  }

  /** Stops polling and resolves after any active handler has finished. */
  public async stop(): Promise<void> {
    this.isRunning = false;
    this.wakePoll?.();
    await this.loopPromise;
  }
}
