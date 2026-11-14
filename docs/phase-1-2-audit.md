# 360Events — Phase 1 & Phase 2 Implementation Audit

| | |
|---|---|
| **Audit date** | 14 November 2026 |
| **Scope** | docs/implementation-plan.md, Phases 1 and 2 |
| **Compared against** | phase-1-2-audit-findings.txt dated 13 November 2026 and current main source |
| **Current verdict** | **NO-GO for Phase 3** |
| **Verification level** | Source inspection only for this update; no commands or tests were executed |

## 1. Executive summary

The repository has moved forward since the 13 November audit. Several previously reported implementation gaps are now addressed in source:

- Migration 0004_brief_spiral is present in the Drizzle journal and adds the Phase 2 notification and rate-limit tables.
- The API now calls configureSecurity, registers health routes through the route registry, and checks for unregistered routes at startup.
- The global error handler now preserves explicit HTTP error statuses and returns the shared API error envelope.
- The worker registers the notification.send handler and starts the notification pipeline.
- Idempotency now has stale in-progress key reclamation, expired-key cleanup, and shared error-envelope responses.
- A recurring scheduler, outbox metrics, and a read-only job inspection function now exist.
- The original lint-specific findings (generated email artifacts, duplicate ESLint glob, and worker test import extensions) appear to have been addressed in the current tree.
- The documentation previously reported missing now exists, although some documents remain draft or incomplete.

These are **source-level findings**, not proof that the system works from a clean database or that the latest test suite passes. The last recorded test results remain the 13 November baseline; this update did not rerun them.

### Verification status

| Check | 13 Nov recorded result | 14 Nov status |
|---|---|---|
| pnpm typecheck | PASS | Not rerun |
| pnpm lint | FAIL — 49 errors | Not rerun; cited source-level lint issues appear fixed |
| pnpm test | FAIL — 7 failed / 41 passed | Not rerun |
| Clean database migration | Not proven | Migration 0004 exists; clean-database execution not proven |
| Docker build/start | Not proven | Not run |
| Staging deployment | Mocked | Still mocked |

Do not treat the old lint/test counts as the current result. A fresh verification run is required.

## 2. Resolved since the previous audit

| Previous finding | Current evidence | Status |
|---|---|---|
| Missing migrations for notifications, notification_attempts, and rate_limits | apps/api/src/db/migrations/0004_brief_spiral.sql is journalled as migration 0004. | **RESOLVED IN SOURCE** |
| Security middleware not wired into API | apps/api/src/app.ts calls configureSecurity(app, env.ALLOWED_ORIGINS). | **RESOLVED IN SOURCE** |
| Health routes bypass route registry | app.ts registers each health route through registry.register. | **RESOLVED IN SOURCE** |
| No deny-by-default startup route check | app.ts calls registry.verifyNoUnregisteredRoutes(app). | **RESOLVED IN SOURCE** |
| Explicit HTTP errors converted to 500 | error.middleware.ts maps explicit status values and returns the shared ApiErrorResponse. | **RESOLVED IN SOURCE** |
| Notification handler not registered | apps/worker/src/index.ts registers notification.send and calls processNotificationJob. | **RESOLVED IN SOURCE** |
| No recurring single-flight scheduler | RecurringScheduler exists and is started by the worker. | **IMPLEMENTED; TEST VERIFICATION REMAINS** |
| No outbox metrics or inspection query | getOutboxMetrics() and inspectJobs() exist. | **RESOLVED IN SOURCE** |
| Idempotency lacked stale-key recovery | Middleware attempts conditional reclamation of stale in_progress keys. | **IMPLEMENTED; CONCURRENCY VERIFICATION REMAINS** |
| Idempotency lacked expired-key cleanup | Cleanup function, worker handler, and recurring schedule exist. | **RESOLVED IN SOURCE** |
| Idempotency errors lacked shared envelope/request ID | Middleware uses ApiErrorResponse and request ID fallback. | **RESOLVED IN SOURCE** |
| Idempotency test only covered two parallel calls | Current test includes a 20-request parallel scenario. | **TEST EXISTS; NOT EXECUTED IN THIS UPDATE** |
| Several required documents absent | state-machines.md, decision-register.md, database-design.md, api-contract.md, and security-and-privacy.md now exist. | **FILES RESOLVED; CONTENT/APPROVAL GAPS REMAIN** |
| Generated email JS/declaration artifacts and duplicate lint glob | Those previously cited findings are no longer present at the audited paths/current ESLint configuration. | **APPEARS RESOLVED; LINT NOT RERUN** |

