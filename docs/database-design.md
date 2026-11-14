# Database Design Baseline

| | |
|---|---|
| **Document version** | 0.1.0 |
| **Created by** | P0-T05 |
| **Sources** | ARCH §6; ADR-023, ADR-024; BR §9, §15, §22; DEC-015; `state-machines.md` |
| **Scope** | Conventions for all schemas, plus the entity list for Phases 1 to 6. Financial tables (ledger, payouts) are deferred until the accountant review (DEC-019). |
| **Updated by** | Every schema task |

## 1. Conventions

### 1.1 Naming

| Item | Rule | Example |
|---|---|---|
| Tables | `snake_case`, plural | `ticket_types` |
| Columns | `snake_case`; unit in the name for quantities | `price_kobo`, `starts_at` |
| Primary key | `id`, UUIDv7 (ADR-023) | |
| Foreign keys | `<singular_table>_id` | `event_id` |
| Booleans | `is_` / `has_` prefix | `is_verified` |
| Timestamps | `_at` suffix | `approved_at` |
| Enums | PostgreSQL enum (or `text` plus `CHECK`) named `<entity>_<field>`; values `snake_case` | `event_status` |
| Constraints | `<table>_<columns>_<kind>`, kinds `pk`, `uq`, `fk`, `ck`, `idx` | `ticket_types_event_id_fk` |
| Drizzle files | `<entity>.schema.ts`, **one entity per file** | `events.schema.ts` |

### 1.2 Identifiers

UUIDv7 generated in application code. Use the native `uuid` column type (see ADR-023, proposed change). Order references for humans are a separate unique column (`order_number`).

### 1.3 Time

All instants are `timestamptz`, stored and handled in UTC. Drizzle: `timestamp('x', { withTimezone: true, mode: 'date' })`. Event local time is stored as `starts_at` (instant) plus `timezone` (IANA name, default `Africa/Lagos`); never store local time without the zone.

### 1.4 Money

Integer kobo, `bigint`, column name ends `_kobo` (ADR-024). Currency `text` with `CHECK (currency = 'NGN')` on every table that stores money. Fee configuration stores `percentage_basis_points integer` and optional `fixed_kobo bigint`.

### 1.5 Standard columns

| Column | Where | Notes |
|---|---|---|
| `id` | every table | |
| `created_at` | every table | `default now()`, not null |
| `updated_at` | mutable tables | set on every update; not on append-only tables |
| `version` | tables with concurrent edits by humans (events, ticket types) | integer, incremented on update, used for optimistic concurrency (`409 CONFLICT` on mismatch) |
| `created_by`, `updated_by` | admin-editable configuration | user id |

Append-only tables (audit, history, ledger, webhook events) have **no** `updated_at` and are protected by triggers that reject `UPDATE` and `DELETE`.

### 1.6 Status columns

A status column is only changed through `executeTransition` (conditional update plus history row; `state-machines.md` §1.1). Every status table has a matching `<entity>_status_history` table: `id`, `<entity>_id`, `from_status`, `to_status`, `actor_type`, `actor_id`, `reason`, `request_id`, `created_at`.

### 1.7 Constraints

Prefer database constraints over code checks for anything that protects an invariant:

- `CHECK` for non-negative amounts and quantities, `total_kobo = subtotal_kobo + fee_kobo`, `sold_count + reserved_count <= capacity`.
- Partial unique indexes for "at most one live row" rules (one open organizer application per user; one `successful` payment attempt per order; one live allocation per payable line).
- Unique provider references and provider event ids.
- Foreign keys with explicit `ON DELETE RESTRICT` unless the child is meaningless without the parent.

### 1.8 Deletion policy: soft delete versus anonymisation

| Data | Policy |
|---|---|
| Financial rows (orders, payments, refunds, ledger, payouts) | **Never deleted, never soft-deleted.** Retained 6 years (DEC-015). |
| Users | **Anonymised**, not deleted: name, email, phone and password hash replaced by `deleted_user_<id>` placeholders; sessions removed; the row and its id remain so financial rows keep a valid reference. |
| Events, ticket types | Never deleted. They end as `cancelled`, `rejected` or `completed`. |
| Audit and history tables | Append-only; never deleted inside the retention period. |
| Operational tables (sessions, idempotency keys, rate limits, completed jobs, notifications) | Hard-deleted by retention jobs (`security-and-privacy.md` §5). |
| `deleted_at` columns | Not used. A flag that hides rows from queries invites accidental leakage and breaks unique constraints. |

