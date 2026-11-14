-- Run with psql after provisioning roles, applying migrations, and applying
-- grant-application-privileges.sql. Exits non-zero on any failed invariant.

\set ON_ERROR_STOP on

DO $$
DECLARE
  app_role record;
  migration_role record;
  non_migrator_owned_tables integer;
BEGIN
  SELECT rolsuper, rolcreatedb, rolcreaterole, rolbypassrls
    INTO app_role
    FROM pg_roles
   WHERE rolname = 'app_service';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Required role app_service does not exist';
  END IF;

  IF app_role.rolsuper OR app_role.rolcreatedb OR app_role.rolcreaterole OR app_role.rolbypassrls THEN
    RAISE EXCEPTION 'app_service has a prohibited role attribute';
  END IF;

  SELECT rolsuper, rolcreatedb, rolcreaterole, rolbypassrls
    INTO migration_role
    FROM pg_roles
   WHERE rolname = 'migrator';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Required role migrator does not exist';
  END IF;

  IF migration_role.rolsuper OR migration_role.rolcreatedb OR migration_role.rolcreaterole OR migration_role.rolbypassrls THEN
    RAISE EXCEPTION 'migrator has a prohibited role attribute';
  END IF;

  IF has_schema_privilege('app_service', 'public', 'CREATE') THEN
    RAISE EXCEPTION 'app_service must not have CREATE on public';
  END IF;

  IF has_database_privilege('app_service', current_database(), 'CREATE')
     OR has_database_privilege('app_service', current_database(), 'TEMPORARY') THEN
    RAISE EXCEPTION 'app_service must not create database objects or temporary tables';
  END IF;

  IF has_database_privilege('migrator', current_database(), 'CREATE')
     OR has_database_privilege('migrator', current_database(), 'TEMPORARY') THEN
    RAISE EXCEPTION 'migrator must not create databases/schemas or temporary tables';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_auth_members
     WHERE member = (SELECT oid FROM pg_roles WHERE rolname = 'app_service')
  ) THEN
    RAISE EXCEPTION 'app_service must not inherit or SET ROLE into another role';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_auth_members
     WHERE member = (SELECT oid FROM pg_roles WHERE rolname = 'migrator')
  ) THEN
    RAISE EXCEPTION 'migrator must not inherit or SET ROLE into another role';
  END IF;

  IF NOT has_schema_privilege('migrator', 'public', 'CREATE') THEN
    RAISE EXCEPTION 'migrator is missing CREATE on public';
  END IF;

  IF has_table_privilege('app_service', 'public.audit_events', 'UPDATE')
     OR has_table_privilege('app_service', 'public.audit_events', 'DELETE')
     OR has_table_privilege('app_service', 'public.audit_events', 'TRUNCATE')
     OR has_table_privilege('app_service', 'public.audit_events', 'REFERENCES')
     OR has_table_privilege('app_service', 'public.audit_events', 'TRIGGER') THEN
    RAISE EXCEPTION 'app_service has a prohibited audit_events privilege';
  END IF;

  IF NOT has_table_privilege('app_service', 'public.audit_events', 'SELECT')
     OR NOT has_table_privilege('app_service', 'public.audit_events', 'INSERT') THEN
    RAISE EXCEPTION 'app_service is missing required audit_events SELECT/INSERT';
  END IF;

  IF has_table_privilege('app_service', 'public.db_migrations_history', 'SELECT')
     OR has_table_privilege('app_service', 'public.db_migrations_history', 'INSERT')
     OR has_table_privilege('app_service', 'public.db_migrations_history', 'UPDATE')
     OR has_table_privilege('app_service', 'public.db_migrations_history', 'DELETE') THEN
    RAISE EXCEPTION 'app_service must not access db_migrations_history';
  END IF;

  IF to_regclass('drizzle.__drizzle_migrations') IS NOT NULL
     AND has_table_privilege('app_service', 'drizzle.__drizzle_migrations', 'SELECT') THEN
    RAISE EXCEPTION 'app_service must not read the Drizzle migration journal';
  END IF;

  SELECT count(*)::integer
    INTO non_migrator_owned_tables
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relkind IN ('r', 'p')
     AND c.relowner <> (SELECT oid FROM pg_roles WHERE rolname = 'migrator');

  IF non_migrator_owned_tables <> 0 THEN
    RAISE EXCEPTION
      'Expected all public tables to be owned by migrator; found % table(s) with another owner',
      non_migrator_owned_tables;
  END IF;
END
$$;

SELECT
  'app_service' AS role_name,
  has_schema_privilege('app_service', 'public', 'USAGE') AS public_schema_usage,
  has_schema_privilege('app_service', 'public', 'CREATE') AS public_schema_create,
  has_table_privilege('app_service', 'public.audit_events', 'SELECT') AS audit_select,
  has_table_privilege('app_service', 'public.audit_events', 'INSERT') AS audit_insert,
  has_table_privilege('app_service', 'public.audit_events', 'UPDATE') AS audit_update,
  has_table_privilege('app_service', 'public.audit_events', 'DELETE') AS audit_delete;
