# API Contract

| | |
|---|---|
| **Document version** | 0.1.0 |
| **Created by** | P0-T05 |
| **Sources** | ARCH §14; ADR-018, ADR-028; BR §3, §20.1; C-12, C-13, C-18 |
| **Status** | Baseline. Request and response schemas are added per endpoint task. |
| **Updated by** | Every endpoint task |

## 1. General rules

| Topic | Rule |
|---|---|
| Base path | `/api/v1`. Health routes sit outside the versioned prefix. |
| Format | JSON request and response bodies (`Content-Type: application/json`), UTF-8. The webhook route reads the **raw** body. |
| Ids | Opaque UUID strings. |
| Timestamps | ISO-8601 UTC with `Z`, for example `2026-11-14T09:30:00Z`. |
| Money | Integer kobo in fields named `*Kobo`. No decimals, no strings. |
| Unknown fields | Rejected (`VALIDATION_ERROR`). Schemas are strict. |
| Request id | Every response has `X-Request-Id`. The same id is in error bodies and logs. A client may send its own `X-Request-Id`; the server accepts it only if it is 8 to 64 safe characters, otherwise it generates one. |
| Rate limits | `429 RATE_LIMIT_EXCEEDED` with a `Retry-After` header (seconds). |

## 2. Response shapes

**Single resource**

```json
{ "data": { "id": "…", "…": "…" } }
```

**Collection**

```json
{
  "items": [ { "…": "…" } ],
  "metadata": { "nextCursor": "opaque-or-null", "hasMore": true, "totalCount": 120 }
}
```

`totalCount` is present only where it is cheap to compute (admin lists), never a placeholder.

**Action with no body** returns `204 No Content`.

**Error** (every non-2xx response, no exceptions)

```json
{
  "error": {
    "code": "INSUFFICIENT_INVENTORY",
    "message": "The requested ticket quantity is no longer available.",
    "requestId": "0192…",
    "details": [ { "path": "items.0.quantity", "message": "…" } ]
  }
}
```

`details` is optional and used by `VALIDATION_ERROR` only. Messages never contain stack traces, SQL, secrets, tokens or the caller's submitted values.

## 3. Pagination

Cursor-based. Query parameters: `limit` (default 20, maximum 100) and `cursor` (opaque string from `metadata.nextCursor`). Sorting is fixed per endpoint and always ends on `id` as a tiebreaker so pages are stable. The cursor encodes the last sort key and id (base64url). A cursor from another endpoint or a tampered cursor returns `400 BAD_REQUEST`.

## 4. Idempotency

- Header: `Idempotency-Key: <opaque string, 16 to 128 characters>`.
- **Required** on endpoints marked **Idem = Y** below. Missing key returns `400 IDEMPOTENCY_KEY_REQUIRED`.
- Scope: route plus authenticated user. Keys live 24 hours.
- Same key and same payload after completion: the stored response (status and body) is replayed.
- Same key, different payload: `422 IDEMPOTENCY_KEY_REUSED`.
- Same key while the first request is still running: `409 IDEMPOTENCY_IN_PROGRESS`. A key stuck `in_progress` for over 60 seconds is reclaimed by one retry.
- A `5xx` response releases the key so the client may retry.
- The client generates a new key for each new user intent, and reuses the key only when retrying the same intent.
- Clients must not auto-retry non-idempotent financial writes without a key (ARCH §15.6).

## 5. Error code registry

Status rule: `400` malformed or failed validation; `401` not authenticated; `403` authenticated but not allowed; `404` not found **or not the caller's** (ADR-028); `409` state or concurrency conflict; `422` well-formed but breaks a business rule; `429` throttled; `5xx` server.

