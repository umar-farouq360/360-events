import { and, count, eq, gte, inArray, sql } from 'drizzle-orm';
import { db } from '@360events/api/db';
import { outboxEvents, type OutboxEvent } from '@360events/api/schema';

export interface OutboxMetrics {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  deadLettered: number;
  oldestPendingAgeSeconds: number | null;
}

export async function getOutboxMetrics(now: Date = new Date()): Promise<OutboxMetrics> {
  const grouped = await db
    .select({ status: outboxEvents.status, count: count() })
    .from(outboxEvents)
    .groupBy(outboxEvents.status);

  const byStatus = new Map(grouped.map((g) => [g.status, Number(g.count)]));

  const [deadLetteredRow] = await db
    .select({ count: count() })
    .from(outboxEvents)
    .where(
      and(
        eq(outboxEvents.status, 'failed'),
        gte(outboxEvents.attempts, outboxEvents.maxAttempts),
      ),
    );

  const [oldestRow] = await db
    .select({ oldest: sql<Date | null>`MIN(${outboxEvents.runAt})` })
    .from(outboxEvents)
    .where(eq(outboxEvents.status, 'pending'));

  const oldest = oldestRow?.oldest ?? null;
  const oldestPendingAgeSeconds =
    oldest instanceof Date ? Math.max(0, Math.floor((now.getTime() - oldest.getTime()) / 1000)) : null;

  return {
    pending: byStatus.get('pending') ?? 0,
    processing: byStatus.get('processing') ?? 0,
    completed: byStatus.get('completed') ?? 0,
    failed: byStatus.get('failed') ?? 0,
    deadLettered: Number(deadLetteredRow?.count ?? 0),
    oldestPendingAgeSeconds,
  };
}

export interface InspectJobsOptions {
  status?: OutboxEvent['status'];
  types?: string[];
  limit?: number;
}

export async function inspectJobs(options: InspectJobsOptions = {}): Promise<OutboxEvent[]> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 500);
  const conditions = [];
  if (options.status) conditions.push(eq(outboxEvents.status, options.status));
  if (options.types && options.types.length > 0) conditions.push(inArray(outboxEvents.type, options.types));

  const base = db.select().from(outboxEvents);
  const query = conditions.length > 0 ? base.where(and(...conditions)) : base;
  return query.orderBy(outboxEvents.runAt).limit(limit);
}