## 3. Outstanding blocking issues — resolve in this order

The sequence below is dependency- and risk-ordered. Work on one item at a time; do not begin Phase 3 until the release gate in §6 is satisfied.

### 1. P1-T02 — Make database and test verification trustworthy

**Still outstanding**
- apps/api/tests/harness.ts only opens independent connections. It does not create/isolate a test database, apply migrations, or clean data between test runs.
- harness.test.ts proves two connections can run separate SELECT statements; it does not prove row-lock contention or FOR UPDATE SKIP LOCKED behaviour.
- The configured db:drift-check command is drizzle-kit check; the repository has not demonstrated that this detects schema-to-migration drift.
- Migration 0004 has not been proven to apply successfully from an empty database.

**Required next action**
1. Build a repeatable isolated PostgreSQL test setup.
2. Apply all committed migrations to a clean database as part of the test setup.
3. Add a real lock-contention / SKIP LOCKED test using independent connections.
4. Replace or supplement the current drift check with a check that fails when schema changes are not represented by committed migrations.
5. Run the migration and database tests from a clean state.

**Why first:** later security, audit, idempotency, scheduler, and notification tests are not reliable until the database test foundation is reliable.

### 2. P2-T07 — Fix rate limiting and complete its runtime integration

**Still outstanding**
- withRateLimit() calls next() when the database operation fails: the limiter fails open.
- It also calls next() if the upsert unexpectedly returns no row.
- The current API app only mounts health routes; no real business/authentication endpoint currently demonstrates rate-limit enforcement.
- The rate-limit rejection response does not include the standard request ID envelope.

**Required next action**
1. Define the fail-closed behaviour for a rate-limit storage failure (do not silently allow the request).
2. Return a consistent API error envelope with request ID.
3. Test normal limits, exceeded limits, expiry/reset, missing database response, and database failure.
4. Apply the appropriate policy to each rate-sensitive route as those routes are introduced; health checks should not inherit an authentication policy accidentally.

**Why second:** rate limiting is a security control and must not silently disable itself during database failure.

### 3. P2-T03 — Enforce audit metadata allow-lists

**Still outstanding**
- validateMetadata() checks only a shallow, top-level blocklist of five key names.
- It does not enforce a per-action allow-list.
- Nested forbidden keys can pass through.
- Application-role restrictions on audit-table mutation are not implemented; documentation describes the intended policy, but there are no database grants proving it.

**Required next action**
1. Define permitted metadata keys per audit action.
2. Reject unknown keys and sensitive keys recursively at every nesting depth.
3. Add positive and negative tests for each supported action.
4. Enforce append-only access through actual database roles/grants (coordinate with item 6).

### 4. P2-T08 — Close the authorisation integration gap before protected routes ship

**Implemented**
- Route registry, permission middleware, route registration, and startup verification exist.
- Health routes are registered through the registry.

**Still outstanding**
- requireAuth still trusts X-Stub-User-Id, X-Stub-Role, and X-Stub-Permissions. This is a Phase 2 stub, not production authentication.
- No real protected business endpoint currently demonstrates the complete registry → authentication → permission → ownership flow.
- The route registry and permission framework therefore have not yet been proven against real application routes.

**Required next action**
- When Phase 3 identity work begins, replace the stub with the planned server-side session verification before exposing protected routes. Do not treat client-supplied X-Stub-* headers as trusted identity.
- Add integration tests for unauthenticated, authenticated-but-forbidden, permitted, and non-owner (404) cases.

**Boundary:** do not invent business endpoints just to test the framework. Use the first real Phase 3 routes and keep them protected from their first commit.

### 5. P1-T04 — Correct the CI quality gate

**Still outstanding**
- PostgreSQL is mapped to host port 5435, but CI's DATABASE_URL points to localhost:5432.
- CI runs db:generate before migration checks. This can generate a missing migration during CI rather than requiring the migration to be committed.
- Root pnpm verify runs lint, typecheck, and tests. Lint builds the API, but the full workspace pnpm build is not an explicit verification step.
- Branch protection / required status checks cannot be confirmed from the workflow file alone.

