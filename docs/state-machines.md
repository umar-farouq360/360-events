# State-Machine Specification

| | |
|---|---|
| **Document version** | 0.1.0 |
| **Created by** | P0-T04 |
| **Sources** | BR §6, §7, §8, §9.5, §12–14, §21; ARCH §7–13; C-09, C-10, C-11; DEC-001 to DEC-027 |
| **Status** | Draft for owner approval (Phase 0 exit criterion) |
| **Updated by** | Any task that changes a lifecycle |

## 1. How to read this document

Every lifecycle below has four parts: **states**, **transitions** (with actor, guard and side effects), **terminal states**, and **illegal transitions**.

**Rule 0.** Any transition not listed in a machine's transition table is illegal. The "Illegal transitions" list names the ones that most need a test; it is not exhaustive.

### 1.1 Enforcement pattern (applies to every machine)

1. **Allowed-transition table in code** using `TransitionTable<T>` and `assertCanTransition` (`apps/api/src/lib/transitions.ts`). This gives a fast, readable rejection.
2. **Database guard** using `executeTransition`: `UPDATE ... SET status = :to WHERE id = :id AND status = :from RETURNING *`. If zero rows return, another caller already moved the entity. The loser returns `409 INVALID_TRANSITION` or treats the call as an idempotent no-op, depending on the operation. This guard is what makes two simultaneous callers safe.
3. **History row** written in the same transaction (`<entity>_status_history`: entity id, from, to, actor type, actor id, reason, request id, timestamp).
4. **Side effects** that must happen with the transition (tickets issued, ledger entries posted, outbox events enqueued) are part of the **same database transaction**. Side effects on external systems (email, provider calls) are enqueued through the outbox, never executed inside the transaction.
5. **Constraints** (`CHECK`, partial unique indexes, foreign keys) back up the rules that must hold even if application code is wrong.

### 1.2 Actors

`customer`, `organizer` (owner of the event), `admin` (with a named permission), `system` (API-internal rule), `worker` (background job), `provider` (verified webhook or provider API result). A transition by `provider` is only ever applied after signature verification and re-verification against the provider API (INV-08).

### 1.3 Permissions referenced

`events:approve` and `finance:payout:approve` exist today. Others used here (`organizers:review`, `organizers:approve`, `events:suspend`, `events:cancel`, `finance:refund:process`, `config:*`) are proposed in `decision-register.md` PC-10.

---

## 2. Organizer application (BR §6.1, §21.1)

**States:** `draft`, `submitted`, `under_review`, `additional_information_required`, `approved`, `rejected`, `withdrawn`.

| # | From → To | Actor | Guard | Side effects |
|---|---|---|---|---|
| A1 | draft → submitted | customer (applicant) | Required fields complete for the applicant type; email verified; no other non-terminal application for this user (partial unique index) | Audit; confirmation email; outbox: run verification checks |
| A2 | draft → withdrawn | customer | Applicant is owner | Audit |
| A3 | submitted → under_review | admin `organizers:review` | Verification checks recorded | Audit |
| A4 | submitted → withdrawn | customer | Applicant is owner (only before review starts) | Audit |
| A5 | under_review → additional_information_required | admin `organizers:review` | Reason text required | Audit; email asking for information |
| A6 | additional_information_required → under_review | customer | Applicant is owner; requested information supplied | Audit |
| A7 | additional_information_required → withdrawn | customer | Applicant is owner | Audit |
| A8 | additional_information_required → rejected | admin `organizers:approve` | Reason required | Audit; email |
| A9 | under_review → approved | admin `organizers:approve` + MFA step-up | Verification result is `passed`; **reviewer is not the applicant** (INV-20); reviewer id and time recorded | **Same transaction:** grant organizer role; audit; email |
| A10 | under_review → rejected | admin `organizers:approve` | Reason required | Audit; email |

**Terminal:** `approved`, `rejected`, `withdrawn`. A rejected applicant may file a new application (a new row), not reopen the old one.

**Illegal transitions (tests):** any transition out of a terminal state; `draft → under_review`; `draft → approved`; `submitted → approved` (skipping review); applicant approves their own application; approve without a passed verification result; approve without MFA step-up; a second open application for the same user; role granted when status is anything but `approved`.

---

