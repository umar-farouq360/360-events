import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '@360events/api/schema';
import type { Logger } from 'pino';
import { sql } from 'drizzle-orm';
import { enqueue } from '@360events/api/jobs';

export interface RecurringDefinition {
  /** Unique name; used as the dedupe-key namespace. */
  name: string;
  /** How often this job should fire. Also the dedupe bucket width. */
  everyMs: number;
  /** Outbox job type the worker will handle. */
  jobType: string;
  /** Payload builder (usually returns `{}` for maintenance jobs). */
  buildPayload?: (now: Date) => Record<string, unknown>;
}

export interface RecurringStatus {
  running: boolean;
  lastTickAt: Date | null;
  definitions: Array<{
    name: string;
    everyMs: number;
    lastEnqueuedBucket: number | null;
  }>;
}

export interface RecurringSchedulerOptions {
  database: PostgresJsDatabase<typeof schema>;
  logger: Logger;
}

/**
 * Recurring single-flight scheduler.
 *
 * On each tick, for every definition whose time-bucket has advanced, enqueue
 * one outbox job with a dedupe key of `recurring:<name>:<bucket>`. Because the
 * outbox's `dedupe_key` is UNIQUE and `enqueue()` uses `onConflictDoNothing`,
 * N scheduler instances racing on the same bucket produce exactly ONE job.
 * That is the single-flight guarantee the audit's P2-T04 requires.
 */
export class RecurringScheduler {
  private readonly definitions = new Map<string, RecurringDefinition>();
  private readonly lastEnqueuedBucket = new Map<string, number>();
  private readonly options: RecurringSchedulerOptions;
  private loopPromise: Promise<void> | undefined;
  private wakeTick: (() => void) | undefined;
  private isRunning = false;
  private lastTickAt: Date | null = null;

  constructor(options: RecurringSchedulerOptions) {
    this.options = options;
  }

  public register(def: RecurringDefinition): void {
    if (this.definitions.has(def.name)) {
      throw new Error(`Recurring definition '${def.name}' is already registered`);
    }
    if (def.everyMs < 1) {
      throw new Error(`Recurring definition '${def.name}' must have everyMs >= 1`);
    }
    this.definitions.set(def.name, def);
  }

  /** Runs one scheduling pass; returns the number of jobs actually enqueued. */
  public async tickOnce(now: Date = new Date()): Promise<number> {
    this.lastTickAt = now;
    let enqueued = 0;

    for (const def of this.definitions.values()) {
      const bucket = Math.floor(now.getTime() / def.everyMs);
      if (this.lastEnqueuedBucket.get(def.name) === bucket) continue;

      const dedupeKey = `recurring:${def.name}:${bucket}`;
      const payload = def.buildPayload ? def.buildPayload(now) : {};

      const result = await this.options.database.transaction(async (tx) => {
        const before = await tx.execute<{ id: string }>(sql`
          SELECT id FROM outbox_events WHERE dedupe_key = ${dedupeKey} LIMIT 1
        `);
        if (before.length > 0) return false;
        await enqueue(tx, def.jobType, payload, { dedupeKey, maxAttempts: 1 });
        return true;
      });

      if (result) {
        this.lastEnqueuedBucket.set(def.name, bucket);
        enqueued += 1;
        this.options.logger.info(
          { definition: def.name, bucket, dedupeKey },
          'Enqueued recurring job',
        );
      }
    }

    return enqueued;
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const finish = (): void => {
        clearTimeout(timer);
        if (this.wakeTick === finish) this.wakeTick = undefined;
        resolve();
      };
      const timer = setTimeout(finish, ms);
      this.wakeTick = finish;
    });
  }

  private async runLoop(intervalMs: number): Promise<void> {
    this.options.logger.info({ intervalMs }, 'Recurring scheduler started');
    while (this.isRunning) {
      try {
        await this.tickOnce();
      } catch (err) {
        this.options.logger.error({ err }, 'Recurring scheduler tick failed');
      }
      if (this.isRunning) await this.wait(intervalMs);
    }
  }

  public start(intervalMs = 60_000): Promise<void> {
    if (this.loopPromise) throw new Error('Recurring scheduler is already started');
    if (intervalMs < 1) throw new Error('intervalMs must be positive');
    this.isRunning = true;
    this.loopPromise = this.runLoop(intervalMs).finally(() => {
      this.isRunning = false;
      this.loopPromise = undefined;
    });
    return this.loopPromise;
  }

  public async stop(): Promise<void> {
    this.isRunning = false;
    this.wakeTick?.();
    await this.loopPromise;
  }

  public getStatus(): RecurringStatus {
    return {
      running: this.isRunning,
      lastTickAt: this.lastTickAt,
      definitions: [...this.definitions.values()].map((def) => ({
        name: def.name,
        everyMs: def.everyMs,
        lastEnqueuedBucket: this.lastEnqueuedBucket.get(def.name) ?? null,
      })),
    };
  }
}