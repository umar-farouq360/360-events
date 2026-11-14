# ADR-020: Omit Redis from the MVP; rate-limit store

Status: Accepted (refinement proposed)
Recorded: 2026-11-14 (accepted baseline: `implementation-plan.md` §4.2)
Unblocks: P2-T07
Satisfies: ARCH §18; C-19; INV-25

## Context

Sessions, inventory locking and the outbox all fit PostgreSQL. A second datastore adds hosting cost and failure modes. Rate limiting is the one area where Redis is normally used.

## Decision

- No Redis in the MVP. `architecture.md` lines that still list Redis in the header and §20.5 are stale and should be edited to match.
- Rate limits use two layers: an in-process limiter (cheap, per instance) and PostgreSQL-backed counters in `rate_limits` for security-sensitive routes (login, forgot-password, verify-email, checkout, scanner).

## Proposed change (needs your acceptance): failure behaviour

The Phase 1/2 audit found that the limiter **fails open** on database errors. Define the behaviour explicitly:

| Route class | If the database counter is unavailable |
|---|---|
| Authentication, password reset, email verification, scanner PIN | **Fail closed to the in-process limiter** at a stricter fixed limit; never unlimited |
| Checkout and other authenticated writes | Fall back to the in-process limiter at the normal limit |
| Public reads | In-process limiter only |

Every fallback is logged at `warn` with the route class.

## Consequences

- A database outage degrades rate limiting but never removes it.
- Counters live in one table with a TTL cleanup job (retention table in `security-and-privacy.md`).

## Revisit trigger

More than one API instance and the in-process limits materially diverge; counter queries exceed a p95 budget set in P11-T03; public catalog read load needs caching. If Redis is introduced, it is a cache only and never authoritative (INV-25).