| Code | HTTP | Meaning |
|---|---|---|
| `BAD_REQUEST` | 400 | Malformed request |
| `VALIDATION_ERROR` | 400 | Schema validation failed; `details` lists field paths |
| `UNAUTHORIZED` | 401 | No valid session |
| `FORBIDDEN` | 403 | Visible to the caller but not permitted |
| `NOT_FOUND` | 404 | Missing, or not the caller's resource |
| `CONFLICT` | 409 | Generic conflict |
| `VERSION_MISMATCH` | 409 | Optimistic-concurrency version is stale |
| `INVALID_TRANSITION` | 409 | Lifecycle change not allowed from the current state |
| `RATE_LIMIT_EXCEEDED` | 429 | Too many requests |
| `INTERNAL_SERVER_ERROR` | 500 | Unexpected error (details only in logs) |
| `SERVICE_UNAVAILABLE` | 503 | A dependency is unavailable |
| `IDEMPOTENCY_KEY_REQUIRED` | 400 | Header missing |
| `IDEMPOTENCY_IN_PROGRESS` | 409 | Same key still processing |
| `IDEMPOTENCY_CONFLICT` | 409 | Concurrent change to the key; retry |
| `IDEMPOTENCY_KEY_REUSED` | 422 | Same key with a different payload |
| `CSRF_TOKEN_INVALID` | 403 | Missing or wrong CSRF token or origin |
| `EMAIL_NOT_VERIFIED` | 403 | Action needs a verified email (DEC-023) |
| `ACCOUNT_SUSPENDED` | 403 | User or organizer is suspended |
| `ORGANIZER_NOT_APPROVED` | 403 | Organizer function without approval |
| `MFA_REQUIRED` | 403 | Administrator must enrol or present TOTP |
| `STEP_UP_REQUIRED` | 403 | Password re-entry or fresh MFA needed for this action |
| `EVENT_NOT_PURCHASABLE` | 409 | Event not `published`, or outside the sales window |
| `INSUFFICIENT_INVENTORY` | 409 | Not enough tickets available |
| `PURCHASE_LIMIT_EXCEEDED` | 422 | Per-order or per-customer limit exceeded (DEC-017) |
| `PRICE_CHANGED` | 409 | `expectedTotalKobo` no longer matches (C-12) |
| `RESERVATION_EXPIRED` | 409 | Reservation timed out |
| `CANCELLATION_REQUIRES_APPROVAL` | 409 | Tickets sold; organizer must submit a request (DEC-021) |
| `ALREADY_REDEEMED` | 409 | Ticket already checked in |
| `TICKET_INVALID` | 422 | Ticket revoked, forged or for another event |
| `REFUND_EXCEEDS_REMAINING` | 409 | Refund amount above what remains refundable |
| `REFUND_NOT_ELIGIBLE` | 422 | Policy does not allow a refund |
| `PAYOUT_BELOW_MINIMUM` | 422 | Below the minimum payout |
| `PAYOUT_ON_HOLD` | 409 | A risk hold blocks payout |
| `DELETION_BLOCKED` | 409 | Account deletion blocked (valid upcoming tickets, open disputes) |
| `WEBHOOK_SIGNATURE_INVALID` | 401 | Provider signature check failed |

New codes are added here in the same PR as the endpoint that returns them.

## 6. Authentication model

- Browser sessions per ADR-018: opaque token in a `HttpOnly; Secure; SameSite=Lax` cookie, server-side session row, revocable.
- Web app requests use `credentials: 'include'`. CORS allows exact origins and credentials only.
- Unsafe methods require the CSRF token in `X-CSRF-Token` (obtained from `GET /auth/me`) and an allowed `Origin`. The webhook route is exempt.
- Authorisation is deny-by-default: every route is registered in the route registry with its auth requirement and permission; startup fails if any route is unregistered.
- Administrator permissions are granular (`events:approve`, `finance:payout:approve`, and so on). High-risk admin actions need TOTP MFA plus password re-entry (C-14, BR §19.3) and return `STEP_UP_REQUIRED` otherwise.
- The check-in scanner authenticates with an event-scoped, time-bound PIN or token (DEC-024), not a user session.
- The payment webhook authenticates by provider signature on the raw body.

## 7. Endpoint inventory

Columns: **Auth** = who may call; **Idem** = `Idempotency-Key` required; **Phase** = first phase that delivers it. Rows marked **C-18** are confirmed in ARCH §14.2. Rows marked **+** are added by this document and need your acceptance (they fill gaps against BR §3).

Auth values: `Public`; `User` (any session); `Customer` (verified email where noted); `Organizer`; `Admin:<permission>`; `Scanner`; `Provider`.

### 7.1 Authentication and account

| Method and path | Auth | Idem | Phase | Source |
|---|---|---|---|---|
| `POST /auth/register` | Public | | 3 | C-18 |
| `POST /auth/login` | Public | | 3 | C-18 |
| `POST /auth/logout` | User | | 3 | C-18 |
| `POST /auth/verify-email` | Public (token) | | 3 | C-18 |
| `POST /auth/resend-verification` | User | | 3 | + |
| `POST /auth/forgot-password` | Public | | 3 | C-18 |
| `POST /auth/reset-password` | Public (token) | | 3 | C-18 |
| `GET /auth/me` | User | | 3 | C-18 |
| `PATCH /auth/me` (name, phone) | User | | 3 | + (BR §3.1 profile) |
| `POST /auth/change-password` | User | | 3 | + (BR §5.1) |
| `GET /auth/sessions`, `DELETE /auth/sessions/:id` | User | | 3 | + (revocation) |
| `POST /auth/me/delete-request` | User | Y | 3 / 10 | C-18 |
| `POST /auth/mfa/enroll`, `POST /auth/mfa/confirm`, `POST /auth/step-up` | Admin | | 4 | + (C-14) |

