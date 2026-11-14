# Architecture Decision Records

Created by P0-T02. One file per decision, named `ADR-0NN-short-title.md`.

## Status of the register

| ADR | Title | Status | File |
|---|---|---|---|
| ADR-001 to ADR-017 | Baseline decisions | Accepted | recorded in `architecture.md` §22 |
| ADR-018 | Authentication and session model | Accepted, **refinement proposed** | [ADR-018](ADR-018-sessions-and-cookies.md) |
| ADR-019 | Deployment topology and domains | Accepted, **refinement proposed** | [ADR-019](ADR-019-topology-and-domains.md) |
| ADR-020 | Omit Redis; rate-limit store | Accepted, **refinement proposed** | [ADR-020](ADR-020-no-redis-rate-limiting.md) |
| ADR-021 | Job runner and outbox | Accepted (implemented in P2-T04) | spike record still to be written inside P2-T04 |
| ADR-022 | Object storage | Accepted | decided at P4-T02 |
| ADR-023 | Identifiers | Accepted, **refinement proposed** | [ADR-023](ADR-023-identifiers.md) |
| ADR-024 | Money representation | Accepted | [ADR-024](ADR-024-money.md) |
| ADR-025 | Test stack | Accepted | [ADR-025](ADR-025-test-stack.md) |
| ADR-026 | Ticket credential scheme | Accepted | decided at P7-T07 |
| ADR-027 | Financial ledger model | Accepted | decided at P7-T02 |
| ADR-028 | API conventions | Accepted | [ADR-028](ADR-028-api-conventions.md) |
| ADR-029 | Runtime versions | Accepted, **revision proposed** | [ADR-029](ADR-029-runtime-versions.md) |
| ADR-030 | Email provider and sending domain | Accepted | [ADR-030](ADR-030-email-provider.md) |

"Refinement proposed" means the accepted decision stands, but writing the full record exposed a detail that should change. Each such ADR has a **Proposed change** section that needs your explicit acceptance. Until you accept it, the original wording in `implementation-plan.md` §4.2 governs.

## Template

```
# ADR-0NN: Title
Status: Proposed | Accepted | Superseded by ADR-0MM
Recorded: YYYY-MM-DD
Unblocks: tasks
Satisfies: BR/ARCH sections, DEC ids

## Context
## Options considered
## Decision
## Consequences
## Revisit trigger
```

A superseded ADR is never deleted or rewritten. Add a new ADR and change the old one's status line.
