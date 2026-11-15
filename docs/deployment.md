# Deployment Guide (P1-T07)

**Status: deployment pipeline not yet operational.** The current `.github/workflows/deploy-staging.yml` still contains mocked image-push, deployment-trigger, and readiness steps. A real staging release cannot be claimed until a hosting provider, registry, deployment mechanism, and staging secrets are configured.

## Required release order

1. Build the API, worker, and web artifacts/images.
2. Run Drizzle migrations as the dedicated `migrator` role.
3. Apply the application grants after migrations.
4. Deploy the API and worker with the `app_service` database role; deploy the web application.
5. Poll the real API readiness endpoint and abort if it does not become healthy within the agreed timeout.
6. Record the deployed image digests, migration result, readiness result, and rollback target.

Do not run migrations using the API or worker runtime credentials.

## Database role setup

Follow [database-roles.md](./database-roles.md). The staging database must be provisioned before its first migration. Keep these values separate in the hosting secret store:

- Database administrator URL: one-time role provisioning only.
- Migrator URL: migration step only.
- Application URL: API and worker runtime only.

No database URL or password belongs in the repository, Docker build arguments, image layers, or committed workflow files.

## Container entry points

The API TypeScript project has `rootDir: ./src` and `outDir: ./dist`; `src/index.ts` therefore emits `dist/index.js`. The API container must start that file. The worker container starts `apps/worker/dist/index.js`.

Both Dockerfiles use multi-stage builds, pinned Node 22 and pnpm 9.12.1, and a non-root runtime user.

## Expand/contract rule

Migrations run before the new application version is deployed. Therefore:

- New application code must tolerate the old schema during rollout.
- Old application code must tolerate the expanded schema until all old instances have stopped.
- Destructive contraction changes belong in a later release, after old application instances are gone.

## Rollback

If readiness fails or the release introduces a critical defect:

1. Stop promotion and retain the failing release's logs and image digest.
2. Roll back API, worker, and web to the previous known-good image versions.
3. Do not run ad-hoc down-migrations during an incident. The migration must be backward-compatible under the expand/contract rule.
4. Verify readiness and the core health checks on the previous release.
5. Fix forward in a new release after the cause is understood.

## Remaining staging prerequisites

The following are intentionally unresolved until the hosting target is selected:

- Hosting provider and service definitions for API, worker, and web.
- Container registry and immutable image-tag/digest strategy.
- Deployment trigger (provider CLI, API, or webhook) and readiness URL.
- Managed PostgreSQL backup configuration and restore evidence.
- Provider test-mode keys and secret-store bindings.
- A deliberately broken deployment and successful rollback rehearsal.
- Image and secret scanning in CI.

The workflow must remain marked incomplete until these steps are implemented and rehearsed. Do not replace them with successful-looking `echo` statements.
