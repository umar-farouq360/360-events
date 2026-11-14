# ADR-028: API conventions

Status: Accepted
Recorded: 2026-11-14 (accepted baseline: `implementation-plan.md` §4.2)
Unblocks: all endpoint tasks, frontend slices
Satisfies: ARCH §14; INV-10

## Decision (summary; full rules in `docs/api-contract.md`)

- Versioned REST under `/api/v1`. JSON only.
- Error envelope `{ "error": { "code", "message", "requestId", "details"? } }`. Codes are `SCREAMING_SNAKE_CASE` and registered in `api-contract.md` §5.
- Lists use cursor pagination: `{ "items": [...], "metadata": { "nextCursor", "hasMore", "totalCount"? } }`. Single resources: `{ "data": {...} }`.
- `Idempotency-Key` header is **required** on every non-idempotent write that creates a financial or inventory effect (orders, payment attempts, refunds, payouts, scanner check-in). Scope is route plus user. A repeat with the same payload replays the stored response; a different payload returns `422 IDEMPOTENCY_KEY_REUSED`. Keys live 24 hours.
- Timestamps are ISO-8601 UTC with `Z`. Money is integer `*Kobo`. Ids are opaque UUID strings.
- A resource that exists but is not the caller's returns `404 NOT_FOUND`, not `403`, so ids cannot be probed. `403 FORBIDDEN` is used when the resource is visible to the caller but the action is not permitted.
- Request bodies are validated with strict Zod schemas that reject unknown fields.
- Every response carries `X-Request-Id`, and the same value appears in error bodies and logs.

## Consequences

The shared `ApiErrorResponse` type must include optional `details`, and every middleware that emits errors must include `requestId`. The validation middleware currently omits `requestId`; fix it so all errors share one shape.

## Revisit trigger

A public third-party API is introduced (needs a published versioning and deprecation policy), or GraphQL/RPC is considered.
