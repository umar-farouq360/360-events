import 'dotenv/config';

/**
 * Shared database URL for the application, tests, and Drizzle CLI.
 * Test processes set TEST_DATABASE_URL before importing this module so test
 * traffic can never fall back to the development database.
 */
export const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgres://postgres:postgres@localhost:5435/360events_dev';
