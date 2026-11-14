# ADR-018: Authentication and session model

Status: Accepted (refinement proposed, see "Proposed change")
Recorded: 2026-11-14 (accepted baseline: `implementation-plan.md` §4.2)
Unblocks: P3-T02, P3-T03, P3-T04, P4-T04
Satisfies: BR §5.1, §19.1, §19.3; ARCH §16; C-04, C-14

## Context

The browser web app calls a separate API. BR §5.1 requires secure session handling and revocation after security-sensitive changes. ARCH §16.1 left a conflict: it names the cookie `__Host-session`, but also scopes it to `.360events.ng`. Those cannot both be true. The `__Host-` cookie prefix requires the cookie to have no `Domain` attribute (host-only), so a `Domain=.360events.ng` cookie must use `__Secure-` instead.

## Options considered

| Option | Result |
|---|---|
| Bearer JWT in `localStorage` | Rejected. XSS can steal it, and revocation is hard. |
| Short JWT in memory plus refresh cookie | Rejected for MVP. More moving parts, no benefit over database sessions at this scale. |
| Server-side sessions, opaque token, cookie | **Chosen.** Instant revocation, no secrets in JS. |
| Cookie on `Domain=.360events.ng` | Works, but every sibling subdomain (including staging) receives the cookie. |
| Host-only cookie on `api.360events.ng` | Works, see analysis below. |

## Cookie analysis

"Same-site" is decided by the registrable domain (`360events.ng`), not the host. `app.360events.ng` calling `api.360events.ng` with `fetch(..., { credentials: 'include' })` is cross-origin but **same-site**. A `SameSite=Lax` cookie set by the API host is therefore sent on those requests. The cookie does not need `Domain=.360events.ng`.

## Decision

- Server-side sessions. The browser holds a random 256-bit opaque token. PostgreSQL stores `SHA-256(token)` only, plus user id, created/last-seen/expiry timestamps, IP and user agent (hashed or truncated per `security-and-privacy.md`).
- Cookie attributes: `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age` matching the session.
- Logout, password change, password reset, email change, role change and admin suspension delete the affected session rows. A password change keeps only the current session.
- **CSRF** defence for unsafe methods (`POST`, `PUT`, `PATCH`, `DELETE`), in layers: (1) `SameSite=Lax`; (2) reject when the `Origin` header is present and not in the exact-match allow-list; (3) a per-session CSRF token returned by `GET /auth/me` and required in an `X-CSRF-Token` header. The webhook route is exempt and uses signature verification instead.
- Session lifetimes (proposed defaults, confirm in P3-T02): customers and organizers 30 days absolute and 7 days idle; administrators 12 hours absolute and 30 minutes idle.
- Local development parity: web `http://localhost:5173`, API `http://localhost:3000` are same-site. The cookie name comes from `SESSION_COOKIE_NAME`. Staging and production use the `__Host-` name; local development uses a plain name because Safari does not accept `Secure` cookies on `http://localhost`.

## Proposed change (needs your acceptance)

Replace "cookie under `.360events.ng`" with **host-only cookie on `api.360events.ng`, named `__Host-session`**, with no `Domain` attribute.

Why: (1) staging and production share the registrable domain, so a `Domain=.360events.ng` cookie from staging would be sent to production hosts; host-only cookies cannot leak across environments or to future subdomains such as a marketing site or a mail-tracking host. (2) It is the only configuration where the `__Host-` prefix, which browsers enforce, is valid. (3) Nothing in the design needs the web host to read the cookie, because the cookie is `HttpOnly`.

## Consequences

- CORS must allow credentials with exact origins (no `*`). See ADR-019.
- The web app must send `credentials: 'include'` on every API call.
- Session lookup is one indexed query per request; acceptable at MVP scale (ADR-020).

## Revisit trigger

Web and API move to different registrable domains; session lookups become a measured bottleneck; a third-party embed needs authenticated calls.