## 3. Event (BR §7, §21.2; C-05 to C-08; DEC-012, -013, -014, -021, -027)

**States:** `draft`, `pending_review`, `changes_requested`, `approved`, `published`, `suspended`, `cancelled`, `completed`, `rejected`.

| # | From → To | Actor | Guard | Side effects |
|---|---|---|---|---|
| E1 | draft → pending_review | organizer (owner) | Organizer active and not suspended; all required fields valid; at least one ticket type in `draft` or `active` | History; audit; notify reviewers |
| E2 | pending_review → approved | admin `events:approve` | **Admin is not the event's organizer** (INV-04, §5.4) | History; audit; email organizer |
| E3 | pending_review → changes_requested | admin `events:approve` | Reason required | History; audit; email |
| E4 | changes_requested → pending_review | organizer (owner) | Fields valid | History |
| E5 | pending_review → rejected | admin `events:approve` | Reason required | History; audit; email |
| E6 | approved → published | **organizer (owner) only** (DEC-027) | Organizer active; start time in the future; sales window valid; at least one `active` ticket type | History; audit; event becomes publicly discoverable |
| E7 | published → suspended | admin `events:suspend` + MFA step-up | **Reason required**; record `suspended_at` | History; audit; new reservations blocked immediately; email organizer; start the DEC-014 monitor |
| E8 | suspended → published | admin `events:suspend` + MFA step-up | Reason required | History; audit; sales resume; clear monitor |
| E9 | published → cancelled | organizer (owner) | **Zero confirmed tickets and no order in `pending`** (DEC-021) | History; audit; start cancellation run (§11) |
| E10 | published → cancelled | admin `events:cancel` + MFA step-up | Reason required | As E9, plus refunds (§11) |
| E11 | suspended → cancelled | admin `events:cancel` + MFA step-up | Reason required | As E10 |
| E12 | draft / changes_requested / pending_review / approved → cancelled | organizer (owner) | Zero sales by definition (PC-06) | History; audit |
| E13 | published → cancelled | system | An approved cancellation request exists (§11) | As E10 |
| E14 | published → completed | worker | `now() >= ends_at` and status is `published` | History; outbox: complete orders, evaluate payout eligibility |

**Related, not event states:** rescheduling and high-risk edits go through a reschedule request (§13). Low-risk edits (description, FAQs, banners, contact links) do not change status.

**Terminal:** `rejected`, `cancelled`, `completed`.

**Illegal transitions (tests):** `draft → approved`, `draft → published`, `pending_review → published`; `approved → pending_review`; `published → approved/draft/pending_review`; `suspended → approved`; `suspended → completed` (must be reinstated or cancelled first, DEC-014); anything out of `rejected`, `cancelled`, `completed`; **admin publishing on behalf of an organizer**; organizer approving, rejecting, suspending or reinstating; **organizer cancelling a published event with tickets sold** (returns `409 CANCELLATION_REQUIRES_APPROVAL`); an organizer approving their own event; a new reservation on any status other than `published`.

**Operational alert (DEC-014):** a job raises a critical alert when an event has been `suspended` for more than 14 calendar days or is `suspended` within 48 hours of `starts_at`.

---

## 4. Ticket type (BR §8.1)

**States:** `draft`, `active`, `paused`, `archived`. "Sold out" and "on sale now" are **derived** (capacity, sold count, sales window, event status) and never stored.

| # | From → To | Actor | Guard | Side effects |
|---|---|---|---|---|
| T1 | draft → active | organizer (owner) | `price_kobo >= 0`; `capacity > 0`; sales window valid | History |
| T2 | active → paused | organizer (owner) | — | History |
| T3 | paused → active | organizer (owner) | — | History |
| T4 | draft / active / paused → archived | organizer (owner) | Archiving stops new sales only. Existing reservations finish; issued tickets stay valid. | History; audit |

**Terminal:** `archived`.

**Direct edits:** description and per-order limit edits are allowed directly. **Price and capacity of an `active` type on an `approved` or `published` event** are high-risk edits (DEC-012) and require a reschedule/change review (§13). Adding a new ticket type to a published event is allowed (proposed).

**Illegal transitions (tests):** anything out of `archived`; price or capacity changed directly on an active tier with sales; `capacity < sold + reserved` (database `CHECK`); another organizer editing the type.

