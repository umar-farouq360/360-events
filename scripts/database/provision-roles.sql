-- Run once against the target database as its database owner or a PostgreSQL
-- administrator, before applying Drizzle migrations.
--
-- This script creates login roles without passwords. Provision credentials through
-- the hosting provider's secret manager or an approved IAM mechanism; never add
-- passwords to this file, source control, shell history, or image layers.
--
-- Migrations MUST connect as "migrator". This makes migrator the owner of the
-- schema objects it creates and allows later migrations to alter those objects.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_service') THEN
    EXECUTE 'CREATE ROLE app_service LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT';
  ELSE
    EXECUTE 'ALTER ROLE app_service LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migrator') THEN
    EXECUTE 'CREATE ROLE migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT';
  ELSE
    EXECUTE 'ALTER ROLE migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT';
  END IF;
END
$$;

DO $$
DECLARE
  database_name text := current_database();
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO app_service, migrator', database_name);
END
$$;

-- Public is the application schema. Only the migration role may create objects.
REVOKE CREATE ON SCHEMA public FROM PUBLIC, app_service;
GRANT USAGE ON SCHEMA public TO app_service;
GRANT USAGE, CREATE ON SCHEMA public TO migrator;

-- Drizzle's migration journal is isolated from the runtime role.
CREATE SCHEMA IF NOT EXISTS drizzle AUTHORIZATION migrator;
ALTER SCHEMA drizzle OWNER TO migrator;
REVOKE ALL ON SCHEMA drizzle FROM PUBLIC, app_service;
GRANT USAGE, CREATE ON SCHEMA drizzle TO migrator;

-- These defaults apply only to objects created directly by migrator in public.
-- They do not apply when migrations are run as postgres or another role.
ALTER DEFAULT PRIVILEGES FOR ROLE migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_service;
ALTER DEFAULT PRIVILEGES FOR ROLE migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_service;
ALTER DEFAULT PRIVILEGES FOR ROLE migrator IN SCHEMA public
  GRANT USAGE ON TYPES TO app_service;

-- Keep the Drizzle migration journal private even if default privileges change.
ALTER DEFAULT PRIVILEGES FOR ROLE migrator IN SCHEMA drizzle
  REVOKE ALL ON TABLES FROM app_service;
