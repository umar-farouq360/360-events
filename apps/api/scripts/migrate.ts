import postgres from 'postgres';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { databaseUrl } from '../src/config/database-url.js';

const migrationsFolder = './src/db/migrations';
const migrationsSchema = 'drizzle';
const migrationsTable = '__drizzle_migrations';
const migrations = readMigrationFiles({ migrationsFolder });
const client = postgres(databaseUrl, { max: 1 });

try {
  // The schema is provisioned by provision-roles.sql. Drizzle's built-in
  // migrator issues CREATE SCHEMA IF NOT EXISTS first, which still requires
  // database-level CREATE even when the schema already exists.
  await client.unsafe(`
    CREATE TABLE IF NOT EXISTS "${migrationsSchema}"."${migrationsTable}" (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `);

  const [lastMigration] = await client.unsafe<
    { created_at: string | number }[]
  >(
    `SELECT created_at FROM "${migrationsSchema}"."${migrationsTable}" ORDER BY created_at DESC LIMIT 1`,
  );

  await client.begin(async (transaction) => {
    for (const migration of migrations) {
      if (
        !lastMigration ||
        Number(lastMigration.created_at) < migration.folderMillis
      ) {
        for (const statement of migration.sql) {
          await transaction.unsafe(statement);
        }

        await transaction`
          INSERT INTO "drizzle"."__drizzle_migrations" ("hash", "created_at")
          VALUES (${migration.hash}, ${migration.folderMillis})
        `;
      }
    }
  });

  console.info('Database migrations applied successfully.');
} finally {
  await client.end();
}