### 7.2 Organizer applications and profile

| Method and path | Auth | Idem | Phase | Source |
|---|---|---|---|---|
| `POST /organizer-applications` | Customer | Y | 4 | C-18 |
| `GET /organizer-applications/me` | Customer | | 4 | C-18 |
| `PATCH /organizer-applications/:id` (draft or info request) | Customer | | 4 | + |
| `POST /organizer-applications/:id/withdraw` | Customer | | 4 | + |
| `GET /admin/organizer-applications` | Admin:`organizers:review` | | 4 | C-18 |
| `POST /admin/organizer-applications/:id/approve` | Admin:`organizers:approve` + step-up | Y | 4 | C-18 |
| `POST /admin/organizer-applications/:id/reject` | Admin:`organizers:approve` | Y | 4 | C-18 |
| `POST /admin/organizer-applications/:id/request-information` | Admin:`organizers:review` | | 4 | + |
| `GET /organizer/profile`, `PATCH /organizer/profile` | Organizer | | 4 | + (BR §3.2) |
| `POST /admin/organizers/:id/suspend`, `POST /admin/organizers/:id/reinstate` | Admin:`users:manage` + step-up | Y | 4 | + (BR §6.4) |

### 7.3 Events and ticket types

| Method and path | Auth | Idem | Phase | Source |
|---|---|---|---|---|
| `GET /events`, `GET /events/:id` (published only) | Public | | 5 | C-18 |
| `GET /event-categories` | Public | | 5 | + |
| `POST /organizer/events`, `PATCH /organizer/events/:id` | Organizer (owner) | | 5 | C-18 |
| `GET /organizer/events`, `GET /organizer/events/:id` | Organizer (owner) | | 5 | + |
| `POST /organizer/events/:id/submit` | Organizer (owner) | | 5 | C-18 |
| `POST /organizer/events/:id/publish` | Organizer (owner) | | 5 | C-18 (DEC-027) |
| `POST /organizer/events/:id/ticket-types`, `PATCH /organizer/ticket-types/:id` | Organizer (owner) | | 5 | C-18 |
| `POST /organizer/events/:id/media` (signed upload request) | Organizer (owner) | | 5 | + (ADR-022) |
| `POST /organizer/events/:id/reschedule-request` | Organizer (owner) | Y | 5 | C-18 |
| `POST /admin/events/:id/reschedule/:reqId/approve` and `.../reject` | Admin:`events:approve` | Y | 5 | C-18 / + |
| `POST /organizer/events/:id/cancellation-request` | Organizer (owner) | Y | 5 / 8 | C-18 |
| `POST /admin/events/:id/cancellations/:reqId/approve` and `.../reject` | Admin:`events:cancel` + step-up | Y | 8 | C-18 / + |
| `POST /organizer/events/:id/cancel` (0 tickets sold only) | Organizer (owner) | Y | 5 | C-18 |
| `GET /admin/events` (filters, pagination) | Admin:`events:approve` | | 5 | + |
| `POST /admin/events/:id/approve`, `.../reject`, `.../request-changes` | Admin:`events:approve` | | 5 | C-18 / + |
| `POST /admin/events/:id/suspend`, `.../reinstate` | Admin:`events:suspend` + step-up | Y | 5 | C-18 |
| `POST /admin/events/:id/cancel` | Admin:`events:cancel` + step-up | Y | 5 / 8 | C-18 |
| `POST/PATCH /admin/event-categories` | Admin:`config:categories:write` | | 5 | + (BR §3.3) |

### 7.4 Orders and checkout

| Method and path | Auth | Idem | Phase | Source |
|---|---|---|---|---|
| `POST /orders/quote` | Customer | | 6 | C-18 (C-12) |
| `POST /orders` (needs `expectedTotalKobo`; verified email) | Customer | **Y** | 6 | C-18 |
| `GET /orders/me`, `GET /orders/:id` (owner only) | Customer | | 6 | C-18 |
| `POST /orders/:id/cancel` (pending only) | Customer | Y | 6 | C-18 |
| `GET /organizer/events/:id/orders` | Organizer (owner) | | 6 | + (BR §3.2) |

### 7.5 Payments, tickets, check-in

