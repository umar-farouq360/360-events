import postgres from 'postgres';
import { databaseUrl } from '../src/config/database-url.js';

/**
 * Opens N independent PostgreSQL connections for real concurrency tests.
 * Each client is restricted to one physical connection so transactions cannot
 * be multiplexed through a shared pool.
 */
export const openConcurrencyConnections = (count: number): postgres.Sql[] => {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error('Connection count must be a positive integer.');
  }

  return Array.from({ length: count }, () =>
    postgres(databaseUrl, { max: 1, connect_timeout: 5 }),
  );
};

/** Closes all concurrency-test connections, including after failed assertions. */
export const closeConcurrencyConnections = async (
  connections: postgres.Sql[],
): Promise<void> => {
  await Promise.all(connections.map((connection) => connection.end({ timeout: 5 })));
};
