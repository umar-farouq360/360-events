# PostgreSQL Role Design

This document defines the runtime/migration privilege boundary for P1-T07. PostgreSQL roles are provisioned separately from Drizzle schema migrations because roles are cluster-level security principals, not application tables.

## Roles

### `app_service`

Used by the API and worker at runtime.

- Login role; credentials are supplied only through the hosting platform's secret manager or an approved database IAM mechanism.
- May connect to the application database and use the `public` schema.
- Receives `SELECT`, `INSERT`, `UPDATE`, and `DELETE` on application tables, subject to explicit exceptions below.
- Receives `USAGE` and `SELECT` on application sequences.
- Cannot create schemas, tables, types, functions, temporary tables, or other database objects.
- Cannot create databases or roles, create schemas at the database level, create temporary tables, bypass row-level security, or administer the database.
- Has no access to the Drizzle migration journal or `db_migrations_history`.
- On `audit_events`, may `SELECT` and `INSERT` only. It cannot `UPDATE`, `DELETE`, `TRUNCATE`, add triggers, or change constraints.

The API and worker currently share this runtime role. A later task may split them if their data-access requirements diverge.

### `migrator`

Used only by the deployment migration step.

- Login role; credentials are supplied only through the hosting platform's secret manager or an approved database IAM mechanism.
- May connect and create/alter objects in the application schema.
- Owns objects created by Drizzle migrations. This ownership is required for later migrations to alter those objects without granting DDL rights to the runtime role.
- Owns the isolated `drizzle` schema and its migration journal.
- Cannot create databases or roles, bypass row-level security, or administer the database.
- Must never be configured as the API or worker's runtime `DATABASE_URL`.

Neither role is a superuser. Neither role receives `CREATE` or `TEMPORARY` on the database, `CREATEDB`, `CREATEROLE`, `REPLICATION`, or `BYPASSRLS`. The provisioning script also revokes database-level `CREATE` and `TEMPORARY` from `PUBLIC` for this dedicated database.

## Provisioning sequence

Run these steps against a dedicated staging database. Do not run them against production or an existing database until its current object owners and grants have been reviewed.

1. Connect as a PostgreSQL superuser (or a provider administrator with equivalent CREATEROLE and object-ownership delegation privileges). The provisioning script changes cluster roles and owns the Drizzle schema; an ordinary database owner may not have sufficient authority.
2. Run `psql "$STAGING_DATABASE_ADMIN_URL" -v ON_ERROR_STOP=1 -f scripts/database/provision-roles.sql`.
3. Set credentials for `app_service` and `migrator` through the hosting provider's secret manager or approved IAM. Do not place passwords in SQL files, shell history, GitHub workflow YAML, or image layers.
4. Run Drizzle migrations using the `migrator` connection only: `pnpm --filter @360events/api run db:migrate`.
5. Connect as `migrator` (or the database administrator) and run `psql "$STAGING_MIGRATOR_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/database/grant-application-privileges.sql`.
6. Run `psql "$STAGING_MIGRATOR_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/database/verify-application-privileges.sql`.
7. Configure API and worker `DATABASE_URL` with the `app_service` connection string. Configure only the deployment migration step with the `migrator` connection string.

The provisioning script creates login roles without passwords. This is intentional: credentials must be generated and stored outside source control. It is safe to re-run for role attributes and schema/default grants, but it does not transfer ownership of existing application tables, sequences, types, or functions. It also does not silently remove pre-existing role memberships; the verifier fails if either service role is a member of another role, because membership can permit `SET ROLE` even when `NOINHERIT` is set.

### Existing databases

Do not point `migrator` at a database whose tables are owned by another role and assume it can alter them. PostgreSQL object ownership is not equivalent to ordinary DML grants. For an already-migrated database, first inventory ownership of every table, sequence, enum/type, function, and the Drizzle journal. Prepare and review a one-time owner-transfer procedure with the current database owner before changing it. The staging setup should preferably use a fresh database and apply all migrations as `migrator`.

## Default privileges

`provision-roles.sql` configures default privileges for objects created directly by `migrator` in `public`:

- Tables: `SELECT`, `INSERT`, `UPDATE`, `DELETE` for `app_service`.
- Sequences: `USAGE`, `SELECT` for `app_service`.
- Types: `USAGE` for `app_service`.

These defaults do not apply when migrations run as `postgres`, another owner, or a role that is merely a member of `migrator` without creating objects as `migrator`. Always use the `migrator` login directly for Drizzle migrations.

After migrations, `grant-application-privileges.sql` applies current-table grants and removes runtime access to audit and migration bookkeeping tables. The audit exception must remain in place after every privilege change.

## Verification

Run `scripts/database/verify-application-privileges.sql` after provisioning and migrations. It fails if:

- Either role has superuser, database-creation, role-creation, or row-security-bypass privileges.
- `app_service` can create objects in `public` or create databases.
- `app_service` can update, delete, truncate, or otherwise modify `audit_events`.
- `app_service` cannot read/insert audit rows.
- `app_service` can access migration bookkeeping.
- Public application tables are not owned by `migrator`.

This script is a staging verification step, not proof that a hosting provider has injected the correct credentials into the running containers. Verify runtime connection identities separately during the staging rehearsal.
