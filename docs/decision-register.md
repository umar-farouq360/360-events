# Decision Register

| | |
|---|---|
| **Document version** | 0.1.0 |
| **Created by** | P0-T03 |
| **Sources** | `business-requirements-and-rules.md` v0.2.0 §25 (BR), `implementation-plan.md` v0.1.0 §4.1 (IMPL) |
| **Owner of every decision** | Umar (product owner) unless a row names an adviser |
| **Updated by** | Every decision, every change request (see §3) |

## 1. Business decisions DEC-001 to DEC-027

Status values: `open`, `provisional`, `decided`. All 27 are `decided` in BR §25. The **Gate** column lists confirmations that must still happen before the named task starts, because the decision depends on an external answer (provider, counsel, accountant). A gate does not reopen a decision; it is the point at which the decision is checked against reality, and if the answer is unfavourable it goes through the change process in §3.

"Decided on" is the baseline date of IMPL v0.1.0 (2026-10-28), the date the decided positions were locked into the plan. Replace with the exact date of owner sign-off if you recorded one.

| ID | Decision (short) | Status | Decided on | Blocks (first task that needs it) | Gate before that task |
|---|---|---|---|---|---|
| DEC-001 | Admin-configurable percentage fee; default 500 bps; optional `fixed_kobo` component | decided | 2026-10-28 | P6-T01 | none |
| DEC-002 | Fee evaluated at order level on subtotal; free orders pay ₦0 fee | decided | 2026-10-28 | P6-T01 | none |
| DEC-003 | Integer kobo, half-up rounding, snapshot on order | decided | 2026-10-28 | P2-T01 (done), P6-T04 | none |
| DEC-004 | Purchases final by default; manual admin discretion; fee retained | decided | 2026-10-28 | P8-T01, P8-T06 | Counsel: fee non-refundability enforceability (BR §18.3) |
| DEC-005 | Reschedule: tickets transfer; 7-day (max to T-48h) refund window; fee retained | decided | 2026-10-28 | P5-T07, P8-T01 | Counsel (same as DEC-004); see PC-05 |
| DEC-006 | Refund SLAs: submit ≤24h, bank 5–10 business days, stall alert at 72h | decided | 2026-10-28 | P8-T03, P8-T09 | none |
| DEC-007 | Settlement milestone relative to event start, admin-configurable | decided | 2026-10-28 | P9-T01 | See PC-04 (single default value) |
| DEC-008 | Manual admin-approved payouts in MVP | decided | 2026-10-28 | P9-T05 | none |
| DEC-009 | Pre-event cap and post-event reserve; min payout ₦2,000; admin risk holds | decided | 2026-10-28 | P9-T01, P9-T04 | Accountant review (DEC-019); see PC-04 |
| DEC-010 | Merchant of Record, direct platform collection; no checkout splits; payouts via Transfers API | decided | 2026-10-28 | **P7-T01** | `docs/provider-capabilities.md` confirms transfers enabled; counsel confirms funds-flow legality (BR §14.5, §18.4) |
| DEC-011 | Organizer verification: NIN/DOB/phone/NUBAN (individual); CAC/TIN/corporate account (business) | decided | 2026-10-28 | **P4-T01** | Provider confirms NIN, NUBAN-name-match and CAC lookup availability; counsel confirms NIN handling under NDPA |
| DEC-012 | Post-approval edits: low-risk direct; high-risk via review | decided | 2026-10-28 | P5-T03, P5-T07 | none |
| DEC-013 | Suspension: admin-only, reason mandatory, reinstated by admin | decided | 2026-10-28 | P5-T06 | none |
| DEC-014 | Suspended >14 days or within 48h of start raises an alert forcing resolution | decided | 2026-10-28 | P5-T06 | none |
| DEC-015 | Deletion blocked with valid upcoming tickets; anonymise; keep financial rows 6 years | decided | 2026-10-28 | P3-T06, P10-T03 | Counsel: 6-year statutory period and what may be retained |
| DEC-016 | 10-minute reservation, +5 minute grace on payment initiation | decided | 2026-10-28 | P6-T02, P6-T06 | none; see PC-03 for exact extension rule |
| DEC-017 | Max 10 tickets/order (configurable per type), 20/customer/event | decided | 2026-10-28 | P6-T03 | none |
| DEC-018 | Support cases: `open`, `investigating`, `resolved`, `closed` | decided | 2026-10-28 | P10-T01 | none |
| DEC-019 | Double-entry ledger; provisional until accountant review | decided | 2026-10-28 | P7-T02 | **Accountant review before Phase 9** (R3) |
| DEC-020 | Align with NDPA/NDPR, FCCPA, CBN/fintech rules | decided | 2026-10-28 | P0-T06, P11-T02 | Counsel launch checklist |
| DEC-021 | Organizer cancels directly only with 0 tickets sold; otherwise request + admin approval | decided | 2026-10-28 | P5-T06, P8-T05 | none |
| DEC-022 | Late payment: reclaim inventory if possible else auto 100% refund; cancelled event → 100% refund | decided | 2026-10-28 | P7-T05, P8-T02 | See PC-01 (representation of `unfulfillable_late_payment`) |
| DEC-023 | Verified email required before checkout completes | decided | 2026-10-28 | P3-T03, P6-T04 | none |
| DEC-024 | MVP check-in: organizer plus time-bound scanner PIN/token | decided | 2026-10-28 | P7-T08 | none |
| DEC-025 | Clean cutover, parallel operation, no legacy data migration | decided | 2026-10-28 | P11-T09 | none |
| DEC-026 | One purchaser name per order; per-guest names post-MVP | decided | 2026-10-28 | P7-T07 | none |
| DEC-027 | Approval and publication are separate; organizer publishes | decided | 2026-10-28 | P5-T05 | none |