### 1.9 Migrations (expand and contract)

1. Migrations are generated from the Drizzle schema, **reviewed and committed**, and applied by `db:migrate`. CI never generates migrations; it fails if the schema differs from the committed migrations.
2. **Expand, then contract.** A breaking change takes two or more releases: (a) *expand*: add the new column or table, write to both, backfill; (b) deploy code that reads the new shape; (c) *contract*: remove the old shape in a later migration.
3. Destructive changes (drop column, drop table, change type) are never combined with the code that stops using them.
4. Large backfills run as batched jobs, not inside a migration transaction.
5. Every migration has a documented recovery note: how to roll forward if it fails halfway.
6. Production migrations run under the migration role; the API runs under the least-privilege application role (`database-roles.md`).

### 1.10 Test and fixture rule

No production personal data in development or test databases (ARCH §20.2). Fixtures are generated.

## 2. Phase 1 and 2 tables (implemented)

| Table | Purpose | Notes |
|---|---|---|
| `db_migrations_history` | Records applied migrations | Currently declared inside `audit-events.schema.ts`; move to its own file |
| `audit_events` | Immutable log of significant actions | Trigger blocks `UPDATE` and `DELETE`; writes require a transaction |
| `outbox_events` | Transactional outbox and durable job queue | `dedupe_key` unique; lease and attempt `CHECK`s; partial indexes on pending and processing |
| `idempotency_keys` | Replay and in-flight protection | Unique `(scope, key)`; `status` is `in_progress` or `completed`; 24-hour expiry |
| `notifications` | One row per notification to send | Carries a dedupe key |
| `notification_attempts` | Delivery attempts per notification | |
| `rate_limits` | PostgreSQL-backed request counters | TTL cleanup (§5 of `security-and-privacy.md`) |

### Conformance gaps to close (found while writing this document)

| Gap | Required by | Action |
|---|---|---|
| Primary keys are `text` | ADR-023 proposed change | Convert to `uuid` before Phase 3 |
| `audit_events` has no `ip_address`, `user_agent`, `previous_state` or `reason` | BR §19.3 | Add as nullable columns; require for admin actions |
| `audit_events.actor_id` is `text not null` | system actors | Acceptable if a fixed id is used for system and worker; otherwise make nullable |
| No `*_status_history` tables yet | §1.6 | Created with each status entity |

## 3. Entity list by domain (Phases 1 to 6)

Columns shown are the **load-bearing** ones. Each task defines the full schema. "Phase" is the first phase that creates the table.

### 3.1 Identity (Phase 3)

| Table | Key columns and constraints |
|---|---|
| `users` | `email` (original), `email_normalized` **unique**; `name`; `phone` nullable; `password_hash`; `status` (`active`, `suspended`, `deleted`); `email_verified_at`; `anonymised_at` |
| `user_roles` | `user_id`, `role` (`customer`, `organizer`, `admin`); unique `(user_id, role)` |
| `admin_permissions` | `user_id`, `permission`; unique pair; granted by, granted at |
| `sessions` | `token_hash` **unique** (SHA-256); `user_id`; `expires_at`; `last_seen_at`; `ip_hash`, `user_agent` |
| `email_verification_tokens`, `password_reset_tokens` | `token_hash` unique; `user_id`; `expires_at`; `used_at` (single use) |
| `mfa_credentials` | `user_id` unique; encrypted TOTP secret; `confirmed_at`; recovery codes (hashed) (Phase 4) |

### 3.2 Organizer management (Phase 4)

