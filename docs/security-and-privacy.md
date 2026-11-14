# Security and Privacy

| | |
|---|---|
| **Document version** | 0.1.0 (skeleton, per P0-T05) |
| **Sources** | BR §5, §6, §17, §18, §19; ARCH §16, §17, §21; IMPL §9 |
| **Status** | Skeleton. Retention periods marked *proposed* are placeholders for counsel's confirmation (P0-T06). This is not legal advice. |
| **Updated by** | Every task that adds personal data or a security control |

## 1. Data classification

| Class | Definition | Examples | Handling |
|---|---|---|---|
| **Public** | Intended for anyone | Published event details, banners, category names | No restriction; validate content type on upload |
| **Internal** | Business data, not for the public | Fee configuration, job state, aggregate metrics, order totals without identity | Authenticated staff only; may appear in logs |
| **Personal** | Identifies a person | Name, email, phone, IP address, user agent, order history, ticket holder name | Least-privilege access; **masked or omitted in logs**; covered by retention and deletion rules |
| **Sensitive** | Personal data whose exposure causes serious harm | NIN, date of birth, bank account number (NUBAN), TIN, CAC filings, ID documents, TOTP secrets | Encrypted at rest; admin-only through audited, short-lived access; **never in logs, audit metadata, analytics or emails** |
| **Secret** | Credentials and keys | Password hashes, session tokens, reset and verification tokens, API keys, webhook secrets, HMAC keys, database passwords | Never logged, never in source control, never returned by the API; tokens stored only as hashes |

Rule: classify every new column or field when it is introduced (database-design checklist). If unsure, use the higher class.

## 2. Personal-data inventory (Phases 1 to 6; extended per phase)

| Data | Table or place | Class | Purpose | Lawful basis (to confirm with counsel) | Retention (proposed) |
|---|---|---|---|---|---|
| Name, email, password hash | `users` | Personal / Secret | Account and purchase | Contract | Life of account; anonymised on deletion (DEC-015) |
| Phone (optional) | `users` | Personal | Contact, organizer verification | Consent / contract | Life of account |
| IP and user agent | `sessions`, `audit_events` | Personal | Security and audit | Legitimate interest | Sessions: delete 30 days after expiry. Audit: with audit retention |
| Session token hash | `sessions` | Secret | Authentication | Contract | Delete on expiry plus 30 days |
| Verification and reset token hashes | token tables | Secret | Account security | Contract | Delete 7 days after use or expiry |
| Organizer legal name, DOB, NIN, bank account | `organizer_*`, verification | Sensitive | Identity verification (DEC-011) | Legal obligation / legitimate interest | Per counsel; **legally mandated compliance window** (BR §6.3) |
| CAC and ID documents | Private S3 bucket | Sensitive | Verification | As above | As above; access via 15-minute presigned URLs only |
| Orders, tickets, refunds, ledger | finance tables | Personal (by reference) | Fulfilment and accounting | Legal obligation | 6 years (DEC-015) |
| Complaint text | `support_cases` | Personal | Dispute handling | Legitimate interest | 3 years after closure (proposed) |
| Email content sent | provider logs | Personal | Notifications | Contract | Provider retention reviewed (ADR-030) |

## 3. Logging rules (apply to every log line and audit record)

**Never log:** passwords, password hashes, session tokens, CSRF tokens, reset or verification tokens, API keys, webhook secrets, HMAC keys, `Authorization` and `Cookie` headers, full card or bank numbers, NIN, DOB, ID documents, TOTP secrets, full request or response bodies for auth and payment routes.

**Log with care (mask or hash):** email (log a hash or the user id instead), IP address (truncate the last octet or hash), phone, name.

**Always log:** `requestId`, route, method, status, duration, user id (not name), entity id, outcome, error category, retry count.

**Enforcement:**
- The structured logger redacts a fixed path list (`req.headers.authorization`, `req.headers.cookie`, `*.password`, `*.token`, `*.secret`, `*.nin`, `*.accountNumber`, and similar). The list is tested (P1-T03 test for log redaction).
- Audit metadata uses a **per-action allow-list**: each audit action declares exactly which metadata keys it may carry. Anything else, at any nesting depth, is rejected (P2-T03 follow-up).
- Application logs and audit records have different purposes and different retention (ARCH §21.3).
- A PR checklist item asks: "does this change log or store any new personal or sensitive data?"

## 4. Access control summary

