# API design

Phase 0 deliverable — 2026-11-01 — **proposed**. Spec §11 endpoints are kept exactly; endpoints marked ★ are consolidation/Phase 0 proposals needed by features the spec requires. Implementation conventions: skill `gps-api-conventions`.

## 1. Conventions

- Base path `/api/v1`. OpenAPI/Swagger generated from the shared zod schemas; UI enabled in dev/staging, protected or off in production. Every endpoint documents summary, permission(s), entitlement, schemas, error codes.
- Guard order: Throttler → JwtAuth → TenantContext → Permissions → Entitlement → resource policy in service. Protected by default; `@Public()` explicit. A test fails if any route lacks a permission decorator or `@Public()`.
- Active organization: header `X-Organization-Id` (verified membership); never from a body. Platform admin routes live under `/admin/*` and require platform permissions + audit.
- Success `{ "data": … }`; lists `{ "data": [...], "meta": { page, pageSize, total } }`; high-volume series `meta: { nextCursor }`. Errors: RFC 9457 `application/problem+json` with stable `code`. Other tenants' resources → 404.
- Time ISO-8601 UTC; units km/h, km, m, s, degrees; money integer minor units + currency; phone E.164.
- `Idempotency-Key` required on: immobilize/restore, payments, anything sending external messages. Async work returns `202` + resource URL.
- Rate limits: strict on auth and command routes. History ranges: required `from`/`to`, max span (default 31 days raw history), clipped to assignment windows and plan `history_days`.

## 2. Endpoint catalogue by milestone

Permission keys use the catalogue in skill `gps-rbac-permissions` §1 (the authoritative list is `packages/shared/src/permissions.ts` once created). "Ent." = plan entitlement key.

### M1 — Foundation

| Method & path | Purpose | Permission | Ent. |
|---|---|---|---|
| `POST /auth/register` | Register user (+ optionally create organization) | public | — |
| `POST /auth/login` | Login → access token + refresh cookie | public | — |
| `POST /auth/logout` | Revoke current session | authenticated | — |
| ★`POST /auth/refresh` | Rotate refresh token | cookie | — |
| `POST /auth/forgot-password`, `POST /auth/reset-password` | Recovery (generic responses) | public | — |
| ★`POST /auth/verify-email`, `POST /auth/resend-verification` | Email verification | public / authenticated | — |
| ★`POST /auth/step-up` | Re-authenticate (password/TOTP) for sensitive actions | authenticated | — |
| ★`POST /auth/2fa/enroll`, `/2fa/confirm`, `/2fa/disable` | Optional TOTP | authenticated | — |
| ★`GET /auth/sessions`, `DELETE /auth/sessions/:id` | Session management | authenticated | — |
| `GET /auth/me` | User, memberships, active org, effective permissions, entitlements | authenticated | — |
| `GET /organizations`, `POST /organizations` | List my orgs; create org | membership / `organization.create` (any user, limited) | — |
| `GET/PATCH /organizations/:id` | Read/update | `organization.read` / `organization.update` | — |
| ★`GET /organizations/:id/members`, `POST …/invitations`, `PATCH/DELETE …/members/:memberId` | Users in org | `users.read/invite/update/remove` | — |
| ★`GET /roles`, `GET /permissions`; `PUT /organizations/:id/members/:memberId/roles` | Role assignment | `roles.read`, `users.update` + step-up | — |
| ★`GET /health` | Liveness/readiness | public (no detail) | — |

### M2 — Traccar and device registration

| Method & path | Purpose | Permission |
|---|---|---|
| `GET/POST /vehicles`, `GET/PATCH/DELETE /vehicles/:id` | Minimal vehicle (registration number + org) in M2; full in M5 | `vehicles.read/create/update/delete` |
| `GET/POST /devices`, `GET/PATCH /devices/:id` | Register & sync to Traccar (idempotent) | `devices.read/register` |
| `POST /devices/:id/assign`, `POST /devices/:id/unassign` | Assignment records | `devices.assign` |
| `GET /tracking/positions` | Latest positions snapshot for authorized vehicles | `tracking.live.view` |
| `GET /tracking/vehicles/:id/location` | Current location | `tracking.live.view` |
| ★`GET /admin/engine/health` | Traccar status/version, consumer lag | `platform.devices.diagnose` |

