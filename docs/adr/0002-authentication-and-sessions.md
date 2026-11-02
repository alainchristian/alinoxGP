# ADR-0002: Authentication and session approach

- **Status:** Proposed (awaiting owner review) — 2026-11-01
- **Spec refs:** Module 1, §7, §13

## Context

Clients: our React SPA now; likely a mobile app and reseller API integrations later (`api_access` is a plan entitlement). The product exposes live vehicle locations and remote vehicle control, so sessions must be revocable quickly, sensitive actions need re-authentication, and a user may belong to several organizations. The spec allows "JWT or secure session-based authentication".

## Options

1. **Server-side session cookie only** (opaque session ID in Redis/Postgres, `HttpOnly` cookie, CSRF protection). Simple, instantly revocable; awkward for mobile apps and third-party API clients; every request needs a session lookup.
2. **Stateless JWT only** (access token ~15 min, no refresh or long-lived JWT). Simple to scale; cannot revoke before expiry; long-lived variants are unsafe.
3. **Short-lived JWT access token + rotating opaque refresh token in an HttpOnly cookie, backed by a `sessions` table** (hybrid).
4. **External identity provider** (Auth0, Keycloak, Cognito). Less code to own; adds a vendor/hosting dependency and cost, and data-localisation question (OQ-001) for user data; harder to embed tenant/step-up logic.

## Decision

**Option 3 (hybrid)**, with these specifics:

- **Passwords:** argon2id; parameters tuned in M1 against target hardware; never logged or returned.
- **Access token:** JWT, ~15 min, claims `sub`, `sid` (session id), `iat/exp` only — **no roles, no permissions, no organization**. Permissions are resolved server-side per request from the active membership (cached in Redis, invalidated on change), so a role change takes effect immediately. Held in SPA memory (not localStorage).
- **Revocation:** `sid` is checked against a Redis revoked-session set (and falls back to the DB on Redis loss) on every request. This makes logout / "revoke session" / password change effective immediately rather than after ≤15 min. Cost: one Redis lookup per request (acceptable; also needed for the permission cache).
- **Refresh token:** opaque random, stored hashed in `sessions`, rotated on every use, delivered as `HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth` cookie. Reuse of a rotated token revokes the whole session family. Refresh endpoint additionally requires a custom header (CSRF defence in depth).
- **Sessions table:** user agent, IP, created/last-used, revoked — powers the session-management UI.
- **Email verification / password reset:** random single-use tokens, stored hashed, short expiry; responses never reveal whether an email exists.
- **2FA:** optional TOTP in M1 scope per spec Module 1 ("optional two-factor authentication"); recovery codes. Enforced-for-roles policy is a later setting.
- **Step-up authentication:** a fresh password/TOTP confirmation within the last 5 minutes (timestamp on the session) is required for immobilize/restore, role/permission changes, member removal, ownership transfer, billing changes, API key creation, support access, customer suspension.
- **Organization context:** not in the token. The client sends `X-Organization-Id`; `TenantContextGuard` verifies membership from the DB (ADR-0003).
- **Sockets:** Socket.IO handshake authenticates with the access token; re-validated on token refresh and on session revocation (server disconnects the socket).
- **Same-site deployment assumption:** web and API are served under the same registrable domain (e.g. `app.example.com` / `app.example.com/api`) behind Nginx, so `SameSite=Strict` cookies work. Vite dev server proxies `/api`. Reseller white-label custom domains (future) will need a revisit.
- **Bootstrap:** the first Super Administrator is created by a CLI command / seed with a one-time password, never by public registration.
- **Machine clients (future):** hashed API keys with scopes, separate from user sessions; designed in M9, not built now.

## Implementation notes (added in M1, 2026-11-01)

- Schema refinement: a `sessions` row is one login (the "family"); refresh tokens live in `refresh_tokens` (hashed, `used_at`, expiry). Presenting an already-used token **more than 10 s after use** revokes the session (`REFRESH_TOKEN_REUSED`); within 10 s it is treated as a benign multi-tab race (`REFRESH_RACE`, 401). A race **does not clear the cookie** (found by browser testing: clearing it logged the user out of every tab) and the web client retries once after 300 ms. Trade-off: an attacker replaying a stolen token within 10 s of the legitimate rotation is not detected as theft.
- Access token carries only `sub` and `sid`; revoked session ids are kept in Redis for the token lifetime. If Redis is unreachable the database is consulted; if Redis restarts *and loses* its data, revocations made in the previous ≤15 minutes would be forgotten (AOF persistence is enabled in the dev/prod compose to make this unlikely).
- Per-account lockout: 10 failed logins in 15 min → `ACCOUNT_TEMPORARILY_LOCKED` (Redis counter), on top of per-IP rate limiting (in-memory per process; move to Redis storage before running several API instances).
- Registration and "forgot password" answer identically whether or not the email exists; an existing address receives an "already registered" email instead.
- TOTP secrets are AES-256-GCM encrypted at rest with `TOTP_ENCRYPTION_KEY`; recovery codes are stored hashed. Key rotation is not implemented.
- Not implemented in M1: SSO, API keys, "remember this device", forced 2FA policies.

## Consequences

- (+) Instant revocation, works for SPA now and mobile/API later, tenant/permissions changes apply immediately, no vendor dependency.
- (−) We own security-critical code (rotation, reuse detection, step-up). Mitigation: use well-reviewed libraries for primitives (argon2, JWT, TOTP), write explicit tests for rotation/reuse/revocation, include in M10 security review.
- (−) A Redis dependency on the auth path; DB fallback required and tested.
- (−) Cookie-based refresh ties the SPA and API to one site; documented above.
- Revisit if: enterprise customers require SSO (SAML/OIDC) — add as an additional login method that still mints our own sessions.