| Table | Key columns and constraints |
|---|---|
| `organizer_profiles` | `user_id` unique; display name; `status` (`active`, `suspended`); suspension reason |
| `organizer_applications` | `user_id`; `applicant_type` (`individual`, `business`); `status`; partial unique on `user_id` where status is non-terminal; reviewer id and decision time |
| `organizer_verification_checks` | `application_id`; check type; result; provider reference. Stores results and references, not raw identity numbers where avoidable |
| `verification_documents` | `application_id`; private storage key; content type; size; uploaded at (ADR-022) |
| `organizer_application_status_history` | per §1.6 |

### 3.3 Events (Phase 5)

| Table | Key columns and constraints |
|---|---|
| `event_categories` | `slug` unique; name; `is_active` |
| `events` | `organizer_id`; `category_id`; title; description; `status`; `starts_at`, `ends_at`, `timezone`; venue fields or online link; `sales_open_at`, `sales_close_at`; `suspended_at`; `version`; `CHECK (ends_at > starts_at)` |
| `event_status_history` | per §1.6 |
| `event_reschedule_requests` | `event_id`; proposed start, end, venue; `status`; reviewer; `refund_window_closes_at` |
| `event_cancellation_requests` | `event_id`; reason; `status`; reviewer |
| `cancellation_runs` | `event_id` **unique**; `status`; step progress |
| `event_media` | `event_id`; storage key; kind (`banner`); public URL (ADR-022) |

### 3.4 Ticket configuration (Phase 5)

| Table | Key columns and constraints |
|---|---|
| `ticket_types` | `event_id`; name; description; `price_kobo >= 0`; `capacity > 0`; `sold_count`, `reserved_count`; `max_per_order`; sales window; `status`; `version`; `CHECK (sold_count >= 0 AND reserved_count >= 0 AND sold_count + reserved_count <= capacity)` |
| `ticket_type_status_history` | per §1.6 |
| `fee_configurations` (Phase 6) | `percentage_basis_points`, optional `fixed_kobo`; `effective_from`; created by; effective-dated and append-only (BR §10.2) |

### 3.5 Inventory and orders (Phase 6)

| Table | Key columns and constraints |
|---|---|
| `reservations` | `order_id`; `status`; `expires_at`; index on `(status, expires_at)` for the expiry job |
| `reservation_items` | `reservation_id`; `ticket_type_id`; `quantity > 0` |
| `orders` | `customer_id`; `event_id`; `order_number` unique; `status`; `exception_code` nullable (PC-01); pricing snapshot: `subtotal_kobo`, `fee_kobo`, `total_kobo`, `fee_basis_points`, `fee_fixed_kobo`, `fee_configuration_id`, `currency`; `refund_status`; `refunded_amount_kobo`; `CHECK (total_kobo = subtotal_kobo + fee_kobo)` |
| `order_items` | `order_id`; `ticket_type_id`; `quantity`; `unit_price_kobo` (snapshot); `line_total_kobo` |
| `order_status_history` | per §1.6 |

**Inventory model (to be confirmed by the P6-T02 spike).** Counters on `ticket_types` (`sold_count`, `reserved_count`) updated by a single conditional statement `UPDATE ticket_types SET reserved_count = reserved_count + :qty WHERE id = :id AND sold_count + reserved_count + :qty <= capacity`. One row-level lock per ticket type, no separate inventory table, and the `CHECK` constraint backs it up. A reconciliation query (P6-T08) compares counters to `reservations` and `tickets`.

### 3.6 Deferred to later phases

Payments, webhook events, tickets and check-ins (Phase 7), refunds (Phase 8), ledger, payouts, payable allocations, settlement policy (Phases 7 to 9, after the accountant review), support cases (Phase 10).

## 4. Schema review checklist (use in every schema PR)

- [ ] Names follow §1.1; one entity per file.
- [ ] `uuid` primary key; `created_at`; `updated_at` if mutable.
- [ ] Money is `bigint` `_kobo` with `CHECK`s.
- [ ] Every invariant it supports has a constraint, not only code.
- [ ] Status column has a transition table and a history table.
- [ ] Unique and partial unique indexes exist for every "at most one" rule.
- [ ] Indexes exist for every foreign key and every worker polling query.
- [ ] Personal data columns are listed in `security-and-privacy.md` §2 with a retention entry.
- [ ] Migration is generated, reviewed, committed, applies from empty, and follows expand/contract.
