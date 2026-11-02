# Architecture

Phase 0 deliverable — 2026-11-01 — **Status: proposed, awaiting owner review.** Requirements: `docs/PROJECT_SPEC.md` (wins on any conflict). Decisions: `docs/adr/`. Unverified facts: `docs/OPEN_QUESTIONS.md`.

## 1. Repository inspection result (spec §19 task 1; §17.3 steps 1–5)

The repository contained **no application code**: only `docs/PROJECT_SPEC.md`, a starter `README.md`, and 12 project skills under `.claude/skills/`. No `package.json`, no git history (not a git repository yet), no Docker files, no database. Therefore nothing existing needs preserving; the work is greenfield.

Missing and to be created: workspace tooling (pnpm), all three apps, the shared package, Docker Compose environment, CI. Required local tooling (Node LTS, pnpm, Docker Desktop) availability on the development machine is **not yet checked** — M1 step zero.

## 2. System context

```
 GPS devices ──(TCP/UDP, vendor protocols)──► Traccar ──► Traccar DB (raw positions, events)
                                                │  REST /api/*   WebSocket /api/socket   (internal network only)
                                                ▼
 Browser (React SPA) ◄─ HTTPS REST /api/v1 ─► NestJS modular monolith ◄──► PostgreSQL (app DB, RLS)
        ▲                                         │   │
        └── Socket.IO (room per org) ◄────────────┘   └──► Redis (latest state, ring buffers,
                                                           socket adapter, BullMQ, caches)
              External: Mapbox · payment providers · email/SMS/WhatsApp (all behind ports)
```

Four layers (spec §5.1): hardware → Traccar (protocols, raw storage) → NestJS (all commercial logic and **all authorization**) → React (customer app and, separately, platform-admin app).

## 3. Boundaries that must never be crossed

1. The browser talks **only** to NestJS. Traccar's port 8082 is never public; Traccar credentials exist only in server env.
2. Only `integrations/gps-engine/traccar` imports Traccar types or calls Traccar; everything else uses `GpsEnginePort`.
3. Tenant context comes from the authenticated session + verified membership, never from a request body (ADR-0003).
4. Vehicle commands go only through the security module's workflow; there is no generic "send command" anywhere (VEHICLE_SECURITY.md).
5. Simulated positions never appear as real ones; simulated devices are refused outside sandbox organizations.
6. Frontend permission checks are cosmetic; the API is the authority.

## 4. How the components interact

**4.1 Ordinary request (e.g. list vehicles)**
SPA → Nginx → NestJS: `ThrottlerGuard` → `JwtAuthGuard` (verifies JWT, checks `sid` not revoked in Redis) → `TenantContextGuard` (verifies `X-Organization-Id` membership; sets AsyncLocalStorage context) → `PermissionsGuard` → `EntitlementGuard` → controller → service → repository → tenant-scoped Prisma opens a transaction, `set_config('app.current_org_id', …, true)`, query (RLS filters again) → `{ data, meta }` response.

**4.2 Live GPS ingestion**
Device → Traccar protocol port → Traccar decodes, stores raw position → Traccar WebSocket → our single **leader** consumer (Redis lock) → zod-validate → normalize (km/h, tri-state ignition, UTC) → validate/anomaly rules → resolve tenant (traccarDeviceId → device → open assignment → org/vehicle; unmapped → dropped and counted) → ordering/dedupe → write latest state (Redis + throttled `vehicle_live_state`, plus per-vehicle recent-position ring buffer) → derive status → coalesced (~1 s) Socket.IO emit to room `org:<id>` → enqueue evaluations (alert rules, geofence dwell, security checks). On reconnect: exponential backoff with jitter, then REST backfill of latest positions.

**4.3 History / playback**
SPA → API → tenant check → clip range to **device-assignment windows** and the plan's `history_days` and a max span → `GpsEnginePort.getRoute/getTrips` → Traccar reports API → response with invalid/delayed points marked.

**4.4 Immobilization (summary; full design in VEHICLE_SECURITY.md)**
SPA → API (permission + entitlement + step-up + typed confirmation + reason + `Idempotency-Key`) → precondition gate on fresh state (pure function) → `PENDING` row + audit → BullMQ send job re-checks gate → `GpsEnginePort.sendCommand` → `SENT` → Traccar `commandResult` correlated → `ACKNOWLEDGED` → state evidence from subsequent positions → `EXECUTED`; timeouts → `EXPIRED`/`FAILED`. Vehicle security status changes only on execution evidence.

**4.5 Payments (M9)**
API → payment provider port → provider → **webhook** (signature verified, idempotent) → payment state. Never trust the browser's "success".

