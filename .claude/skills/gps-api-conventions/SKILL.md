---
name: gps-api-conventions
description: Backend conventions for the GPS fleet platform's NestJS API and Prisma database — module structure, guards order, auth/session design, DTO validation with shared zod schemas, response and error format, pagination, time handling, idempotency, Swagger, migrations, logging and backend testing. Use whenever creating or changing a NestJS controller, service, DTO, guard, Prisma model, migration, seed, or anything under apps/api, even for a "small" endpoint.
---

# API and database conventions

Consistency matters more than any single choice here: a fleet platform ends up with 150+ endpoints, and clients (our web app's three shells, GPS providers' integrations, future mobile apps) depend on them behaving alike. Items marked *(default)* are recommended starting choices — confirm or change them in a Phase 0 ADR, then follow the ADR.

## 1. Module anatomy

```
modules/vehicles/
  vehicles.module.ts
  vehicles.controller.ts      thin: parse, authorize via decorators, call service, map response
  vehicles.service.ts         business rules, transactions, emits domain events
  vehicles.repository.ts      Prisma access (tenant-scoped client only)
  dto/                        re-exports of shared zod schemas + nestjs-zod DTO classes
  policies/                   resource-level checks (e.g. driver may only see assigned vehicle)
  vehicles.service.spec.ts
  test/vehicles.e2e-spec.ts
  README.md                   purpose, tables, events, permissions
```

## 2. Request pipeline

Guards run in this order on every protected route:

1. `ThrottlerGuard` — rate limit (stricter on auth and command routes).
2. `JwtAuthGuard` — authenticates; attaches `user`.
3. `TenantContextGuard` — resolves the tenant level (customer / provider / platform), active organization, `X-Customer-Id` for provider staff, and verifies membership and scope (see `gps-tenant-isolation`).

Route prefixes by audience: `/api/v1/...` (end-customer and shared resources), `/api/v1/provider/...` (provider console), `/api/v1/admin/...` (platform staff). A route's prefix must match the roles allowed on it; a test enumerates routes and checks this. "Provider" in names always means a GPS provider; external services are "gateways".
4. `PermissionsGuard` — `@RequirePermissions('vehicles.update')` (see `gps-rbac-permissions`).
5. `EntitlementGuard` — `@RequireEntitlement('geofencing')` when the feature is plan-gated.

Then resource-level policy checks inside the service. Public routes are explicitly marked `@Public()`; the default is protected.

## 3. Authentication *(default)*

- Passwords: argon2id. Never log or return hashes.
- Access token: short-lived JWT (~15 min), kept in memory by the SPA, sent as `Authorization: Bearer`.
- Refresh token: opaque, rotating, stored hashed in a `sessions` table, delivered as `HttpOnly; Secure; SameSite=Strict` cookie scoped to `/api/v1/auth`. Reuse of a rotated token revokes the whole session family.
- Sessions table records device/user-agent, IP, created/last-used, revoked — powers "session management" in the UI.
- Email verification and password reset tokens: random, stored hashed, single-use, short expiry; responses never reveal whether an email exists.
- Optional TOTP 2FA; **step-up re-authentication** (password or TOTP within the last 5 minutes) for sensitive actions: immobilize/restore, role and permission changes, ownership transfer, billing changes, API key creation.
- Login and reset endpoints have their own tight rate limits and generic error messages.

## 4. Validation and DTOs *(default: shared zod)*

- Request/response schemas are zod schemas in `packages/shared`, used by the web forms (React Hook Form + zod) **and** the API via `nestjs-zod`, which also feeds Swagger. One schema, one truth.
- Strip unknown fields. Never accept `organizationId` in a body to decide tenancy (it may appear only where an authorized admin explicitly targets another org, and then it is re-verified).
- Phone numbers: E.164, validated with `libphonenumber-js`. Currency amounts: integer minor units + ISO 4217 code.

## 5. Responses and errors

- Success: `{ "data": … }`; lists: `{ "data": [...], "meta": { "page", "pageSize", "total" } }`. High-volume series (positions, events, audit logs) use cursor pagination: `meta: { "nextCursor" }`.
- Errors: RFC 9457 problem details (`application/problem+json`): `{ type, title, status, detail, code, errors? }`. `code` is a stable machine string such as `VEHICLE_NOT_FOUND`, `DEVICE_IMEI_TAKEN`, `IMMOBILIZATION_REJECTED_STALE_POSITION`. The frontend switches on `code`, never on message text.
- A resource belonging to another tenant returns **404**, not 403 — 403 would confirm it exists.
- Never put stack traces, SQL or provider responses in error bodies.

## 6. Lists, filters, time

- `page`/`pageSize` (max 100) or `cursor`/`limit`. Sorting via whitelisted `sort=field:asc`.
- All timestamps in the API are ISO 8601 UTC. Clients render in the organization's timezone (default Africa/Kigali) and format.
- Date-range endpoints require `from` and `to`, enforce a maximum span per request (e.g. 31 days for raw history) and enforce the plan's historical-tracking period.
- Units in API payloads: km/h, km, metres, seconds, degrees. Convert at the integration boundary (Traccar speed is knots).

## 7. Side-effecting POSTs

- Accept an `Idempotency-Key` header on endpoints that create money movements, commands or external messages; store key + response for 24 h.
- Return `202 Accepted` with a resource URL for asynchronous work (commands, exports, payments).

## 8. Swagger

Every endpoint documents: summary, required permission(s), entitlement, request/response schemas, error codes. Swagger UI is enabled in development/staging and protected or disabled in production.

## 9. Prisma and migrations

- Change schema → `prisma migrate dev --name <change>` → commit the generated SQL. Never `db push` outside throwaway local experiments; never hand-edit production.
- Raw SQL that Prisma cannot express (RLS policies, partial unique indexes, composite FKs, CHECK constraints, partitioning, triggers) goes into the migration SQL file with a comment explaining it.
- IDs: UUID (`@db.Uuid`). Timestamps: `createdAt`, `updatedAt` as `timestamptz`.
- Soft delete (`deletedAt`) for user-facing master data (vehicles, drivers, geofences). **Never** soft- or hard-delete financial records, audit logs, security events or device assignment history — they are append-only.
- Money: `BigInt`/`Int` minor units; never floats.
- Seeds are idempotent (upserts) and split into `reference` (countries, currencies, permissions, system roles) and `demo` (development only, simulated devices clearly flagged).

## 10. Logging and errors

- Structured logs (pino) with request ID, user ID, organization ID. Redact `authorization`, `cookie`, `password`, `token`, `secret`, payment payloads.
- Do not log coordinates or addresses at info level; location is personal data.
- Unhandled exceptions go to error monitoring (e.g. Sentry) with the same redaction.

## 11. Backend tests

- Unit: services and policies with fakes for ports.
- Integration: real PostgreSQL and Redis via Testcontainers (or the compose test profile); Prisma migrations applied, not `db push`.
- E2E (supertest) for every endpoint: happy path, validation error, unauthenticated, missing permission, **other-tenant access returns 404**.
- Tests must not depend on execution order or wall-clock time (inject a clock).