| Principle | Implementation |
|---|---|
| Deny by default | Route registry; startup fails on unregistered routes (P2-T08) |
| Server-side only | The frontend is never a security boundary (BR §5.2) |
| Ownership | Resource owner checked in the service layer; not-owner returns `404` (ADR-028) |
| Least privilege for admins | Granular permissions; no `is_admin` flag (BR §19.3) |
| High-risk admin actions | TOTP MFA plus password re-entry (C-14) |
| Sensitive documents | Private encrypted bucket; admin-only; 15-minute presigned URLs; each access audited |
| Database | Separate migration and application roles (`database-roles.md`); the application role cannot alter schema or modify audit rows |
| Secrets | Environment variables or a secret manager; validated at startup; never committed |

## 5. Retention schedule (proposed; counsel to confirm)

| Data | Retention | Mechanism |
|---|---|---|
| Idempotency keys | 24 hours after completion | cleanup job (`idempotency-cleanup`) |
| Rate-limit counters | Window length plus 1 hour | cleanup job |
| Completed outbox jobs | 30 days | cleanup job |
| Failed (dead-letter) jobs | Until resolved, then 90 days | admin action then cleanup |
| Notifications and attempts | 90 days | cleanup job |
| Sessions | Expiry plus 30 days | cleanup job |
| Email verification and reset tokens | 7 days after use or expiry | cleanup job |
| Audit events | 6 years (aligns with financial records) | append-only; archive after 2 years |
| Orders, tickets, refunds, ledger, payouts | 6 years (DEC-015) | retained; user reference pseudonymised on deletion |
| Organizer verification records | **Legally mandated window; to be set by counsel** | restricted storage |
| Support cases | 3 years after closure | cleanup job |
| Anonymised user shells | Retained as long as referenced financial rows exist | none |

Retention jobs are delivered in P10-T04. Until then, only the operational-table jobs above are required.

## 6. Account deletion and data-subject requests (BR §5.3, DEC-015)

1. Authenticate the requester and require password re-entry.
2. Block with `DELETION_BLOCKED` if the user holds valid tickets for upcoming events or has unresolved refund requests or disputes.
3. Otherwise, in one transaction: revoke all sessions; replace name, email, phone and password hash with placeholders (`deleted_user_<id>`); remove tokens and subscriptions; set `anonymised_at`; write an audit record that does not repeat the erased data.
4. Keep order, ticket, refund and ledger rows under the pseudonymised user id for the statutory period.
5. Access and export requests: a documented manual procedure in the MVP (owner: to be named), automated in P10-T03.

## 7. Processor register (skeleton, completed in P0-T06)

| Processor | Data shared | Location | Contract and review status |
|---|---|---|---|
| Hosting and managed PostgreSQL | All application data | TBD | Pending |
| Email provider (ADR-030) | Recipient email, name, message content | TBD | Pending |
| Payment provider (Paystack or Flutterwave) | Customer email, amounts, references; organizer bank details for transfers | TBD | Pending; see `provider-capabilities.md` |
| Object storage (ADR-022) | Event media (public); verification documents (private) | TBD | Pending |
| Error monitoring | Error context; must exclude personal data | TBD | Pending |
| Identity verification provider (DEC-011) | NIN, DOB, name, bank account | TBD | Pending |

## 8. Incident and breach response (skeleton)

| Item | Status |
|---|---|
| Named owner for breach response | **To be assigned by the owner** (P0-T06) |
| Statutory notification deadlines under the NDPA | To be confirmed by counsel |
| Evidence available for investigation | Audit events, structured logs with request ids, session records, job history |
| Runbook | `docs/runbooks/` (P11-T08) |

## 9. Controls and where they are introduced

| Control | Introduced | Status at Phase 2 exit |
|---|---|---|
| Fail-fast environment validation; no secret logging | P1-T03 | Implemented |
| PII-safe structured logging | P1-T03 | Redaction test required |
| Database roles with least privilege | P1-T02 (design), P1-T07 (staging) | Design only; implement grants |
| Immutable audit log | P2-T03 | Table and trigger done; allow-list pending |
| Security headers, CORS, body limits, rate limiting | P2-T07 | Wired into the app |
| Deny-by-default authorisation and route registry | P2-T08 | Wired into the app |
| Password hashing, enumeration-safe responses | P3-T01 | Not started |
| Session security and CSRF | P3-T02 | Not started (ADR-018) |
| Admin MFA and step-up | P4-T04 | Not started |
| Webhook signature verification on the raw body | P7-T04 | Not started |
| Non-forgeable ticket credentials | P7-T07 | Not started |
| Encryption of stored payout destinations | P9-T03 | Not started |
| Dependency and secret scanning in CI | P1-T04 | Verify present |
| Backups with tested restoration | P1-T07, P11-T05 | Enable at staging |