---

## 5. Reservation (BR §8.3; DEC-016, DEC-022)

**States:** `active`, `consumed`, `expired`, `released`.

| # | From → To | Actor | Guard | Side effects |
|---|---|---|---|---|
| R1 | (create) → active | system, inside order creation | Conditional inventory claim succeeds: `sold + reserved + qty <= capacity` | `reserved += qty`; `expires_at = now() + 10 min` |
| R2 | active → active (extend) | system, when a payment attempt starts | `expires_at = greatest(expires_at, now() + 5 min)` (PC-03) | none |
| R3 | active → consumed | system, in the order-confirmation transaction | Payment verified or order is free | `reserved -= qty`, `sold += qty` |
| R4 | active → expired | worker | `expires_at <= now()` **and** no payment attempt in `processing` or `pending_verification` | `reserved -= qty` (exactly once); order → `expired` |
| R5 | active → released | system | Order cancelled by customer, or event cancelled, or payment finally failed and checkout abandoned | `reserved -= qty` (exactly once) |
| R6 | expired → consumed | system, late-payment recovery | Verified payment arrived **and** inventory claim succeeds again in the same transaction | `sold += qty`; order `expired → confirmed`; tickets issued |

**Terminal:** `consumed`, `released`. `expired` is terminal except for R6.

**Illegal transitions (tests):** `consumed → active`; `released → active`; `expired → active` (a hold is never resurrected; R6 re-claims inventory instead); **double release or double expiry returning inventory twice** (the conditional update lets only one caller win); expiring a reservation whose payment is in flight inside the grace window; `reserved < 0` or `sold + reserved > capacity` (database `CHECK`).

---

## 6. Order (BR §9.5, §21.3; C-09, ADR-011)

**States:** `pending`, `confirmed`, `completed`, `cancelled`, `expired`.

**Not states:** refund outcome (derived `refund_status` = `none | partial | full`, and `refunded_amount_kobo`) and payment progress. See PC-01 for `unfulfillable_late_payment` (a nullable `exception_code`, order stays `expired`).

| # | From → To | Actor | Guard | Side effects |
|---|---|---|---|---|
| O1 | (create) → pending | customer | Email verified (DEC-023); event `published`; limits respected; `expectedTotalKobo` matches server price (else `409 PRICE_CHANGED`); idempotency key present | Reservation created; pricing snapshot stored |
| O2 | pending → confirmed | system | A `successful` payment attempt for the full total, matched on reference, amount and currency; or total is `0` (free order) | **Same transaction:** reservation consumed; tickets issued; ledger entries posted (paid orders); outbox: confirmation email and ticket email |
| O3 | pending → cancelled | customer | No payment attempt in `processing` or `pending_verification` | Reservation released |
| O4 | pending → cancelled | system | Event cancelled (cancellation run) | Reservation released; if a payment later succeeds, see W1 |
| O5 | pending → expired | worker | Reservation expired (R4) | Inventory released |
| O6 | expired → confirmed | system | Late payment verified and inventory re-claimed (R6) | As O2 |
| O7 | confirmed → completed | worker | Event status is `completed` | History |

**Terminal:** `cancelled`, `completed`. `expired` is terminal except for O6.

**Refund summary rule:** `refund_status` and `refunded_amount_kobo` change only when a refund reaches `succeeded` (§8), inside that transaction. Requested, approved and processing refunds do not change them.

**Cancelled-event orders (PC-02):** their status stays `confirmed` and is never completed; the API shows a derived `displayStatus`.

**Illegal transitions (tests):** `confirmed → pending/cancelled/expired`; anything out of `completed` or `cancelled`; `expired → cancelled`; `pending → completed`; `cancelled → confirmed` (a payment after cancellation produces a refund, not a ticket); confirming without a successful attempt (except free); confirming with a mismatched amount; editing totals or snapshot after creation.

---

## 7. Payment attempt (BR §9.5, §11, §21.4; C-09, C-10)

**States:** `pending`, `processing`, `pending_verification`, `successful`, `failed`, `abandoned`, `not_required`.