### Committed target phases (P0-T03 acceptance)

- **DEC-010** is confirmed against provider capabilities and counsel **before Phase 7 starts** (gate on `P7-T01`).
- **DEC-011** is confirmed against provider capabilities **before Phase 4 starts** (gate on `P4-T01`).
- **DEC-019** ledger design is reviewed by an accountant **before Phase 9 starts**.

## 2. Proposed clarifications (not yet decisions)

These gaps were found while writing `state-machines.md`. Each has a proposed resolution. A proposal becomes a decision only when you accept it; then change its status here, update the BR, and move it into the table above.

| ID | Gap | Proposed resolution | Needed by |
|---|---|---|---|
| PC-01 | DEC-022 says to "flag the order as `unfulfillable_late_payment`", but BR §9.5 lists only five order statuses and does not include it. | The order stays `expired`. Add a nullable `orders.exception_code` column (enum, first value `unfulfillable_late_payment`). Do not add a sixth order status. | P6-T04 (schema), P7-T05 |
| PC-02 | After an event is cancelled and all tickets refunded, the order's status stays `confirmed` and never reaches `completed` (completion requires the event to complete). | Keep this. The API exposes a derived `displayStatus` (`cancelled_event`) built from event status plus refund summary. No new order status. | P6-T07 |
| PC-03 | DEC-016's "+5 minute grace" is ambiguous (add 5 minutes to the remaining time, or guarantee 5 minutes from now). | `expires_at = greatest(expires_at, now() + interval '5 minutes')` when a payment attempt starts. | P6-T02 |
| PC-04 | DEC-007 and DEC-009 give ranges ("2–5 days", "70–80%"). Configuration needs one default each. | Defaults: release 3 days before event start; pre-event cap 70%; reserve 30%, held until 48h after event end. All admin-configurable. | P9-T01 |
| PC-05 | DEC-005 window is `min(7 days, until 48h before the new start)`. If the new start is less than 48h after approval, the window is zero. | Reject reschedule approval when the new start is less than 72h away, so every holder gets at least a 24h window. | P5-T07 |
| PC-06 | Which event states may an organizer cancel directly with 0 tickets sold? BR §21.2 only lists `published` and `suspended`. | Allow `draft`, `changes_requested`, `pending_review`, `approved` and `published` (organizer, zero-sales guard); `suspended` is admin-only. | P5-T06 |
| PC-07 | Can a ticket be checked in while its event is `suspended`? BR is silent. | Yes, for already-issued tickets. Suspension blocks new sales, not attendance. Cancelled events reject all check-ins. | P7-T08 |
| PC-08 | Should failed payment attempts be able to succeed later on the same provider reference? Provider-specific. | Assume **no** until `provider-capabilities.md` says otherwise. `abandoned → successful` is allowed (customer paid after our timeout). | P7-T05 |
| PC-09 | When is a payout row created (BR lists `pending` as a payout state)? | Create one payout row per organizer and event at the first confirmed order (`pending`); the settlement job moves it to `eligible`. | P9-T02 |
| PC-10 | Permission names. `finance:refund:process` (BR §19.3) is missing from `apps/api/src/lib/permissions.ts`, which has only four permissions. | Add `finance:refund:process`, `organizers:review`, `organizers:approve`, `events:suspend`, `events:cancel`, `config:settlement:write`, `audit:read`, `complaints:manage` in the task that first uses each. | P2-T08 follow-up, P4-T04 |

## 3. Change process

Decisions in §1 are the system baseline. Changing one is a controlled act, because a change can affect orders, balances or customer rights (BR §25).

1. **Raise a change request** as a pull request that edits this register. Describe the old position, the new position, and the reason.
2. **Assess impact** in the PR description: affected tasks, affected tables, affected existing orders, balances and customer commitments, and any legal or accounting review needed.
3. **Never apply retroactively by default.** A new rule takes effect from an explicit effective date. Existing orders keep the pricing and policy snapshot they were created with (BR §10.3, INV-13). If a change must touch existing records, it is done as an explicit, auditable adjustment (reversal or correcting entry), never by rewriting history (INV-14).
4. **Record it in the audit log** when the rule is configuration (fee rate, settlement policy): who, when, previous value, new value, reason.
5. **Update the sources of truth together** in the same PR: this register, the BR section, any affected ADR, `state-machines.md` or `api-contract.md`.
6. **Mandatory law outranks policy** (INV-24). If counsel's answer contradicts a decided policy (for example fee retention after cancellation), the legal outcome wins and the change is recorded here with the reference to the advice.
7. **Owner approval** is required to merge. The register is the only place where `decided` may be set.
