# ADR-025: Test stack

Status: Accepted
Recorded: 2026-11-14 (accepted baseline: `implementation-plan.md` §4.2)
Unblocks: P1-T02, P1-T04
Satisfies: ARCH §19; BR §24

## Decision

| Layer | Tool |
|---|---|
| Unit and integration | Vitest |
| HTTP | supertest against `buildApp()` |
| Database | Real PostgreSQL, same major version as production, via Docker locally and a CI service container |
| Browser end-to-end | Playwright |

- **Per-run isolation:** the harness creates a fresh database per test run, applies all migrations from empty, and truncates mutable tables between tests. Migrations are never generated during tests or CI (CI fails if the schema and migrations differ).
- **Concurrency tests** run against the real database and use the pattern in `implementation-plan.md` §8.3: define the expected outcome first, release N callers together, assert exactly one winner, repeat **20 consecutive times** in CI.
- **Mocks** are allowed for the payment provider and email transport only. Mocking the database in a concurrency or constraint test is prohibited.
- **Every invariant** (BR §22) maps to at least one test named in `implementation-plan.md` §9.3.
- Illegal-transition lists in `state-machines.md` become table-driven tests.

## Consequences

CI needs a PostgreSQL service whose mapped port matches `DATABASE_URL`. Tests are slower than mocked tests; that is the accepted price for trustworthy concurrency results.

## Revisit trigger

Suite runtime exceeds the CI budget (consider test sharding or a template database), or Playwright flakiness requires a different runner strategy.