| # | From → To | Actor | Guard | Side effects |
|---|---|---|---|---|
| P1 | (create) → pending | system | Order is `pending`; event not cancelled | Reservation extended (R2); outbox: initialise with provider |
| P2 | (create) → not_required | system | Order total is `0` | Created already final |
| P3 | pending → processing | system | Provider accepted initialisation and returned a URL | Store provider reference |
| P4 | pending → failed | system | Provider rejected initialisation | none |
| P5 | pending / processing → abandoned | worker | Timeout, or provider reports abandoned | none |
| P6 | processing → pending_verification | system | Provider response uncertain, timeout, or webhook delayed | Outbox: verify with provider (backoff) |
| P7 | processing / pending_verification → successful | provider (verified) | **Signature valid; provider re-verify matches reference, amount and currency, order**; no other successful attempt for the order (partial unique index) | Order confirmation (O2/O6) or refund path (§Walkthroughs W1, W2); ledger entries |
| P8 | processing / pending_verification → failed | provider (verified) | Provider reports a final failure | none |
| P9 | pending_verification → abandoned | worker | Provider reports not paid after the window | none |
| P10 | abandoned → successful | provider (verified) | Verified success arrives after we timed out (PC-08) | Late-payment path (W2) |

**Terminal:** `successful`, `failed`, `not_required`. `abandoned` is terminal except for P10.

**Duplicate or redundant payment:** if a second attempt becomes `successful` while the order already has a successful one, record it, mark it `duplicate`, and create an automatic 100% refund (C-11).

**Amount mismatch:** never move to `successful`. Stay in `pending_verification`, raise a reconciliation exception, and require admin review.

**Illegal transitions (tests):** anything out of `successful`; `failed → processing`; `failed → successful` (until provider docs allow it, PC-08); marking success from a frontend redirect or an unsigned webhook (INV-08, INV-09); two `successful` attempts counted for one order; applying one provider event twice (unique provider event id).

---

## 8. Refund (BR §13, §21.5; INV-15, INV-16; DEC-004, -005, -006)

**States:** `requested`, `approved`, `processing`, `succeeded`, `rejected`, `failed`.

| # | From → To | Actor | Guard | Side effects |
|---|---|---|---|---|
| F1 | (create) → requested | customer support request, organizer-cancellation run, or policy engine | Amount `<= remaining refundable` computed under a row lock on the order | History; audit |
| F2 | requested → approved | admin `finance:refund:process`, **or** system for automatic refunds (late payment, duplicate payment, event-cancelled payment) | For admin: reason; amount re-checked under lock | Audit; outbox: execute refund |
| F3 | requested → rejected | admin `finance:refund:process` | Reason required | Audit; email |
| F4 | approved → processing | worker | Provider idempotency key = refund id; amount re-checked under lock | Provider call |
| F5 | processing → succeeded | provider (verified) | Provider confirms | **Same transaction:** order `refund_status` and `refunded_amount_kobo` updated; tickets revoked (§9); ledger completion; outbox: email |
| F6 | processing → failed | provider (verified) | Final provider failure | Alert; audit |
| F7 | failed → processing | worker or admin | Provider confirms no refund exists for this reference; **same idempotency key** | Provider call |

**Terminal:** `succeeded`, `rejected`. `failed` is retryable.

**Alerts:** `approved` not `processing` after 24 hours; `processing` not `succeeded` after 72 hours (DEC-006).

**Refundable amount:** `refundable = eligible_amount_for_reason − Σ(refunds in approved, processing, succeeded)`. Fee retention follows the reason (decision register DEC-004, DEC-005, C-11).

**Illegal transitions (tests):** `requested → processing` (INV-16: approval is distinct from execution); `requested → succeeded`; `approved → succeeded` without provider confirmation; anything out of `succeeded` or `rejected`; `rejected → approved` (create a new request); a refund that pushes the total over the refundable amount; two concurrent refunds both passing the check.

---

## 9. Ticket (BR §12; INV-11, INV-12)

**States:** `valid`, `checked_in`, `revoked`.

