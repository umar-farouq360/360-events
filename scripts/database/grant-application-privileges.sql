-- Run after Drizzle migrations, connected as migrator (the owner of the
-- migrated objects) or a database administrator.
--
-- The default privileges established by provision-roles.sql cover future
-- tables/sequences created by migrator. This script applies the current-table
-- grants and the audit/migration-table exceptions.

GRANT USAGE ON SCHEMA public TO app_service;

REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM app_service;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON ALL TABLES IN SCHEMA public TO app_service;

REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM app_service;
GRANT USAGE, SELECT
  ON ALL SEQUENCES IN SCHEMA public TO app_service;

-- Audit rows are append-only for the runtime role.
REVOKE ALL PRIVILEGES ON TABLE public.audit_events FROM app_service;
GRANT SELECT, INSERT ON TABLE public.audit_events TO app_service;

-- Neither application code nor workers may alter migration bookkeeping.
REVOKE ALL PRIVILEGES ON TABLE public.db_migrations_history FROM app_service;

-- Drizzle's own migration journal is not in the public schema.
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA drizzle FROM app_service;
REVOKE ALL PRIVILEGES ON SCHEMA drizzle FROM app_service;
