---
name: gps-platform-workflow
description: Operating manual for the GPS tracking / fleet management SaaS repo (React + NestJS + Prisma + PostgreSQL + Redis/BullMQ + Traccar). Use at the start of every work session in this repository, before starting any milestone or module, when the user says "continue", "start milestone N", "build module X", "what's next", or when deciding where new code, docs or decisions belong. It defines the architecture boundaries, directory layout, module workflow, milestone gating and which other gps-* skill to load.
---

# GPS platform — how work is done in this repo

The requirements live in `docs/PROJECT_SPEC.md`. Read the sections relevant to the task before writing code; this skill tells you *how* to work, the spec tells you *what* to build. If the two ever disagree, the spec wins and the skill should be corrected.

## 1. Architecture in one picture

```
 GPS devices ──(TCP/UDP, vendor protocols)──► Traccar ──(own DB: positions, events)
                                               │  REST /api/*   WebSocket /api/socket
                                               ▼
 React SPA ◄──HTTPS REST /api/v1──► NestJS modular monolith ◄──► PostgreSQL (app DB)
     ▲                                │   │                         (tenancy, fleet, billing,
     └──── Socket.IO (org rooms) ◄────┘   └──► Redis (latest state,   security, audit)
                                               socket adapter, BullMQ queues)
```

Boundaries that must never be crossed — they exist because each one protects tenants or vehicle safety:

- The browser talks **only** to NestJS. Traccar's port 8082 (web/API) is never public, and Traccar credentials exist only in server env.
- Only the GPS-engine adapter (`apps/api/src/integrations/gps-engine/traccar`) imports Traccar types or calls Traccar. Everything else uses the `GpsEnginePort` interface. This is what makes the engine replaceable.
- Tenant context comes from the authenticated session, never from a request body/query alone (see `gps-tenant-isolation`).
- Vehicle commands go only through the security module's command workflow (see `gps-immobilization-safety`).

## 2. Directory layout (proposed default — confirm in Phase 0, record in an ADR)

```
/
├── apps/
│   ├── api/                 NestJS
│   │   ├── prisma/          schema.prisma, migrations/, seed.ts
│   │   └── src/
│   │       ├── modules/     auth, organizations, users, access-control, vehicles, drivers,
│   │       │                devices, device-catalogue, onboarding, installations, tracking,
│   │       │                trips, geofences, alerts, notifications, security, reports,
│   │       │                billing, customers, resellers, audit, platform-settings
│   │       ├── integrations/ gps-engine/{port.ts,traccar/}, maps/, payments/, messaging/
│   │       ├── infrastructure/ prisma/, redis/, queues/, websocket/, config/
│   │       └── common/      guards, decorators, filters, interceptors, pagination
│   ├── web/                 React + Vite (src/app, src/features/<module>, src/components, src/lib)
│   └── simulator/           GPS simulator CLI + scenarios + routes
├── packages/
│   ├── shared/              zod schemas, DTO types, permission keys, enums (used by api AND web)
│   └── config/              eslint, tsconfig, prettier presets
├── infra/                   docker-compose.*.yml, traccar/traccar.xml, nginx/, scripts/
├── docs/                    PROJECT_SPEC.md, ARCHITECTURE.md, … , adr/, OPEN_QUESTIONS.md
└── .claude/skills/          these skills
```

Package manager: pnpm workspaces (recommended; record the choice in an ADR).

## 3. Module rules (modular monolith)

- Each module owns its Prisma models. Other modules read/write them through the owning module's exported service, not by querying the tables directly. Pragmatic exception: read-only reporting queries in `reports`, documented in the module README.
- Cross-module reactions use in-process domain events (`@nestjs/event-emitter`) for synchronous fan-out and BullMQ jobs for anything that must survive a crash or retry (notifications, command timeouts, exports).
- No circular module imports. If two modules need each other, extract an interface or move the shared piece down.
- Each module folder has a short `README.md`: purpose, owned tables, public service methods, events emitted/consumed, permissions used.

## 4. The per-module workflow (from spec §17.2)

For every module, in order:

1. Business purpose → 2. workflows → 3. dependencies → 4. database entities → 5. API endpoints → 6. authorization (permissions + entitlements) → 7. failure scenarios → 8. backend → 9. frontend → 10. end-to-end test of the workflow → 11. documentation.

Write steps 1–7 into the module README (or `docs/`) **before** coding; they are short but they catch most design mistakes. Never build a frontend screen whose backend does not work yet.

## 5. Milestones and gating

Order is fixed by spec §17.4: Phase 0 → M1 Foundation → M2 Traccar + device registration → M3 Simulator + ingestion → M4 Live tracking → M5 Vehicles, catalogue, onboarding → M6 Trips, playback, geofences → M7 Safe immobilization → M8 Notifications, reports → M9 Installations, billing, resellers → M10 Production.

At the end of each milestone:

1. Run the `gps-done-check` skill and produce its report.
2. Update `docs/DEVELOPMENT_ROADMAP.md` (status, what remains).
3. Stop and present the report. Start the next milestone when the user confirms.

Within a milestone, keep going without asking permission for routine decisions; pick sensible defaults and note them.

## 6. Decisions and uncertainty

- **Architecture-affecting decisions** (storage strategy, auth approach, tenancy enforcement, package choices that are hard to reverse): write `docs/adr/NNNN-short-title.md` with Context / Options (at least two) / Decision / Consequences. Mention the ADR in your report.
- **Uncertain facts** (device capabilities, protocol behaviour, Traccar version behaviour, provider pricing/APIs, regulation): do not guess. Add an entry to `docs/OPEN_QUESTIONS.md` (question, why it matters, how to verify, status) and design so the uncertain thing is configurable or gated.
- When documentation and code disagree, fix the documentation in the same change.

## 7. Which skill to load

| Task touches… | Load |
|---|---|
| Any NestJS endpoint, DTO, Prisma model, migration, auth | `gps-api-conventions` |
| Any tenant-owned data, query, cache, socket room, job | `gps-tenant-isolation` |
| Permissions, roles, guards, plan entitlements, nav visibility | `gps-rbac-permissions` |
| Traccar (REST, WebSocket, devices, commands, geofences, reports) | `gps-traccar-integration` |
| Positions, live state, vehicle status, alerts evaluation, storage/retention | `gps-position-pipeline` |
| Simulator, scenarios, load tests | `gps-simulator` |
| Device catalogue, capabilities, onboarding, activation, assignments, inventory, installations | `gps-device-catalogue` |
| Immobilization, restoration, any device command | `gps-immobilization-safety` |
| Payments, email/SMS/WhatsApp, maps/geocoding, webhooks | `gps-provider-adapters` |
| Any page, component, map, chart | `gps-fleet-ui` |
| Before saying anything is done | `gps-done-check` |

Several usually apply at once (e.g. a new "geofences" endpoint needs api-conventions + tenant-isolation + rbac + traccar-integration).