| # | From → To | Actor | Guard | Side effects |
|---|---|---|---|---|
| K1 | (issue) → valid | system, in order confirmation | Unique `(order_item_id, sequence)` (INV-11); order is `confirmed` | Credential generated (ADR-026) |
| K2 | valid → checked_in | organizer or scanner token | `UPDATE ... WHERE status = 'valid'` returns one row; credential verifies; ticket belongs to this event; event not `cancelled` (PC-07) | Record time and operator |
| K3 | valid → revoked | system, admin | Refund succeeded, event cancelled, fraud, or admin correction; reason required | Audit; original row kept (BR §12.4) |
| K4 | checked_in → revoked | admin only | Reason required (fraud) | Audit |

**Terminal:** `revoked`. `checked_in` is terminal except for K4.

**Concurrent scans:** two simultaneous scans produce exactly one `checked_in` and one `409 ALREADY_REDEEMED`.

**Corrections:** a wrongly revoked ticket is replaced by issuing a new ticket linked to the old one, never by un-revoking.

**Illegal transitions (tests):** `checked_in → valid` (no undo); anything out of `revoked`; check-in of a revoked ticket; check-in at another event; a second ticket issued for the same order item and sequence.

---

## 10. Payout and payable allocation (BR §14; DEC-007 to -009; INV-17, INV-18)

### 10.1 Payout

**States:** `pending`, `eligible`, `processing`, `paid`, `failed`, `cancelled`, `on_hold`.

| # | From → To | Actor | Guard | Side effects |
|---|---|---|---|---|
| Y1 | (create) → pending | system | First confirmed order for the event (PC-09) | none |
| Y2 | pending → eligible | worker | Settlement milestone reached; payable `>=` minimum (₦2,000); no hold | Allocations created (§10.2); notify admins |
| Y3 | pending / eligible → on_hold | admin | Reason required; store `held_from` | Audit |
| Y4 | on_hold → pending / eligible | admin | Return to `held_from` | Audit |
| Y5 | eligible → processing | admin `finance:payout:approve` + MFA + password re-entry | Destination verified; **approver is not the organizer**; allocations `reserved` | Allocations → `committed`; outbox: transfer with idempotency key = payout id |
| Y6 | eligible → cancelled | admin | Reason required | Allocations released |
| Y7 | processing → paid | provider (verified) | Transfer confirmed | Allocations → `settled`; ledger entries; email |
| Y8 | processing → failed | provider (verified) | Provider confirms failure | Alert |
| Y9 | failed → processing | admin | Provider confirms no transfer exists for the reference; destination corrected if needed; same idempotency key | Provider call |
| Y10 | failed → cancelled | admin | Reason required | Allocations released |

**Terminal:** `paid`, `cancelled`.

**Uncertain outcome:** if a transfer call times out, the payout stays `processing` with `outcome_unknown_since` set. No new transfer is sent until a provider lookup answers (see W4).

**Illegal transitions (tests):** `pending → processing`; `pending → paid`; `eligible → paid`; `processing → eligible`; anything out of `paid` or `cancelled`; approval while `on_hold`; approval without `finance:payout:approve`, MFA or password re-entry; two admins approving at once (only one wins); payout amount above allocated payable.

### 10.2 Payable allocation

**States:** `reserved`, `committed`, `settled`, `released`.

| # | From → To | Actor | Guard |
|---|---|---|---|
| L1 | (create) → reserved | worker, with payout Y2 | Partial unique index: a ledger payable line has at most one live allocation (`reserved`, `committed`, `settled`) (INV-18) |
| L2 | reserved → committed | system, with Y5 | Payout is `processing` |
| L3 | committed → settled | system, with Y7 | Payout is `paid` |
| L4 | reserved → released | system, with Y6/Y10 or event cancellation | — |
| L5 | committed → released | system, with Y10 | Provider confirmed no transfer exists |

**Terminal:** `settled`, `released`. A released line can be allocated again only by a new allocation row.

**Illegal transitions (tests):** anything out of `settled`; `released → committed`; one payable line in two live allocations; `settled` without a `paid` payout.

---

## 11. Cancellation request and cancellation run (BR §7.5; DEC-021; ARCH §13)

### 11.1 Cancellation request (organizer asks when tickets are sold)

**States:** `pending`, `approved`, `rejected`, `withdrawn`.

