# GPS Tracking, Fleet Management and Vehicle Security Platform

Multi-tenant SaaS for GPS tracking, fleet management and (safety-controlled) vehicle security. Launching in Rwanda (RWF, Africa/Kigali), designed for international expansion through configuration. Two business models share one platform: direct hardware + subscription, and bring-your-own-device software service; resellers supported.

**Status:** Milestone 1 (foundation: auth, organizations, users, roles, tenant isolation) implemented and tested — awaiting owner review. No GPS functionality yet (Milestone 2). See `docs/DEVELOPMENT_ROADMAP.md`.

## Architecture in brief

```
GPS devices ─► Traccar (protocols, raw positions) ─► NestJS modular monolith ─► React SPA
                                                      │  PostgreSQL (RLS) · Redis/BullMQ · Socket.IO
```

Modular monolith (NestJS + Prisma + PostgreSQL), Traccar as an independent GPS engine behind a port, Redis for latest state/queues, React + Mapbox for the UI, pnpm monorepo. Details: `docs/ARCHITECTURE.md`.

## Documentation

| Document | Content |
|---|---|
| `docs/PROJECT_SPEC.md` | Consolidated requirements (source of truth) |
| `docs/ARCHITECTURE.md` | System design, interactions, modules, directory layout, risks |
| `docs/DATABASE_DESIGN.md` | Schema design incl. tenancy and append-only tables |
| `docs/API_DESIGN.md` | Endpoint catalogue by milestone, conventions |
| `docs/GPS_INTEGRATION.md` | Traccar integration design (unverified items flagged) |
| `docs/DEVICE_COMPATIBILITY.md` | Test hardware recommendation and verification plan |
| `docs/SIMULATOR.md` | Hardware-free testing strategy |
| `docs/VEHICLE_SECURITY.md` | Safe immobilization architecture and runbook skeleton |
| `docs/DEVELOPMENT_ROADMAP.md` | Milestones M1–M10 |
| `docs/OPEN_QUESTIONS.md` | Everything not yet verified |
| `docs/adr/` | Architecture decision records |
| `CLAUDE.md` | Working rules for Claude Code in this repo |

## Getting started

Requires Node 22+ (24 used), pnpm, Docker. Exact commands are in `CLAUDE.md` ("Commands"). In short:

```
pnpm install && pnpm infra:up && cp .env.example apps/api/.env
pnpm build:shared && pnpm db:migrate && pnpm db:seed
pnpm dev:api     # http://localhost:3100  (API docs: /api/docs)
pnpm dev:web     # http://localhost:5273
```

## Claude Code project skills (`.claude/skills/`)

| Skill | Purpose |
|---|---|
| gps-platform-workflow | Architecture boundaries, layout, module workflow, milestone gating, ADRs |
| gps-api-conventions | NestJS/Prisma conventions, auth, errors, pagination, migrations, backend tests |
| gps-tenant-isolation | Multi-tenant enforcement (RLS, composite FKs, sockets, cache, jobs) and isolation tests |
| gps-rbac-permissions | Permission keys, default roles, guards, step-up auth, plan entitlements |
| gps-traccar-integration | Traccar deployment, adapter, auth, devices, WebSocket, commands, geofences |
| gps-position-pipeline | Ingestion, anomalies, status derivation, live fan-out, alerts, storage/retention |
| gps-simulator | OsmAnd-based simulator, simulated-data guards, scenarios, load tests |
| gps-device-catalogue | Compatibility catalogue, effective capabilities, onboarding, assignments, installations |
| gps-immobilization-safety | Starter-inhibit safety gate, state machine, evidence, restoration, audit |
| gps-provider-adapters | Payments, notifications, maps/geocoding behind ports; webhooks; dev adapters |
| gps-fleet-ui | Visual system, data honesty, live map performance, playback, verification |
| gps-done-check | Verification commands, levels of "done", report template |

Items marked "verify" in the skills are deliberate: confirm them and record outcomes in `docs/OPEN_QUESTIONS.md`.