### M3 — Pipeline (no new customer endpoints beyond M2; simulator-facing)

| Method & path | Purpose | Permission |
|---|---|---|
| ★`POST /admin/simulator/devices` (sandbox orgs only) | Register `SIM-` devices for the simulator | `platform.devices.diagnose` |
| Socket.IO `connect` (auth), `subscribe:vehicle`, `unsubscribe:vehicle`; server events `vehicle:delta`, `vehicle:snapshot`, `engine:status` | Live updates | `tracking.live.view` |

### M4 — Live tracking

No new REST resources required beyond M2/M3 plus ★`GET /tracking/vehicles?status=&q=&group=&cursor=` (list/filter/search with live state) and ★`GET /maps/token` (short-lived, scoped Mapbox token, if tokens are issued server-side — see OQ-012).

### M5 — Vehicles, catalogue, onboarding, drivers, dashboard

| Method & path | Purpose | Permission |
|---|---|---|
| `GET/POST /vehicles`… (full), ★`/vehicle-categories`, ★`/vehicles/:id/documents` | Vehicle management | `vehicles.*`, `vehicles.documents.manage` |
| ★`/drivers` CRUD, ★`/vehicles/:id/driver-assignments` | Drivers | `drivers.read/manage` |
| ★`GET /devices/:id/capabilities` | Customer-visible effective capabilities | `devices.capabilities.read` |
| ★`GET/POST /admin/device-catalogue/manufacturers`; `GET/POST/PATCH /admin/device-catalogue/models`; `POST /admin/device-catalogue/models/:id/verifications` | Catalogue | `platform.catalogue.manage` |
| ★`POST /onboarding/devices`; `GET /onboarding/devices/:id`; `POST /onboarding/devices/:id/verify-signal` | Onboarding workflow | `devices.register` |
| ★`GET /admin/devices/:id/diagnostics` (+ audited actions: re-sync) | Diagnostics | `platform.devices.diagnose` |
| ★`GET /dashboard/summary` | Real counts via the single `deriveStatus` function | `vehicles.read` |

### M6 — Trips, playback, geofencing

| Method & path | Purpose | Permission | Ent. |
|---|---|---|---|
| `GET /tracking/vehicles/:id/history` | Positions (cursor, clipped) | `tracking.history.view` | `history_days` |
| `GET /tracking/vehicles/:id/trips` | Trips with start/end, distance, speeds, stops, idle | `trips.read` | `history_days` |
| `GET/POST /geofences`, `PATCH/DELETE /geofences/:id` | Circle/polygon geofences (synced to Traccar) | `geofences.read/manage` | `geofencing` |
| ★`PUT /geofences/:id/vehicles`, ★`/alert-rules` (geofence rules) | Link vehicles / notification rules | `geofences.manage`, `alert_rules.manage` | `geofencing` |

### M7 — Vehicle security

| Method & path | Purpose | Permission | Ent. |
|---|---|---|---|
| `POST /vehicles/:id/immobilize` | Request starter-inhibit → `202` or `422 {code, failures[]}` | `security.immobilize.request` + step-up | `remote_immobilization` |
| `POST /vehicles/:id/restore` | Request restoration | `security.restore.request` + step-up | `remote_immobilization` |
| ★`GET /vehicles/:id/security-commands/:commandId` | State + timeline | `security.history.view` | — |
| ★`POST /vehicles/:id/security-commands/:commandId/cancel` | Only where technically possible | `security.immobilize.request` | — |
| `GET /vehicles/:id/security-history` | Commands + events (cursor) | `security.history.view` | — |
| ★`GET /vehicles/:id/security-preconditions` | Live checklist for the UI (same pure function as the server gate) | `security.status.view` | — |
| ★`POST /admin/vehicles/:id/emergency-restore` | Support restoration with reason | `platform.support.access` + step-up | — |

No generic "send command" endpoint exists or will be added.

### M8 — Notifications and reports

