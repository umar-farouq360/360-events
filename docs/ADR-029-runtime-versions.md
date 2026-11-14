# ADR-029: Runtime versions

Status: Accepted (revision proposed)
Recorded: 2026-11-14 (accepted baseline: `implementation-plan.md` §4.2)
Unblocks: P1-T01, P1-T07
Satisfies: ARCH §20.1

## Context

The accepted decision says "Node 22 LTS or newer active release, pnpm 9+". Checked on 2026-11-14 against the Node.js release schedule: Node 22 entered Maintenance LTS in October 2025 and reaches end of life on **30 April 2027**. Node 24 is in Maintenance from 20 October 2026 and ends 30 April 2028. Node 26 became Active LTS on 28 October 2026 and ends 30 April 2029.

For a platform that plans a pilot and cutover in 2027, Node 22 would leave security-fix support within months of go-live.

## Options considered

| Version | Support ends | Risk |
|---|---|---|
| Node 22 | 2027-04-30 | Forced runtime upgrade around launch |
| **Node 24** | 2028-04-30 | Mature ecosystem, longest-tested LTS available |
| Node 26 | 2029-04-30 | Newest LTS; fewer months of ecosystem validation |

## Proposed change (needs your acceptance)

Move the baseline to **Node 24 LTS**. Keep the CI matrix able to run Node 26 as a non-blocking job, and re-evaluate moving to 26 at the Phase 7 checkpoint.

- `.nvmrc`, root `package.json` `engines`, the Dockerfiles and CI all name the same major.
- pnpm is pinned to one exact version in the root `package.json` `packageManager` field (Corepack). The version must be a pnpm major that supports the chosen Node major. Dockerfiles pin that same exact version (for example `corepack prepare pnpm@<exact> --activate`), never `latest`.
- CI fails if `.nvmrc`, `engines` and the Dockerfile base image disagree.

## Consequences

Small migration cost now (a version bump and a CI run) instead of a forced upgrade later.

## Revisit trigger

Each Node LTS transition (October of each year), or a dependency that does not yet support the chosen major.
