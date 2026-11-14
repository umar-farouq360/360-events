# ADR-030: Email provider and sending domain

Status: Accepted
Recorded: 2026-11-14 (accepted baseline: `implementation-plan.md` §4.2)
Unblocks: P2-T06, P3-T03
Satisfies: BR §17; ARCH §5.11; INV-10

## Decision

- Use a dedicated transactional email provider (provider selection is recorded in `docs/provider-capabilities.md`, P0-T06). Marketing email is out of scope.
- Send from a dedicated subdomain (`mail.360events.ng`, per ADR-019) with SPF, DKIM and DMARC records published and verified before any real send.
- The provider is a data processor under the NDPA: it is listed in the processor register and its data handling and hosting location are reviewed by counsel before launch.
- Code depends on an `EmailAdapter` interface with two implementations: a mail-catcher adapter for local and test, and the production adapter. Selection is by configuration.
- Email is never the source of truth. A failed send never reverses a payment, refund or order (BR §17). Sending runs through the notification pipeline (`notifications`, `notification_attempts`, outbox job) with retries and a per-notification dedupe key.
- Emails contain the minimum personal data needed. No full card data, no secrets, and verification or reset links carry single-use expiring tokens.

## Consequences

DNS access for the sending subdomain is needed before staging goes live.

## Revisit trigger

Deliverability problems, provider pricing or compliance findings, or a need for in-app notifications (deferred by C-16).
