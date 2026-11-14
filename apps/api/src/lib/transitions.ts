import { and, eq } from 'drizzle-orm';
import type { 
  PgTable, 
  PgColumn, 
  PgUpdateSetSource, 
  PgTransaction 
} from 'drizzle-orm/pg-core';
import type { ExtractTablesWithRelations } from 'drizzle-orm';
import type { PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js';
import type * as schema from '../db/schema/index.js';

/**
 * Custom error for invalid lifecycle transitions.
 */
export class InvalidTransitionError extends Error {
  public readonly code = 'INVALID_TRANSITION';
  
  constructor(public entity: string, public from: string, public to: string) {
    super(`Cannot transition ${entity} from '${from}' to '${to}'`);
    this.name = 'InvalidTransitionError';
  }
}

/**
 * Typed transition table mapping a state to an array of allowed target states.
 */
export type TransitionTable<T extends string> = Record<T, readonly T[]>;

/**
 * Asserts that a transition from currentState to targetState is permitted by the table.
 * Throws InvalidTransitionError if rejected.
 */
export function assertCanTransition<T extends string>(
  table: TransitionTable<T>,
  currentState: T,
  targetState: T,
  entityName = 'Entity'
): void {
  const allowed = table[currentState];
  if (!allowed || !allowed.includes(targetState)) {
    throw new InvalidTransitionError(entityName, currentState, targetState);
  }
}

/**
 * Strictly types the Drizzle transaction object specifically for the postgres-js driver.
 */
export type Transaction = PgTransaction<
  PostgresJsQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;

/**
 * Safely executes a conditional update (`UPDATE ... WHERE id = ? AND status = ? RETURNING ...`)
 * and optionally writes to an append-only history table in the same transaction.
 * 
 * Returns { success: true, data } if this call won the transition, 
 * or { success: false, data: null } if another caller beat it to the transition.
 */
export async function executeTransition<
  TTable extends PgTable,
  THistoryTable extends PgTable = PgTable
>(
  tx: Transaction,
  config: {
    table: TTable;
    idColumn: PgColumn;
    statusColumn: PgColumn;
    entityId: string | number;
    fromStatus: string;
    updatePayload: PgUpdateSetSource<TTable>;
    historyTable?: THistoryTable;
    buildHistoryRecord?: (entity: TTable['$inferSelect']) => THistoryTable['$inferInsert'];
  }
): Promise<{ success: boolean; data: TTable['$inferSelect'] | null }> {
  const { 
    table, 
    idColumn, 
    statusColumn, 
    entityId, 
    fromStatus, 
    updatePayload, 
    historyTable, 
    buildHistoryRecord 
  } = config;

  const result = await tx
    .update(table)
    .set(updatePayload)
    .where(and(eq(idColumn, entityId), eq(statusColumn, fromStatus)))
    .returning();

  if (result.length === 0) {
    return { success: false, data: null };
  }

  const entity = result[0] as TTable['$inferSelect'];

  if (historyTable && buildHistoryRecord) {
    await tx.insert(historyTable).values(buildHistoryRecord(entity));
  }

  return { success: true, data: entity };
}