| Method and path | Auth | Idem | Phase | Source |
|---|---|---|---|---|
| `POST /orders/:id/payment-attempts` | Customer (owner) | **Y** | 7 | C-18 |
| `GET /orders/:id/payment-status` | Customer (owner) | | 7 | C-18 |
| `POST /webhooks/paystack` (raw body) | Provider | | 7 | C-18 |
| `GET /tickets/me`, `GET /tickets/:id` | Customer (owner) | | 7 | C-18 |
| `POST /organizer/events/:id/checkin-keys` | Organizer (owner) | Y | 7 | C-18 (DEC-024) |
| `POST /checkin/scan` | Scanner or Organizer | **Y** | 7 | C-18 |

### 7.6 Refunds, payouts, finance

| Method and path | Auth | Idem | Phase | Source |
|---|---|---|---|---|
| `POST /orders/:id/refund-requests` (support request) | Customer (owner) | Y | 8 | C-18 |
| `GET /refunds/me` | Customer | | 8 | C-18 |
| `GET /admin/refunds`, `POST /admin/refunds/:id/approve`, `.../reject` | Admin:`finance:refund:process` + step-up | Y | 8 | + |
| `GET /admin/reconciliation/exceptions` | Admin:`finance:reconcile:read` | | 8 | + |
| `GET /organizer/payouts/eligible-balance`, `GET /organizer/payouts` | Organizer | | 9 | C-18 |
| `POST/GET /organizer/payout-destinations` | Organizer | Y | 9 | + (P9-T03) |
| `GET /admin/payouts` | Admin:`finance:payout:approve` | | 9 | C-18 |
| `POST /admin/payouts/:id/approve`, `.../cancel`, `.../hold`, `.../release-hold` | Admin:`finance:payout:approve` + step-up | Y | 9 | C-18 / + |
| `GET/PUT /admin/config/fees` | Admin:`config:fees:write` + step-up | Y | 6 | + (BR §10.2) |
| `GET/PUT /admin/config/settlement` | Admin:`config:settlement:write` + step-up | Y | 9 | + (BR §14.1) |

### 7.7 Support, oversight, operations

| Method and path | Auth | Idem | Phase | Source |
|---|---|---|---|---|
| `POST /support/complaints` | Customer | Y | 10 | C-18 |
| `GET /admin/complaints`, `PATCH /admin/complaints/:id` | Admin:`complaints:manage` | | 10 | C-18 |
| `GET /admin/audit-events` | Admin:`audit:read` | | 10 | + (BR §16.3) |
| `GET /admin/users`, `PATCH /admin/users/:id` (status) | Admin:`users:manage` | | 10 | + |
| `GET /admin/jobs/failed`, `POST /admin/jobs/:id/requeue` | Admin:`ops:jobs` | Y | 10 | + (BR §16.3) |

## 8. Coverage of BR §3 user capabilities

| BR capability | Covered by | Notes |
|---|---|---|
| Customer: register, authenticate, profile | §7.1 | |
| Customer: discover events, availability | §7.3 | |
| Customer: purchase, orders, tickets, QR | §7.4, §7.5 | |
| Customer: payment and refund updates | §7.5, §7.6, email | In-app inbox deferred (C-16) |
| Customer: support, account deletion | §7.7, §7.1 | |
| Organizer: profile, events, tickets, submit, publish | §7.2, §7.3 | |
| Organizer: sales, orders, attendance, check-in | §7.4, §7.5 | Summaries added with P6-T09 and P7-T11 |
| Organizer: cancellation and reschedule requests | §7.3 | |
| Organizer: settlement and payouts | §7.6 | |
| Admin: organizer review, suspension | §7.2 | |
| Admin: event review, suspension, cancellation | §7.3 | |
| Admin: fee and settlement config | §7.6 | |
| Admin: transactions, refunds, payouts, reconciliation | §7.6 | A transactions report endpoint is added with P8-T09 |
| Admin: complaints, audit logs, categories | §7.3, §7.7 | |
| Deferred (post-MVP) | Teams and delegated permissions beyond scanner token; in-app notification inbox; per-guest ticket names; discount codes | BR §23.2, C-16, DEC-026 |

## 9. Webhook contract (`POST /webhooks/paystack`)

1. Read the **raw** body (no JSON parsing before signature verification).
2. Verify the provider signature. Invalid: `401 WEBHOOK_SIGNATURE_INVALID`; nothing is persisted as trusted.
3. Validate minimal structure; persist the event durably with the provider event id (unique).
4. Respond `200` only after the event is durably stored. A duplicate event id also returns `200` without reprocessing.
5. A worker processes the event: re-verify with the provider API, apply the state transition, post the ledger entries, enqueue notifications.
6. Never trust the redirect or the webhook body alone for amount, currency or status (INV-08, INV-09).

Provider-specific details (signature header, retry schedule) are recorded in `docs/provider-capabilities.md` (P0-T06).