**Required next action**
1. Correct the database port or service mapping.
2. Remove migration generation from CI; CI should validate committed migrations, not create them.
3. Add the full workspace build to the verification gate.
4. Run CI against a clean database after item 1 is complete.
5. Confirm the main-branch protection rules separately in GitHub settings.

### 6. P1-T07 — Finish deployment and database privilege separation

**Still outstanding**
- .github/workflows/deploy-staging.yml still uses echo statements and commented-out build, push, deployment, and readiness commands.
- apps/api/Dockerfile still starts apps/api/dist/server.js. The API TypeScript configuration compiles source under src/; the actual emitted entry point must be confirmed and the container command aligned with it.
- docs/database-roles.md describes roles, but actual role creation and grants have not been implemented or verified.
- No real staging deployment or rollback rehearsal is evidenced.

**Required next action**
1. Confirm the emitted API entry point from a clean build and correct the Docker command.
2. Build and start the API and worker images.
3. Implement the actual staging build/push/deploy/readiness steps, or explicitly keep staging marked incomplete and blocked.
4. Create least-privilege application and migration roles, apply grants, and test the denied operations.
5. Perform and record a staging deployment and rollback rehearsal.

### 7. P1-T03 and P1-T05 — Complete skeleton-level tests and developer workflow

**Still outstanding**
- API tests for health readiness/liveness, 404 and error envelopes, logger redaction, and graceful shutdown remain incomplete.
- The API package still has no dev script.
- Worker status reports processing: true as a hardcoded value rather than deriving actual runner state.
- No web component or smoke-test coverage is evidenced.

**Required next action**
- Add the missing API tests, provide a reliable workspace dev command, expose truthful worker state, and add minimum web build/component/smoke coverage.

### 8. Finish remaining Phase 2 acceptance criteria

| Task | Remaining work |
|---|---|
| **P2-T01 Money** | Add explicit API/database conversion helpers with safe-integer guards; enforce the planned restriction against unsafe general floating-point money arithmetic. |
| **P2-T02 State transitions** | Repeat concurrency tests 20 consecutive times; retain the conditional-update and history invariants. |
| **P2-T04 Durable jobs/outbox** | Scheduler, metrics, and inspection code now exist. Run the scheduler/outbox concurrency suites repeatedly (20 consecutive runs) and verify the single-flight guarantee against PostgreSQL. |
| **P2-T05 Idempotency** | Stale recovery, expiry cleanup, error envelopes, and a 20-request test now exist. Run the suite; add repeated race/crash-recovery coverage and verify replay persistence under response-write failures. |
| **P2-T06 Notifications/email** | Migration and worker registration now exist. Verify the full outbox → worker → notification-attempt → SMTP path. The factory selects a local SMTP endpoint for development/test and configured SMTP for staging/production, but it still uses the same SMTP provider class; decide whether a distinct test adapter is required by ADR-030 and test delivery/failure handling. |

### 9. Finish and approve the Phase 0 / Phase 1 / Phase 2 documents

The previously missing documents now exist, but existence is not approval or completeness:

- state-machines.md is explicitly **Draft for owner approval**.
- security-and-privacy.md is explicitly a **skeleton**; retention and legal positions still need counsel confirmation, and implementation controls must be evidenced.
- database-design.md records conformance gaps, including primary-key type alignment, missing audit fields, and status-history tables to be created with their entities.
- api-contract.md exists; confirm every endpoint and schema required by the implementation plan is represented before the relevant phase starts.
- decision-register.md exists and records proposed clarifications that must not silently be treated as approved decisions.
- ADR documents exist under docs/; the original expected docs/adr/ directory is not present. This is an organisation difference, not by itself a Phase 3 blocker.

## 4. Updated task-by-task status

### Phase 1