| Method & path | Purpose | Permission |
|---|---|---|
| ★`GET /alerts`, `PATCH /alerts/:id/acknowledge` | Alerts | `alerts.read/acknowledge` |
| ★`GET /notifications`, `PATCH /notifications/:id/read` | In-app inbox | authenticated (own) |
| ★`GET/PUT /notification-preferences`; `GET/POST/PATCH/DELETE /alert-rules` | Preferences & rules | `alert_rules.manage` |
| `GET /reports/fleet-summary`, `/distance`, `/trips`, `/overspeeding`, `/vehicle-utilization` | Reports (+ ★`/idle`, `/geofence-violations`, `/driver-activity`, `/device-connectivity`, `/security-events`, `/immobilization-history`) | `reports.view` |
| ★`POST /reports/:kind/export` → `202`; `GET /exports/:id` (signed URL) | PDF / XLSX / CSV | `reports.export` |

### M9 — Installations, billing, resellers, customer admin

| Method & path | Purpose | Permission |
|---|---|---|
| `GET/POST /subscriptions`, `GET /subscriptions/:id`, `POST /subscriptions/:id/upgrade` (★downgrade, cancel) | Subscriptions | `billing.read/manage` + step-up |
| ★`GET /plans` (public plan catalogue), ★`/admin/plans` CRUD | Plans & entitlements as data | `platform.plans.manage` |
| ★`POST /payments`; ★`POST /webhooks/payments/:provider` (signature-verified, public route); ★`GET /invoices`, `GET /invoices/:id` | Payments & invoices | `billing.manage`; webhook public |
| ★`GET/POST /admin/inventory/devices`; ★`GET/POST /installations`; ★`PATCH /installations/:id/status`; ★`POST /installations/:id/test-results` | Inventory & installation workflow | `platform.inventory.manage`, `platform.installations.manage` |
| ★`/admin/customers`, `/admin/organizations`, suspend/reactivate, activity, tickets | Customer management | `platform.customers.*` |
| ★`/reseller/customers`, `/reseller/devices`, `/reseller/branding` | Reseller portal | `reseller.*` |

### M10 — Operations

★ `GET /admin/audit-logs` (`platform.audit.read`), ★ platform settings (`platform.settings.manage`).

## 3. Open API design points

- Whether `GET /tracking/positions` returns all authorized vehicles (fine for hundreds) or must require a viewport/pagination for thousands — decide in M4 after the M3 load test.
- Public plan catalogue vs authenticated-only — product decision at M9.
- Versioning policy for reseller/third-party API consumers (`api_access`) — designed in M9; additive changes only within `v1`.

## 4. M1 as built (2026-11-01)

Base path `/api/v1`; Swagger UI at `/api/docs` outside production. Differences from the catalogue above:

- Organization-scoped routes live under `/organizations/:organizationId/...` (the path parameter is verified against membership; a conflicting `X-Organization-Id` header is rejected with `ORGANIZATION_MISMATCH`). Roles are `GET /organizations/:organizationId/roles` (not a global `/roles`).
- Added: `POST /auth/change-password`; `GET /health`, `GET /health/ready`; invitations `POST /invitations/lookup`, `POST /invitations/accept` (new account), `POST /invitations/accept-existing` (signed-in); `GET/POST/DELETE /organizations/:organizationId/invitations`; `PATCH/DELETE /organizations/:organizationId/members/:memberId` (step-up required).
- Error codes in use: `VALIDATION_FAILED`, `UNAUTHENTICATED`, `INVALID_TOKEN`, `SESSION_REVOKED`, `INVALID_CREDENTIALS`, `EMAIL_NOT_VERIFIED`, `TOTP_REQUIRED`, `INVALID_TOTP`, `ACCOUNT_TEMPORARILY_LOCKED`, `RATE_LIMITED`, `PERMISSION_DENIED`, `PERMISSION_NOT_DECLARED`, `STEP_UP_REQUIRED`, `ORGANIZATION_NOT_FOUND`, `ORGANIZATION_REQUIRED`, `ORGANIZATION_MISMATCH`, `ORGANIZATION_SUSPENDED`, `ROLE_NOT_FOUND`, `ROLE_NOT_ASSIGNABLE`, `ROLE_EXCEEDS_YOUR_PERMISSIONS`, `OWNER_PROTECTED`, `CANNOT_MODIFY_SELF`, `ALREADY_MEMBER`, `INVITATION_NOT_FOUND`, `CSRF_HEADER_REQUIRED`, `REFRESH_RACE`, `REFRESH_TOKEN_REUSED`, `SESSION_ENDED`.
- Listing endpoints use `page`/`pageSize` (max 100). Idempotency keys are not needed yet (no side-effecting commerce/command routes).