| # | From → To | Actor | Guard | Side effects |
|---|---|---|---|---|
| Q1 | (create) → pending | organizer (owner) | Event `published` or `suspended`; tickets sold `> 0`; reason required | Audit; notify admins |
| Q2 | pending → approved | admin `events:cancel` + MFA step-up | Reason | **Same transaction:** event → cancelled (E13); cancellation run created |
| Q3 | pending → rejected | admin `events:cancel` | Reason required | Email |
| Q4 | pending → withdrawn | organizer | — | Audit |

### 11.2 Cancellation run (orchestration after any cancellation)

**States:** `pending`, `running`, `completed`, `needs_attention`.

Steps (each idempotent, keyed by run id and step name): block new sales; release active reservations and cancel pending orders (O4); revoke issued tickets (K3); create refunds (F1/F2) per policy; release or reverse payable allocations (L4); notify customers and organizer.

| # | From → To | Actor | Guard |
|---|---|---|---|
| X1 | (create) → pending | system | Created in the same transaction as the event's move to `cancelled` |
| X2 | pending → running | worker | Claimed by one worker |
| X3 | running → completed | worker | All steps done. Refund execution continues separately and is tracked by each refund |
| X4 | running → needs_attention | worker | A step failed after retries |
| X5 | needs_attention → running | admin or worker | Retry; completed steps are skipped |

**Terminal:** `completed`.

**Illegal transitions (tests):** `completed → running`; creating a run for an event that is not `cancelled`; two runs for one event (unique index); a step re-executed producing a second refund or second revocation.

---

## 12. Job and outbox record (ARCH §9; ADR-021; `outbox_events`)

**States:** `pending`, `processing`, `completed`, `failed` (failed with `attempts = max_attempts` is the dead letter).

| # | From → To | Actor | Guard | Side effects |
|---|---|---|---|---|
| J1 | (create) → pending | any code in the business transaction | Unique `dedupe_key` | none |
| J2 | pending → processing | worker | Claimed with `FOR UPDATE SKIP LOCKED`; `run_at <= now()`; sets `locked_by`, `lease_expires_at` | Attempt counted |
| J3 | processing → completed | worker | `locked_by` equals this worker (compare-and-set) | `completed_at` |
| J4 | processing → pending | worker | Retryable failure and `attempts < max_attempts`; `run_at = now() + backoff` | `last_error` |
| J5 | processing → pending | worker | Lease expired (crashed worker) and reclaimed | none |
| J6 | processing → failed | worker | `attempts >= max_attempts` | `last_error`; alert |
| J7 | failed → pending | admin | Manual requeue; resets attempts; audited | Audit |

**Terminal:** `completed`. `failed` is a dead letter awaiting an admin decision.

**Database guards already in the schema:** `attempts` between 0 and `max_attempts`; `processing` requires `locked_by` and `lease_expires_at`; unique `dedupe_key`.

**Illegal transitions (tests):** `completed → anything`; `pending → completed` (skipping `processing`); a **stale worker** completing a job after its lease was reclaimed (CAS on `locked_by` rejects it); `failed → processing` directly; two workers claiming the same job.

---

## 13. Supplementary lifecycles

### 13.1 Reschedule request (BR §7.4; DEC-005, DEC-012)

**States:** `pending`, `approved`, `rejected`, `withdrawn`. Created by the organizer; `pending → approved | rejected` by admin (`events:approve`); `pending → withdrawn` by organizer. **On approval, in one transaction:** apply the new date or venue; open a refund window for all ticket holders that closes at `least(approved_at + 7 days, new_start − 48h)` (PC-05); enqueue notifications to every holder. Terminal: all three outcomes.

### 13.2 Support case (BR §16.3; DEC-018)

**States:** `open`, `investigating`, `resolved`, `closed`. `open → investigating → resolved → closed`; `resolved → investigating` (reopen) allowed; `open → closed` for duplicates with a reason. Terminal: `closed`.

### 13.3 Idempotency key (implemented, P2-T05)

**States:** `in_progress`, `completed`. A key `in_progress` longer than 60 seconds is reclaimable by one retry (compare-and-set); `completed` keys replay the stored response; keys expire after 24 hours; a 5xx response removes the key so the client can retry.

---

## 14. Table-top walkthroughs (expected outcomes recorded before code)

These are reused as test specifications.

### W1. Event cancelled during checkout

**Setup:** customer A has a `pending` order (reservation active). Customer B has a `pending` order with a payment attempt in `processing`. An admin cancels the event.