| Task | Updated status | Current assessment |
|---|---|---|
| **P1-T01 Workspace / TypeScript / lint baseline** | **PARTIAL** | Workspace, strict TypeScript, pnpm guard, and boundary linting exist. Previous specific lint findings appear fixed, but lint has not been rerun. No CI guard against stray lockfiles is evidenced. |
| **P1-T02 Database / Drizzle / migrations / test harness** | **PARTIAL** | Migration 0004 addresses the missing Phase 2 tables. Test isolation, clean migration proof, row-lock contention test, and a genuine drift check remain. |
| **P1-T03 API skeleton** | **PARTIAL** | Security wiring, registered health routes, startup registry verification, error mapping, and graceful shutdown exist. Required health/error/log-redaction/shutdown tests remain incomplete. |
| **P1-T04 Quality gate and CI** | **PARTIAL** | Workflow exists; database port, migration-generation order, and full-workspace build gate remain incorrect/incomplete. Branch protection is unverified. |
| **P1-T05 Worker and web skeletons** | **PARTIAL** | Worker runner and handler registration have advanced. API dev script, truthful worker processing status, and web tests remain. |
| **P1-T06 Shared packages and contract round trip** | **PARTIAL** | Shared types and validators exist, and the API consumes the shared error type. Pagination schema consumption and type-level contract tests remain. |
| **P1-T07 Staging and deployment pipeline** | **NOT MET** | Staging remains mocked; Docker entry point and database role grants remain unverified/unimplemented. |

### Phase 2

| Task | Updated status | Current assessment |
|---|---|---|
| **P2-T01 Money and rounding primitives** | **PARTIAL** | Core integer arithmetic, rounding, and allocation exist. Explicit safe conversion helpers and stronger floating-point guardrails remain. |
| **P2-T02 State-transition utility and history** | **MOSTLY DONE** | Conditional transitions and history exist. Required 20-run concurrency verification remains. |
| **P2-T03 Audit log** | **PARTIAL** | Transactional writes and immutability protections exist. Per-action recursive allow-lists and actual DB role restrictions remain. |
| **P2-T04 Durable jobs and transactional outbox** | **IMPLEMENTED; VERIFICATION OPEN** | Runner, recurring scheduler, metrics, and inspection code now exist. Repeated concurrency and PostgreSQL single-flight verification remain. |
| **P2-T05 Idempotency framework** | **IMPLEMENTED; VERIFICATION OPEN** | Stale recovery, expiry cleanup, shared error envelope, and 20-request test exist. Runtime and repeated race verification remain. |
| **P2-T06 Email adapter and notification pipeline** | **PARTIAL** | Migration and worker registration now exist. End-to-end delivery/failure tests and the final test-vs-production adapter decision remain. |
| **P2-T07 Security middleware and rate limiting** | **PARTIAL** | Security middleware is wired and the rate-limit table is migrated. Limiter still fails open, is not applied on a business/auth route, and needs consistent error handling. |
| **P2-T08 Authorisation framework** | **PARTIAL** | Registry and startup enforcement are wired. Authentication still uses stub headers; real session authentication and protected-route integration belong before protected Phase 3 routes ship. |

## 5. Important distinctions

- **Resolved in source** means the relevant implementation is present in the current branch. It does not mean tests pass.
- **Implemented; verification open** means code and tests exist, but acceptance evidence (especially repeated concurrency runs) is missing.
- **Partial** means some acceptance criteria are met and named criteria remain.
- **Not met** means a core acceptance outcome is still absent.
- No tests, typecheck, lint, clean migration, Docker build, or deployment were run as part of this audit update.
- Do not delete or rewrite generated files, migrations, schemas, or existing docs as part of the audit-only update.

## 6. Phase 3 entry decision

**NO-GO.** Phase 3 must remain on hold until all of the following are true:

1. Clean-database migrations and the database test harness are reliable.
2. Rate limiting fails safely and its error behaviour is tested.
3. Audit metadata validation is strict, and database privileges enforce append-only audit storage.
4. The Phase 3 session-authentication implementation replaces the stub before protected routes are exposed.
5. CI runs the correct database, committed migrations, full workspace build, lint, typecheck, and tests successfully.
6. Container startup and the staging/deployment decision are resolved.
7. Required Phase 1 and Phase 2 tests pass, including the specified repeated concurrency runs.
8. Phase 0 documents and outstanding decisions are reviewed and approved where required.

## 7. Immediate next task

Start with **Issue 1: P1-T02 — make database and test verification trustworthy**.

Keep the scope to the test harness, clean migration path, row-lock contention test, and drift detection. Do not combine it with rate-limiter changes or other Phase 2 work. Once Issue 1 is implemented and verified, move to Issue 2 and continue in the order above.