## 5. M2 as built (2026-11-01)

Tenant is taken from the verified context (`X-Organization-Id` header + membership, or the user's oldest membership when omitted) — never from the body. Listing endpoints: `page`/`pageSize` (≤ 100).

| Method & path | Permission | Notes |
|---|---|---|
| `GET/POST /vehicles`, `GET/PATCH/DELETE /vehicles/:id` | `vehicles.read/create/update/delete` | Minimal record; soft delete; 409 `VEHICLE_REGISTRATION_TAKEN`, `VEHICLE_HAS_DEVICE` |
| `GET/POST /devices`, `GET/PATCH /devices/:id` | `devices.read` / `devices.register` | Response never contains engine ids or credentials. 409 `DEVICE_IDENTIFIER_UNAVAILABLE` (generic), 422 `SIMULATED_DEVICE_NOT_ALLOWED` |
| `POST /devices/:id/sync` | `devices.register` | Idempotent retry of the engine registration |
| `POST /devices/:id/assign`, `/unassign` | `devices.assign` | 409 `DEVICE_ALREADY_ASSIGNED`, `VEHICLE_ALREADY_HAS_DEVICE`, `ASSIGNMENT_CONFLICT`, `DEVICE_NOT_ASSIGNED` |
| `GET /tracking/positions` | `tracking.live.view` | Paged latest states; `null` = not reported |
| `GET /tracking/vehicles/:id/location` | `tracking.live.view` | `location: null` with `reason: NO_DEVICE \| NO_DATA_YET` — nothing invented |
| `GET /admin/engine/health`, `POST /admin/engine/reconcile` | `platform.devices.diagnose` | Platform staff only; no customer data |

Not in M2: `GET /tracking/vehicles/:id/history` and `/trips` (M6), device capabilities/onboarding/diagnostics (M5), Socket.IO events (M3/M4).

## 6. M3a as built (2026-11-02)

Org-scoped, permission-checked (`tracking.live.view` / `alerts.*`), tenant from the verified membership, other tenants' ids → 404:
- `GET /organizations/:orgId/tracking/positions` (paginated, newest first, status derived at request time), `…/tracking/summary` (counts by the one shared status function; assigned-but-silent vehicles count as `NO_DATA`), `…/tracking/status-config` (thresholds in force), `…/tracking/vehicles/:id/location` (unknown values are `null`, never 0/false; `simulated` flag on every record).
- `GET …/alerts`, `PATCH …/alerts/:id/acknowledge` (idempotent, records who), `GET|POST …/alert-rules`, `PATCH|DELETE …/alert-rules/:id`. No rule ⇒ no alert (default rules arrive with M8); delayed (buffered) data never raises a real-time alert.
- `GET /admin/engine/health` (platform technical admins) additionally returns pipeline metrics and ingest counters.
- **Socket.IO** `/api/v1/socket`: handshake authenticates (access token, live session, membership, permission) and refuses with one generic message; clients are placed only in `org:<id>` (and per-vehicle rooms after a per-vehicle check); events `vehicle:delta` (coalesced per organization every `FANOUT_FLUSH_MS`, newest state per vehicle) and `engine:status`; sockets are re-validated every `SOCKET_REVALIDATE_SEC` (revoked session / removed member ⇒ disconnect).

## 7. M4 as built (2026-11-02)

- `GET /maps/config` — permission `tracking.live.view`; same for every tenant (no tenant data). Returns `MapConfigDto`: provider (`dev-osm` | `mapbox`), `devOnly`, attribution, raster `tiles` or Mapbox `styles`, a PUBLIC `accessToken` (null for the development provider) and an optional notice. The environment validation refuses the development provider in production and any non-`pk.` token (ADR-0008).
- `GET /tracking/snapshot` — permission `tracking.live.view`. Every vehicle's latest state of the active organization in ONE response, ordered by registration number (stable: paging a list sorted by "last seen" skips and repeats vehicles while they move), cut at `TRACKING_SNAPSHOT_LIMIT` (default 5,000) with `{ vehicles, total, truncated }`. The live map starts from it, then merges `vehicle:delta` messages by time. (`GET /tracking/positions` stays the paged, most-recent-first list used by the pipeline monitor.)
- Socket.IO `engine:status` is now ALSO sent to a client when it connects (the latest value announced by the ingestion leader, remembered in Redis), so a page does not wait for the next change to know whether the engine is up.

## 11. M6a as built (2026-11-04) — history

`GET /vehicles/:id/trips` (`trips.read`) and `GET /vehicles/:id/route` (`tracking.history.view`) with `from` and `to` as ISO 8601 with offset. New stable codes: `HISTORY_RANGE_TOO_LARGE` (422, with a `to` field error). Responses state what was answered (`window`: requested vs answered range, history period, installation coverage, maximum span), what was left out (`hiddenTrips`, `skippedInvalid`, `thinned`) and whether the engine was unreachable (`engineUnavailable`). Configuration: HISTORY_DAYS_DEFAULT (30), HISTORY_MAX_SPAN_TRIPS_DAYS (31), HISTORY_MAX_SPAN_ROUTE_DAYS (7), HISTORY_MAX_ROUTE_POINTS (5000), HISTORY_MIN_TRIP_DISTANCE_M (200), HISTORY_MAX_PLAUSIBLE_SPEED_KMH (250).

## 10. M1b as built (2026-11-04) — provider hierarchy

Removed: `POST /auth/register`, `POST /organizations` (end customers cannot sign up). Added: see `apps/api/src/modules/providers/README.md`. New stable error codes: `SERVICE_TEMPORARILY_UNAVAILABLE` (customer of a suspended provider), `INVALID_PROVIDER_TRANSITION`, `PROVIDER_CHANGED`, `PROVIDER_NOT_FOUND`, `CUSTOMER_NOT_FOUND`, `CUSTOMER_STATUS_UNCHANGED`, `MEMBER_NOT_FOUND`, `BRANDING_SLUG_TAKEN`, `REAL_DEVICE_NOT_ALLOWED_IN_SANDBOX`. Provider staff act for one customer through `X-Organization-Id` / the path (permissions derived, scope enforced, access logged); provider-wide views use the provider organization. Sockets: a provider socket joins `provider:<id>` (or one `org:<id>` room per scoped customer); needs `provider.customers.view_data`.

## 9. M5b as built (2026-11-02)

Customer: `GET /catalogue/models`; `POST /devices` (extended), `PUT /devices/:id/variant`, `GET /devices/:id/configuration|capabilities|history`, `POST /devices/:id/configured`; `GET /consent/current|records`; `GET/POST /device-support-requests`. Platform (`platform.*` permissions): `/admin/catalogue/…`, `/admin/devices`, `/admin/devices/:id/diagnostics|lifecycle|variant|resync`, `/admin/device-support-requests`, `/admin/consent/notices`. New stable error codes: `VARIANT_NOT_FOUND`, `VARIANT_IDENTIFIER_MISMATCH`, `CONSENT_REQUIRED`, `VERIFICATION_REQUIRED`, `SIMULATOR_PROFILE_NOT_VERIFIABLE`, `IMMOBILIZATION_NEEDS_VERIFIED_VARIANT`, `DEVICE_NOT_CONFIGURABLE`, `INVALID_TRANSITION`, `MANUFACTURER_NAME_TAKEN`, `MODEL_NAME_TAKEN`. New config: `GPS_SERVER_HOST`, `DEVICE_CONSENT_REQUIRED`.

## 8. M5a as built (2026-11-02)

New routes (all tenant-scoped, permission-guarded, audited): `/vehicles` (full record, filters, sort), `/vehicles/:id/driver` (+ `driver-history`), `/vehicles/:id/documents`, `/vehicle-categories`, `/drivers`, `/dashboard`. Dates are `YYYY-MM-DD`; an unset optional field is `null`. Expiry objects are `{ date, daysLeft, status }`. Stable error codes: `VEHICLE_VIN_TAKEN`, `VEHICLE_HAS_DRIVER`, `VEHICLE_HAS_NO_DRIVER`, `CATEGORY_NAME_TAKEN`, `CATEGORY_IN_USE`, `CATEGORY_NOT_FOUND`, `DRIVER_LICENSE_TAKEN`, `DRIVER_INACTIVE`, `DRIVER_ASSIGNED`, `DRIVER_ALREADY_ASSIGNED`, `DRIVER_ASSIGNMENT_CONFLICT`. New permission `vehicles.categories.manage` (Fleet Manager and up). Entitlement checks arrive with plans in M9.