| Step | Expected outcome |
|---|---|
| Event cancel transaction | Event → `cancelled`; cancellation run created (X1). New reservations rejected from this moment. |
| Run, order A (no payment attempt) | Reservation → `released`; order → `cancelled` (O4); inventory returned once; no refund; email "event cancelled". |
| Run, order B (payment in flight) | Order → `cancelled`; reservation → `released`; attempt stays `processing`. |
| Provider later confirms B's payment | Attempt → `successful`; order stays `cancelled`; **no ticket issued**; automatic refund for **100% (ticket + fee)** created and approved by system (DEC-022); ledger shows payment then refund; email to B. |
| Race: confirmation and cancellation at the same instant | The confirmation transaction takes a share lock on the event row and the cancel transaction takes an exclusive lock. If confirmation commits first, the order is `confirmed` and the run revokes its ticket and refunds per the organizer-cancellation policy. If cancellation commits first, confirmation sees `cancelled` and takes the 100% path above. Never a ticket for a cancelled event, never a lost payment. |

### W2. Late payment after expiry

**Setup:** order pending, reservation expires at 10:00. The reservation expiry job runs at 10:00 and expires it; the order becomes `expired`. The provider's success webhook arrives at 10:02.

| Branch | Expected outcome |
|---|---|
| Inventory still available | Verified success → attempt `abandoned/processing → successful`; in one transaction re-claim inventory (R6), order `expired → confirmed` (O6), tickets issued, ledger posted, email sent. |
| Sold out | Attempt → `successful`; order stays `expired` with `exception_code = unfulfillable_late_payment` (PC-01); automatic refund for **100% (ticket + fee)** created and approved; ledger shows payment then refund; email explaining the refund; stall alert if not `succeeded` within 72h. |
| Event cancelled meanwhile | 100% automatic refund (W1 rule). |
| Event suspended meanwhile | The order was already `expired`, so it is **not** "pending payment"; treat as the sold-out branch: refund 100%. Only orders that were still `pending` when suspension began are honoured (BR §8.3). |
| Payment began before expiry | The attempt extended the reservation (R2). The expiry job skips reservations whose attempt is `processing` or `pending_verification` until the grace time passes, so most late payments never reach this path. |
| Duplicate webhook | The unique provider-event id and the conditional transition make the second delivery a no-op. |

### W3. Concurrent double refund

**Setup:** order total ₦10,500 (ticket ₦10,000 + fee ₦500), refundable for this reason ₦10,000. Two admins approve a full refund at the same moment, or an admin and the policy engine both try.

| Step | Expected outcome |
|---|---|
| Both begin | Each transaction locks the order row (`FOR UPDATE`) and recomputes `remaining = refundable − Σ(approved, processing, succeeded)`. |
| First transaction | Sees ₦10,000 remaining, approves ₦10,000. |
| Second transaction | Sees ₦0 remaining; returns `409 REFUND_EXCEEDS_REMAINING`. If it carried the same `Idempotency-Key`, it replays the first response instead. |
| Execution | Exactly one provider refund, using the refund id as the provider idempotency key. A worker retry cannot create a second one. |
| Final state | One non-rejected refund; one ledger refund entry set; tickets revoked once; one email; order `refund_status = full` only after `succeeded`. Two partial refunds whose sum is within the refundable amount are both allowed. |

### W4. Payout timeout

**Setup:** an admin approves a payout (Y5). The worker calls the transfer API with idempotency key = payout id; the call times out with no response.

| Step | Expected outcome |
|---|---|
| Timeout | Payout stays `processing`; `outcome_unknown_since` is set; **no second transfer is sent**. |
| Verification job | Looks up the transfer by reference with backoff. |
| Provider says success | Payout → `paid` (Y7); allocations → `settled`; ledger posted; email. A webhook arriving at the same time is a no-op because the transition is a compare-and-set. |
| Provider says failed | Payout → `failed` (Y8); allocations stay `committed`; alert; admin retries (Y9) or cancels (Y10). |
| Provider confirms no such transfer | Safe to retry with the **same** idempotency key. |
| Still unknown after 24 hours | Critical alert; manual investigation. Allocations stay locked so the same money cannot be paid by another payout. |
