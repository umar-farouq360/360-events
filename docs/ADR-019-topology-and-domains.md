# ADR-019: Deployment topology and domains

Status: Accepted (clarification proposed)
Recorded: 2026-11-14 (accepted baseline: `implementation-plan.md` §4.2)
Unblocks: P1-T07, P3-T02, P7-T04
Satisfies: ARCH §20; C-23

## Context

Cookie behaviour (ADR-018), CORS, webhook URLs and staging deployment all depend on the domain plan. P0-T02 requires a domain and DNS plan for staging and production.

## Decision

| Purpose | Production | Staging |
|---|---|---|
| Web app (static) | `app.360events.ng` | `app.staging.360events.ng` |
| API | `api.360events.ng` | `api.staging.360events.ng` |
| Worker | no public hostname | no public hostname |
| Payment webhook | `https://api.360events.ng/api/v1/webhooks/paystack` | `https://api.staging.360events.ng/api/v1/webhooks/paystack` |
| Email sending domain | `mail.360events.ng` (SPF, DKIM, DMARC, ADR-030) | `mail.staging.360events.ng` |

- Web and API share the registrable domain `360events.ng`, so credentialed requests are same-site.
- The worker is a separate process with its own health endpoint on a private port, reachable only by the platform.
- Managed PostgreSQL is reachable only from API and worker (private network or IP allow-list).
- TLS everywhere. `Strict-Transport-Security` is set by the API; the web host sets it for its own origin.
- CORS allow-list (`ALLOWED_ORIGINS`) contains exact origins only, per environment. Never `*`, never a regex.
- Staging uses test-mode provider keys, a separate database, a separate mail sender and separate secrets. No production data enters staging.

## Consequences

- The registrable domain `360events.ng` must be registered and DNS access available before P1-T07.
- Because staging and production share a registrable domain, cookies must be host-only (see ADR-018's proposed change).

## Revisit trigger

A CDN or hosting provider forces a different hostname scheme; a second market needs another domain; web moves behind the API origin (same-origin proxy).