**4.6 Process model**
One codebase / one image. Initially a single API process also runs the Traccar consumer (leader-locked) and BullMQ workers. A `ROLE=api|worker` switch is designed in from M2 so workers can be split out without refactoring when load requires. Socket.IO uses the Redis adapter so multiple API instances share rooms.

## 5. Deployment topology (Docker Compose)

| Service | Notes |
|---|---|
| `nginx` | TLS termination, serves SPA static files, proxies `/api` and `/socket.io`. Only 80/443 + device protocol ports public. |
| `api` | NestJS. |
| `postgres` | One server initially: database `app` (ours; roles owner/app/system) and database `traccar` (Traccar's own user; we never write to it). |
| `redis` | Persistence on (AOF) — BullMQ jobs and revoked sessions matter. |
| `traccar` | Image tag pinned (OQ-003). `registerUnknown` off in production. UI/API port internal only. Protocol ports published per catalogue (unverified defaults listed in GPS_INTEGRATION.md). |
| `web` (dev only) | Vite dev server with `/api` proxy. |
| `simulator` (profile) | Dev/CI only; never in production compose. |
| `mailpit` (dev) | Clearly-labelled development email adapter target. |

Environments: `development`, `test` (Testcontainers/compose profile with real Postgres, Redis and Traccar), `staging`, `production`. All configuration via environment variables validated at boot with zod; secrets never committed.

## 6. Module map and dependency rules

Dependencies point **downward** only; no cycles. Each module owns its tables and exposes a service; others call the service, never the tables (read-only reporting queries excepted and documented).

| Layer | Modules | Owns (main tables) | Depends on |
|---|---|---|---|
| L0 Infrastructure | config, prisma (tenant client + system client), redis, queues (BullMQ), websocket (Socket.IO gateway), audit | `audit_logs` | — |
| L1 Identity & tenancy | auth, users, organizations, access-control (roles/permissions/guards), resellers, platform-settings (countries, currencies, country settings, provider config), plans (plans, entitlements, subscription state, `EntitlementService`) | users, sessions, organizations, members, roles, permissions, resellers, countries…, plans, subscriptions | L0 |
| L2 Fleet core | device-catalogue, devices, vehicles, drivers, onboarding | catalogue tables, gps_devices, device_assignments, vehicles, drivers, device_status_history | L0–L1 |
| L3 GPS | integrations/gps-engine (port + Traccar adapter), tracking (pipeline, live state), trips, geofences | vehicle_live_state, vehicle_daily_stats, geofences | L0–L2 |
| L4 Events & safety | alerts, notifications, security (immobilization) | alerts, alert_rules, notifications, immobilization_commands/events, security_events | L0–L3 |
| L5 Business | reports, billing (invoices, payments, provider webhooks), installations/inventory, customers (platform admin views) | invoices, payments, installations, inventory | L0–L4 |

Cross-module reactions: in-process domain events (`@nestjs/event-emitter`) for fan-out; BullMQ jobs for anything that must survive a crash or retry (notifications, command timeouts, exports, dwell timers, offline sweeper).

Key dependency notes:
- `plans` sits in L1 so `EntitlementGuard` does not depend on `billing` (L5); `billing` writes subscription state through `plans`.
- `security` depends on `devices`, `device-catalogue` (effective capabilities), `tracking` (fresh state), `plans` (entitlement), `access-control` (permissions, step-up), `audit`, `notifications`.
- `tracking` depends on `devices` for the device→assignment→tenant mapping, and on the `GpsEnginePort`.
- Frontend feature folders mirror modules (`apps/web/src/features/<module>`) and never import another feature's internals.

## 7. Directory structure (spec §19 task 9)

```
/
├── apps/
│   ├── api/
│   │   ├── prisma/                  schema.prisma, migrations/ (incl. raw SQL: RLS, composite FKs), seed/{reference,demo}
│   │   └── src/
│   │       ├── main.ts, app.module.ts
│   │       ├── common/              guards, decorators, filters, interceptors, pagination, problem-details
│   │       ├── infrastructure/      config/, prisma/, redis/, queues/, websocket/
│   │       ├── integrations/        gps-engine/{port.ts,traccar/}, maps/, payments/, messaging/{email,sms,whatsapp}/
│   │       └── modules/             auth, users, organizations, access-control, resellers, platform-settings, plans,
│   │                                device-catalogue, devices, onboarding, vehicles, drivers, tracking, trips,
│   │                                geofences, alerts, notifications, security, reports, billing, installations,
│   │                                customers, audit        (each with README.md)
│   ├── web/                         React + Vite: src/app (routing, shells: customer + admin), src/features/<module>,
│   │                                src/components (ui, map, charts), src/lib (api client, socket, auth store)
│   └── simulator/                   src/{osmand-client,motion,cli}, scenarios/, routes/
├── packages/
│   ├── shared/                      zod schemas, DTO types, permission keys, enums, unit & status helpers
│   └── config/                      eslint, tsconfig, prettier
├── infra/                           compose.*.yml, traccar/traccar.xml, nginx/, scripts/
├── docs/                            PROJECT_SPEC.md, ARCHITECTURE.md, DATABASE_DESIGN.md, API_DESIGN.md,
│                                    DEVELOPMENT_ROADMAP.md, GPS_INTEGRATION.md, DEVICE_COMPATIBILITY.md,
│                                    SIMULATOR.md, VEHICLE_SECURITY.md, OPEN_QUESTIONS.md, adr/
├── .claude/skills/                  project skills
├── CLAUDE.md  README.md
```

## 8. External services (spec §19 task 7)

| Service | Purpose | Port/adapter | Initial implementation | Status |
|---|---|---|---|---|
| Traccar | Protocols, raw positions, trips, geofence evaluation | `GpsEnginePort` | Traccar adapter (+ fake engine for unit tests) | Version unpinned (OQ-003) |
| Mapbox GL JS / Geocoding | Maps, reverse geocoding | `MapProviderPort` (token issuance, geocoding) | Mapbox | Terms/cost/data-flow OPEN (OQ-012, OQ-001) |
| Payments | Subscriptions | `PaymentProviderPort` | Dev adapter first; MTN MoMo, Flutterwave in M9 | OPEN (OQ-011) |
| Email | Verification, reset, alerts | `EmailPort` | Mailpit/log dev adapter (M1); real provider M8 | OPEN (OQ-022) |
| SMS / WhatsApp | Alerts | `SmsPort`, `WhatsAppPort` | Disabled adapters until configured | OPEN (OQ-022, OQ-013) |
| Error monitoring | Sentry-class | config | Choice deferred to M10 (must redact; data location OQ-001) | — |
| Object storage for exports/photos | PDFs, installation photos | `FileStoragePort` | Local volume `exports/{orgId}/…`; S3-compatible later | — |

## 9. Cross-cutting decisions (defaults adopted from the project skills)

| Topic | Decision |
|---|---|
| Auth | ADR-0002 (JWT 15 min + rotating refresh cookie, argon2id, step-up, TOTP optional) |
| Tenancy | ADR-0003 (shared schema, app scoping + FORCE RLS + composite FKs) |
| GPS storage | ADR-0004 (raw positions stay in Traccar; derived data ours) |
| Device status | ADR-0005 (lifecycle + derived connectivity) |
| GPS engine auth & ingestion consistency | ADR-0006 (admin-user session, `filter.future`, latest-only stream semantics, single leased consumer) — verified against Traccar 6.16.0, see GPS_INTEGRATION.md |
| Monorepo | ADR-0001 |
| Validation | zod schemas in `packages/shared`, `nestjs-zod` on the API, React Hook Form on the web |
| Errors | RFC 9457 problem details with stable `code`; other tenants' resources → 404 |
| Pagination | page/pageSize for master data; cursor for high-volume series |
| Time/units | UTC ISO-8601 in API; km/h, km, m, s, degrees; org timezone for display |
| Money | integer minor units + ISO 4217 |
| IDs | UUID everywhere (`@db.Uuid`) |
| Idempotency | `Idempotency-Key` on commands, payments, external messages (stored 24 h) |
| Logging | pino, redacted; no coordinates at info level |
| Realtime | Socket.IO + Redis adapter; room per org; ~1 s coalesced deltas |
| Soft delete | vehicles, drivers, geofences; never for financial, audit, security, assignment history |

## 10. Roles and permissions (summary)

Full key catalogue and default bundles: skill `gps-rbac-permissions` §1–2; the final matrix will be recorded here once seeded in M1. Scopes: **Platform** (Super, Operations, Technical, Finance, Support), **Customer organization** (Owner, Administrator, Fleet Manager, Security Manager, Driver, Read-only Viewer), **Reseller** (Administrator, Staff). Permission (RBAC) and entitlement (plan) are independent checks and both must pass. Sensitive actions additionally need step-up authentication and an audit entry. Fleet Manager deliberately lacks immobilize/restore (the spec's own example).

## 11. Risk register (spec §19 task 8)

Likelihood/impact: H/M/L. "Mitigation" is what the design already does; "Milestone" is when it is addressed.

### Technical

| ID | Risk | L/I | Mitigation | Milestone |
|---|---|---|---|---|
| R-01 | Device capability assumptions wrong (a model lacks ignition, output, etc.) | H/H | Capabilities start `UNKNOWN`; effective = catalogue ∧ installation ∧ observed; nothing inferred from brand | M5, M7 |
| R-02 | Traccar behaviour differs from skill notes (API, WS, commands, trips) | M/H | Pin version; verify against that version; recorded fixtures; real-Traccar integration tests | M2 |
| R-03 | Tenant data leak (query missing scope, cache key, socket room, job, export) | M/Critical | ADR-0003 layers; mandatory Org A/B/Reseller fixture and isolation tests per endpoint; route-scan test | every milestone |
| R-04 | Traccar's DB becomes the scaling bottleneck (est. order of 10⁷ rows/day at target; assumption in ADR-0004) | M/H | Measure in M3; ADR-0004 triggers; sharding behind `GpsEnginePort`; Traccar retention ceiling | M3, M10 |
| R-05 | RLS + per-request transactions slow or pool-starve under load | M/M | Benchmark M3; PgBouncer transaction pooling compatible with `set_config(..., true)`; keep tx short | M3 |
| R-06 | Prisma cannot express/maintain RLS, composite FKs, partial indexes without drift | M/M | M1 spike (OQ-014); fallback to hand-written SQL migrations with CI drift check | M1 |
| R-07 | Out-of-order / delayed / invalid data corrupts live state or fires false alerts | H/M | Pipeline rules + simulator scenarios asserting each case | M3 |
| R-08 | Live map unusable with thousands of vehicles | M/M | Clustering, viewport filtering, coalesced deltas, load test with 2,000 simulated devices | M4, M10 |
| R-09 | Geofence lat/lon order bug (WKT lat-first vs GeoJSON lon-first) | H/M | Single conversion function with known-point tests | M6 |
| R-10 | Single WebSocket consumer is a SPOF / duplicate consumption | M/M | Redis lease with renewal, idempotent pipeline, backfill on takeover | M2 |
| R-11 | Mapbox terms/cost block address storage or exceed budget | M/L | Port + lazy geocoding without persistence until confirmed | M4–M6 |

### Operational

| ID | Risk | L/I | Mitigation | Milestone |
|---|---|---|---|---|
| R-12 | Hardware unavailable/unsuitable locally; no installer partner | M/H | Order early (OQ-002/026); simulator keeps progress independent of hardware; bench test before vehicle | M2–M4 |
| R-13 | SIM/APN/network problems make devices appear offline | H/M | Diagnostics tooling (M5), config instructions per model, OQ-010 | M5 |
| R-14 | Payment provider onboarding lead time delays M9 | H/M | Start merchant applications during M5–M6; dev adapter keeps flow testable | M5–M9 |
| R-15 | Hosting location/legal constraints force a late infrastructure move | M/H | OQ-001 resolved before production hosting; all infra container-based and provider-agnostic | M10 |
| R-16 | Data loss (two databases + Redis) | L/H | Backups of both Postgres databases with restore drills; Redis AOF; documented runbooks | M10 |
| R-17 | Scope creep: UI polish before working GPS | M/M | Milestone order enforced; dashboard KPIs deferred to M5 | all |

### Security and safety

| ID | Risk | L/I | Mitigation | Milestone |
|---|---|---|---|---|
| R-18 | Immobilizing a moving vehicle / false "immobilized" claim | L/Critical | Starter-inhibit only; hardware layer mandatory; 11-check server gate with re-check; evidence-only EXECUTED; feature disabled unless verified (VEHICLE_SECURITY.md) | M7 |
| R-19 | Account takeover grants location + control | M/H | argon2id, rate limits, optional TOTP, step-up for sensitive actions, session revocation, audit and owner notification | M1, M7 |
| R-20 | Traccar exposed publicly / default credentials | M/Critical | Internal network only; `registerUnknown` off; service account with random secret; protocol ports only | M2, M10 |
| R-21 | Rogue devices flood Traccar with unknown IDs | M/L | Unknown devices not auto-registered; per-port rate/connection limits at firewall; unmapped-device metric | M2, M10 |
| R-22 | Location data misuse / regulatory breach | M/H | OQ-001, OQ-020; consent records; access audit; retention policy; no coordinates in info logs | M5, M10 |
| R-23 | Webhook forgery / payment double-processing | M/H | Signature verification, idempotent processing, server-side verification | M9 |
| R-24 | Simulated data shown as real in production | L/H | `isSimulated` propagation, sandbox-org guard, ingestion drop, UI badge, tests | M2–M3 |
| R-25 | Secrets in repo or logs | M/H | Env-only secrets, boot-time validation, pino redaction, secret scanning in CI | M1 |

## 12. Scalability notes

Targets from spec §15 (thousands of customers, tens of thousands of vehicles) are design inputs, not claims of achieved performance. Early levers already in the design: coalesced fan-out, Redis latest state, per-org rooms, pagination everywhere, clustering, aggregates in `vehicle_daily_stats`, optional worker split, Traccar sharding behind the port. Validation is scheduled: M3 (2,000-device simulator load and Traccar report latency) and M10 (full load test, documented with date and hardware).
