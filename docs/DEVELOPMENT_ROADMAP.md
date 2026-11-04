# Development roadmap

Phase 0 deliverable — 2026-11-01 — aligned with spec §17.4 (milestones are authoritative). Size = relative effort (S/M/L/XL), **not** a time estimate; no calendar dates are promised until M1 has been measured.

## Status

| Phase / Milestone | Status |
|---|---|
| Phase 0 — analysis and architecture | Approved by owner (2026-11-01) |
| M1 — Foundation | Approved (owner started M2 on 2026-11-01). See "M1 as built" below. |
| M2 — Traccar integration and device registration | Approved (owner started M3 on 2026-11-01). See "M2 as built". |
| **M3a — Pipeline correctness, real-time layer, alerts, simulator scenarios, leader-owned live state** | **Approved by the owner (2026-11-02).** See "M3a as built". |
| **M3b — Scale proof (200 positions/s, Traccar report latency, RLS overhead)** | **Moved by the owner to just before M10, to run on a separate Linux host.** ADR-0003 and ADR-0004 are "pending M3b". See OQ-032. |
| M4 — Live tracking | **Approved by the owner (2026-11-02)** with the open development map; the Mapbox renderer waits for a token (OQ-034). See "M4 as built". |
| **M5a — Vehicles, drivers, categories, documents, real dashboard** | **Approved by the owner (2026-11-02)** after the status counts and latest alerts were added to the dashboard. See "M5a as built". |
| **M5b — Device catalogue, capabilities, onboarding, diagnostics, consent records** | **In progress (started 2026-11-02, after M5a approval).** Original note:  (owner split M5 on 2026-11-02; needs the physical test devices and OQ-018 / OQ-020 / OQ-024; starts after M5a is approved) |
| **M1b — Provider hierarchy retrofit** | **Approved by the owner (2026-11-04), committed 4e50a87.** Slices 1–4 done, slice 5 (isolation proof) done for everything that exists. See "M1b as built". Provider-wide live map UI deferred (OQ-040). |
| M5b (above) | **Approved by the owner (2026-11-04).** |
| **M6a — Trips and playback** | **Implemented and verified against the real engine and in a browser (2026-11-04); awaiting owner review.** Split confirmed by the owner (history default 30 days; 31 days of trip list / 7 days of route per request). See "M6a as built". |
| **M6b — Geofences** | Not started (waits for M6a approval). |
| M7 – M11 (**milestone numbers changed on 2026-11-04**: new M9 = speed governor compliance; old M9 → M10 installations/provider billing/platform admin; old M10 → M11 scale proof (M3b) + production) |

### M6 plan (2026-11-04) — trips, playback, geofencing (proposed split)

M6 bundles two independent pieces (history through the engine; geofences synced to the engine with events), so it is proposed as two milestones, as M3 and M5 were.
**M6a — Trips and playback.** History is read through the `GpsEnginePort` (Traccar reports: route, trips, stops), never copied (ADR-0004; scale unproven until M3b, so every query is bounded). Every history query is clipped to the device **assignment windows** of the vehicle (a device moved to another customer never reveals the other tenant's movements; a provider sees the periods the device was under it), to a configured **maximum span** and to the **history period** (a configuration value until plans arrive in M10). Invalid and delayed points are marked, not drawn as jumps. API: trips list (start/end place if available, times, distance, max/average speed, stops and idle periods), route points for playback. Web: Trips & Playback page (vehicle + date range, trip list, map route, play/pause/stop/speed/timeline, statistics). Provider staff reading a customer's history are written to the customer's access log (already generic). Needs **recorded Traccar report fixtures** from the real container (OQ: report latency vs dataset size stays with M3b).
**M6b — Geofences.** Circle and polygon geofences, named locations (CRUD, tenant-scoped, vehicle assignment), WKT conversion (**latitude first**, tested), sync to the engine with reconciliation, enter/exit events from the engine into alerts (existing alert pipeline), dwell (native or delayed jobs, OQ-007), geofence notification **rules** stored and shown in-app (delivery channels arrive in M8). Simulator `geofence-enter-exit` scenario already exists.
**Exit:** replay a simulator trip; receive geofence events from scenarios; reassignment test (A→B history windows).
**Decisions needed from the owner:** (1) confirm the split; (2) the default history period until plans exist (proposed: 30 days) and the maximum span of one request (proposed: 7 days for route points, 31 days for trip lists).

### M6a as built (2026-11-04)

- **Engine port:** `getTrips` / `getStops` (Traccar trip and stop reports; knots → km/h, 0,0 and out-of-range coordinates → null). Stop coordinates are `latitude`/`longitude` (found by the real-engine test; trip rows use `startLat` etc.).
- **API:** `GET /vehicles/:id/trips` and `/route` (see `apps/api/src/modules/history/README.md`): history period, span limits, per-tracker installation windows, hidden trips counted (OQ-033 decided: platform-side filter, engine configuration unchanged), invalid fixes counted, thinning with first/last kept, engine-unavailable flag.
- **Web:** Trips & playback replaces the placeholder (which showed invented numbers): vehicle + day range in the organization's time zone, journey list with stops, route on the map (split at tracker changes), play/pause/stop, 1×–16×, timeline, statistics, honest notices (installed for part of the period, history period, engine unreachable, hidden short movements, thinned route).
- **Evidence:** typecheck and lint pass; API unit 117 (new: history rules 17, report mapping 3; the flaky reconnect test race fixed), web 163 (new: playback model 11, branding 3, provider 8), API e2e history 10 against the real Traccar (route order, km/h, tri-state ignition, moved-tracker isolation both ways, real trip and stop detected, 404 for other tenants, permissions, bounds, history period, provider staff + access log, engine unreachable); browser: a simulated drive of a customer vehicle opened as provider staff, replayed on the OpenStreetMap development map.
- **Not verified:** very long routes on a phone (only the 5000-point cap is tested server-side), reverse geocoded addresses (none), phone/tablet layout of the page, trips of a real tracker (no hardware yet), report latency at scale (M3b).
- **Deviations:** none. **New open questions:** OQ-041.

### M1b plan (2026-11-04) — provider hierarchy retrofit

**Why.** `docs/PROJECT_SPEC.md` rev. 1.2 (starter pack of 2026-11-04) makes the platform's paying customers **GPS tracking providers** who serve their own end customers; M1 now includes provider self-registration and approval, provider staff, customers created and invited by the provider, per-customer limits and basic branding. What M1 built was the earlier reseller model (read-only access to child customers, public organization creation). M2–M5b (device pipeline, live state, catalogue, vehicles) are compatible and stay.
**Decisions:** ADR-0010 (dual-key tenancy: `organization_id` + `provider_id` on every tenant row, filled and checked by the database; RLS with a customer-level and a provider-level setting).
**Slices** (each ends with typecheck, lint, tests):
1. **M1b-1 Database + tenancy core:** `RESELLER` → `PROVIDER`; `organizations.provider_id`; `provider_profiles` (lifecycle, registration data, terms acceptance); `provider_id` on every tenant table (trigger-filled, consistency-checked, backfilled); RLS policies with `app.current_provider_id`; `TenantContext` with levels; `TenantContextGuard` (customer via `X-Organization-Id`, provider staff acting on a customer via the path/`X-Customer-Id`, scope check); provider permissions and roles; platform provider permissions.
2. **M1b-2 Provider lifecycle + customers:** public provider registration (email-verified), platform approval/rejection/suspension, sandbox-only before approval, terms acceptance record; provider creates customers, invites their users, suspends/reactivates a customer, sets per-customer limits (stored; enforcement arrives with entitlements in M10); public organization creation removed; provider-staff access log visible to the customer's owner; branding data + public `GET /branding/resolve`.
3. **M1b-3 Provider reach into existing data:** provider-level vehicles/devices/alerts/live snapshot across its customers (scoped staff honoured), provider socket room, device registration by a provider (stock, then assigned to a customer's vehicle).
4. **M1b-4 Web:** provider console shell (customers, create/invite, staff, branding, devices, all-customers live map), provider registration page, platform admin provider approvals, provider-branded login and theme variables.
5. **M1b-5 Isolation proof:** new fixture (P1 with C1, C2, a staff member scoped to C1; P2 with C3) and the tests of `gps-tenant-isolation` §7 for every endpoint that exists; docs updated.
### M1b as built (2026-11-04)

- **Tenancy (ADR-0010):** PROVIDER replaces RESELLER; `provider_id` on every tenant row filled and checked by the database; RLS with a customer key and a provider key; `TenantContext` with `actingAs` MEMBER | PROVIDER_STAFF and a customer scope; provider staff act for a customer with permissions derived from their role (never security commands, ownership, roles) and every access lands in the customer's access log (owner-only). Found by the tests: a staff-scope filter that overwrote the customer id in a query (fixed, covered).
- **Provider lifecycle:** public registration (email-verified, terms version recorded), platform approve/reject/suspend/reactivate with step-up and a lifecycle table; sandbox-only before approval (real devices refused in sandbox organizations); suspended provider → customers see a neutral message, ingestion continues.
- **Provider console:** customers (create + owner invitation, suspend/reactivate, per-customer limits stored), staff scope API, branding (colours, name, support contacts, sign-in address; public resolve with neutral fallback), all-vehicles list. Web: provider console shell, registration page, platform Providers page, customer access-log page, provider-branded login and theme.
- **Real-time:** provider room `provider:<id>` (scoped staff get per-customer rooms; dropped when their scope changes), fan-out via an in-memory organization→provider directory.
- **Evidence:** typecheck, lint pass; shared 98, web 152, API unit 100 and e2e 256 tests pass (new: providers 34, provider-live 7); migrations in sync (`migrate diff` empty); steady-traffic smoke test passes (hit rate 91.7 %, p95 position-to-socket 977 ms, no errors); browser: register → verify → sign in → approve (step-up) → create customer → open it as staff (banner) on the dev stack.
- **Not verified:** phone/tablet layouts of the new pages, branding and access-log pages in a browser, hosted behaviour of `<slug>.domain` addresses, staff-scope UI (API only). `traccar.stream.spec` (reconnect) failed once under full-suite load and passed twice alone: flaky, not investigated.
- **Deviations:** none from the spec. Decisions needing the owner: OQ-038/039/040.

**Out of scope here:** provider billing and plans (M10), customer transfer between providers (M10), regulator organization (M9), bulk CSV device import (follows slice 3 if time allows, otherwise M5-style follow-up), custom domains.

### M5b plan (2026-11-02) — catalogue, capabilities, onboarding, diagnostics, consent

Decisions: ADR-0009. Honest starting point: no physical device has been bench-tested, so the catalogue starts with the **platform simulator profile only** (exercised through real Traccar, not a physical device) and every other model is "Request support".
1. **Data:** global catalogue tables (manufacturer, model, variant, capability rows, append-only verification log); device gets variant, firmware, serial, SIM ICCID; `device_status_history`; consent notices + append-only consent records; device support requests.
2. **API:** platform catalogue management; customer catalogue read; effective capabilities per device (computed with reasons); lifecycle service with first-signal hook; onboarding (register with model, configuration instructions, confirm configured, assign); support request; consent; platform device search and diagnostics (read-only; actions audited).
3. **Web:** customer Devices (list with display status, add-device wizard, detail with capabilities and instructions, assign); platform admin Catalogue, Devices diagnostics, support requests.
4. **Tests:** IMEI validation, duplicate IMEI without leak, lifecycle matrix, first-signal detection, effective-capability matrix (catalogue × installation × observed, immobilization never effective), `VERIFIED` needs evidence, consent immutability, RLS and isolation on new tables, permissions per role.
**Exit (roadmap):** a customer onboards a simulated device end to end and sees its effective capabilities. **Out of scope:** installation jobs and inventory (M9), commands and immobilization (M7), observed power/battery/IO evidence (OQ-036).

### M5a plan (2026-11-02) — vehicles, drivers, categories, documents, real dashboard

M5 was **split by the owner on 2026-11-02**: **M5a** = management of vehicles, drivers, categories and vehicle documents plus the dashboard on real data (needs no hardware knowledge); **M5b** = device compatibility catalogue, effective capabilities, onboarding workflow with first-signal detection, diagnostics, consent records (needs the physical test devices and the policy answers: OQ-018, OQ-020, OQ-024). M5a starts after M4's approval; M5b only after M5a's.

**Skill steps 1–7 (business purpose → failures).**
1. *Purpose:* a customer keeps an accurate register of vehicles and drivers, sees who/what is attached to what, is warned before papers expire, and sees a dashboard made only of real numbers.
2. *Workflows:* create / edit / search / delete vehicle; manage categories; attach document records (insurance, inspection, registration, permit); register drivers; assign a driver to a vehicle and end the assignment (history kept); dashboard.
3. *Dependencies:* M1 tenancy/RBAC/audit; M2 devices and device assignment; M3 alerts and live status; M4 live map (category filter and driver in the detail panel come later in M5a).
4. *Tables (all tenant tables: `organization_id`, composite FKs, forced RLS):* `vehicles` extended (make, model, year, colour, type, VIN, fuel, insurance and inspection expiry, notes, category); `vehicle_categories`; `drivers`; `driver_assignments` (history, append-only like device assignments); `vehicle_documents` (records, soft delete).
5. *Endpoints:* `/vehicles` (extended, filters, sort), `/vehicles/:id/documents`, `/vehicles/:id/driver`, `/vehicles/:id/driver-history`, `/vehicle-categories`, `/drivers`, `/dashboard`.
6. *Authorization:* existing `vehicles.*` and `drivers.*` keys, new `vehicles.categories.manage`; no entitlement check yet because plans and entitlements arrive in M9 (recorded, not forgotten); another tenant's anything is 404.
7. *Failure scenarios:* duplicate registration / VIN / licence number / category name (409); delete a vehicle that has a device or a driver, a driver who is assigned, a category in use (409); assign a driver already driving another vehicle (409); invalid year, VIN, phone, dates (422); other tenant's id (404).

**Decisions made by default (overrule me):**
- **Document records only, no file upload.** Storing scanned insurance papers needs an object-storage decision with data-localisation implications (OQ-001) — not made yet (new OQ-035). Records carry type, title, reference number, issue and expiry dates, notes.
- **One assigned driver per vehicle and one vehicle per driver at a time**, with history. The UI and API call it the *assigned* driver: the platform never claims that person is the one driving (spec Module 13), until a driver-identification device exists.
- **Minimal driver data** (name, phone, email, licence number/class/expiry, notes). No national ID number, no photo, no home address: personal data is kept to what the feature needs (OQ-020 decides the rest).
- **Installation date is derived** from the open device assignment (not a separate field that could disagree with it).
- **Expiry status** (`EXPIRED`, `EXPIRING_SOON` within 30 days, `OK`, none) is computed on the server in one place and shown the same everywhere.
- **Dashboard:** vehicle, driver and device counts, live status counts (the same function as the map), open alerts, and a "needs attention" list (expired or expiring papers and driver licences, devices not reporting). **Distance travelled, utilisation, recent trips and notifications are NOT shown** — they need trips (M6) and notifications (M8) — and say so instead of showing placeholders.
- **Device assignment screens stay in M5b** (onboarding workflow); the vehicle page shows the installed device read-only.

### M5a as built (2026-11-02)

**Built:** full vehicle record (details, category, VIN, insurance/inspection expiry), vehicle categories, drivers (minimal data), one assigned driver per vehicle with append-only history, document **records** (no files, OQ-035), and a dashboard of real counts, live status counts (same rule as the map), the latest alerts and a "needs attention" list. Web: Vehicles list (search, filters, sort, paging), vehicle detail (details, papers, tracker read-only, assigned driver + history, documents), Drivers, categories dialog, real Dashboard. Navigation: Fleet → Vehicles, Drivers.
**Evidence:** `pnpm typecheck`, `pnpm lint`, `pnpm build` clean; Prisma drift check none; tests — shared 71, web 117 (incl. 18 page tests), API 279 (20 suites; 24 new in `fleet-management.e2e-spec.ts`: validation, conflicts, assignment rules, history immutability, documents, dashboard, permissions per role, other-tenant 404 on every new route, RLS, composite FKs) all passing. Browser (dev stack, real data): dashboard, vehicle list with 106 simulated trackers, create vehicle → detail → dashboard attention entry (expiry arithmetic checked: 20/10 vs 02/11 = 13 days).
**Level:** Tested; verified in a browser against the dev API. Not verified: phone/tablet layouts, a full manual run of the driver-assignment and documents dialogs in the browser (covered by automated tests only), step-up.
**Defaults the owner may overrule:** documents are records only; one assigned driver per vehicle and one vehicle per driver; minimal driver data; expiry window 30 days; "installed, never reported" flagged after 1 hour; no entitlement checks until M9.
**Not in M5a (M5b):** device catalogue, effective capabilities, onboarding, diagnostics, consent records, device assignment UI.

### M4 as built (2026-11-02)

**Delivered (level: verified in a real browser against the running stack, with the simulator through real Traccar):**
- **Live tracking page** `/app/live` (full-bleed): map as the main area; left panel with search, status filter chips (counts from the server's one status function) and a **virtualized** vehicle list; right detail panel for the selected vehicle (bottom sheet below 1024 px); "Fit to fleet", **follow mode** (lets go when the user pans or zooms), **full screen**, scale bar, zoom, attribution; connection indicator (Live / Reconnecting / Disconnected), "Tracking engine: connected / unavailable", "Last update … ago", and banners for engine unavailable, reconnecting and closed-by-server. Navigation: Fleet → Live tracking; the earlier page is now Fleet → Pipeline monitor (diagnostics).
- **Map**: ONE clustered GeoJSON source with symbol layers (never one DOM marker per vehicle), data pushed at most once per animation frame; status markers with their own **shape** per status (arrow turning with the heading, pause mark, "P", square, hollow and dashed circles) as well as colour; **red alert ring** (unacknowledged alert from the last 15 min); **"S" Simulated badge** on markers; clusters show their count and, on hover, the status breakdown; click a cluster to zoom in; the **selected vehicle is drawn on its own layer on top** (it was hiding inside clusters until found in the browser) with a halo and the **trail** of movement since the page opened. A vehicle without a position is listed and counted but never drawn (never at 0,0).
- **Map provider behind a port** (ADR-0008): `GET /maps/config`; development map = MapLibre + OpenStreetMap tiles, labelled "Development map", refused in production by the environment validation; Mapbox adapter prepared server-side, renderer **pending a token (OQ-034)**.
- **`GET /tracking/snapshot`** — the whole fleet in one consistent response (stable order, cut and flagged at 5,000), because the 100-row paged list would have left a 1,000-vehicle fleet mostly invisible.
- **Tenant safety in the UI**: the page is remounted when the active organization changes (test: nothing of the previous organization, including the selection, survives); API and socket isolation suites unchanged and green; snapshot isolation test added.
- **Engine status on connect** (stored in Redis by the fan-out, sent to each new socket) so the page never sits on "waiting for status".
- **Simulator**: a street-following circuit built from OpenStreetMap data (7.9 km, 366 points, one-way streets respected) used by the fleet, `pnpm sim drive` and the smoke test; fleets start spread along it. The hand-drawn loop stays for the scenarios. (Prompted by the owner noticing vehicles on houses and a circular look.)

**Measured (this laptop, Windows, Docker Desktop, everything else running; indicative, not production):**
| Check | Result |
|---|---|
| 1,000 simulated vehicles (~100 updates/s), ONE browser tab, 3 minutes | 51–58 fps; worst frame ≤ 135 ms (one 373 ms spike); JS heap flat at ~50–90 MB; 14 of 1,000 list rows in the DOM; 353 DOM nodes |
| Same, with SEVERAL tabs of the app open on the same fleet and the browser also driven by tooling | 0.3–12 fps with multi-second stalls — the laptop was starved; not reproduced with one tab. Treat the per-tab cost as real and the absolute numbers as environment-bound (M3b/M10 re-measure on a quiet host) |
| Production build served by `vite preview` | map, worker, clusters and live updates work (a defect where the build omitted MapLibre's worker was found and fixed) |
| Steady-traffic smoke test after M4 | position-to-socket p95 0.97 s (p50 0.51 s), routing-cache hit rate 91.7 %, 600/600 delivered, 0 errors |

**Tests:** shared 55, simulator 18, web 90 (new: 21 live-model, 12 page, 25 + 10 monitor model/page), API 255 in 19 suites (new: maps endpoint and providers, environment rules for the map, snapshot endpoint and cap, engine status on connect). Typecheck, lint, build pass; migration check unchanged (no migration in M4).

**Not met / not done (be explicit):**
1. **Success Milestone 1 item 7 says "on Mapbox": the Mapbox renderer is NOT built or verified** (no token; OQ-034). The vehicles are shown on a development OpenStreetMap map. Everything else of Success Milestone 1 is demonstrated: register/login, organization, vehicle, device, Traccar, backend retrieves location, position updates automatically, another organization cannot see it.
2. **Phone and tablet layouts were not visually verified** (the browser tool could not resize the viewport). The responsive behaviour (drawer for the list, bottom sheet for details) is implemented and its logic is unit-tested only.
3. Not in the page yet (need later milestones): group-by (categories, M5), driver and device capabilities in the details (M5), history/trips links (M6), security actions (M7), reverse geocoding (M6, OQ-012), satellite layer (Mapbox), the full `alertActive` overlay (M8; M4 uses "unacknowledged alert in the last 15 min").
4. The trail shows movement since the page was opened (history arrives in M6).
5. Accessibility: the map canvas is not keyboard-navigable by itself; the vehicle list is the keyboard route to every vehicle and detail. A fuller audit is not done.

**Findings worth keeping:** MapLibre's worker needs explicit bundling for Vite (ADR-0008); MapLibre markers need a position before `addTo`; querying clusters with `queryRenderedFeatures` (not `querySourceFeatures`); restarting the dev API with workers enabled re-registers thousands of stale load-test devices in Traccar (use `WORKERS_ENABLED=false` for load runs; clean the dev database properly — see the M4 report).

### M3a as built (2026-11-02)

M3 was split by the owner on 2026-11-02 after the profiling report: **M3a** (everything below) is correctness plus the platform's own responsiveness; **M3b** (the scale proof) is a separate item scheduled just before M10, on a separate Linux host.

**Delivered (level: verified with simulator through real Traccar; checks in the done-check report):**
- `deriveStatus` — the single shared definition; `nextStatusDeadline` (the next instant a vehicle's status could change by time alone) with a property test that it is never later than the real first change. Status is derived at read time, pushed on change, counted by `GET /tracking/summary`; thresholds from config.
- Pipeline: invalid/(0,0) → heartbeat; duplicate; out-of-order; delayed/buffered (flagged, no real-time alerts); clock-skew clamp; implausible jump with a 3-fix re-baseline; tri-state values; stationarity tracking; serialised by an exclusive lock shared with the sweeper.
- **Live state (ADR-0007):** the ingestion leader owns the latest state in memory; Redis is written in batches (250 ms) by one atomic script that is rejected unless the lease key still holds the leader's token, so an old leader cannot overwrite the new one; a new leader warms up with one bulk read from Redis (or rebuilds from PostgreSQL if Redis was lost); PostgreSQL gets one multi-row upsert per ≤ 1,000 vehicles every 30 s (and at once on a status change) that never moves a row backwards; graceful shutdown flushes Redis and PostgreSQL before the lease is released. Failover test: a position sent while no instance leads is visible after the takeover.
- **Offline sweeper = deadline index:** a Redis sorted set scored by each vehicle's next status deadline (its own offline threshold, or idle/parked for a stopped vehicle); one range query returns everything due. Test: a sweep over an organization with 2,000 vehicles makes exactly one range query and loads no organization.
- Socket.IO gateway (handshake auth, `org:<id>` rooms, per-vehicle rooms checked, Redis adapter with the environment's key prefix, coalescing, periodic re-validation); alerts (`alert_rules` / `alerts`, forced RLS; overspeed, ignition on/off, device offline; cooldown; delayed data suppressed; acknowledge; rule CRUD).
- Simulator: scenario framework and **12 scenarios** (all pass against real Traccar), fleet load generator with an optional engine-feed observer (platform latency separated from the engine's), and the **steady-traffic smoke test**.
- **Live monitor page** (`/app/monitor`, web app; added 2026-11-02 at the owner's request so M3a can be SEEN): a temporary, honest view of what the pipeline holds for the active organization — REST snapshot, then deltas over the real Socket.IO feed merged by fix time; status counts from the server, vehicle table (status with icon + text, speed, ignition, position, last fix / last message, Simulated / Delayed / No-fix badges, unknown shown as Unknown / —), alerts with acknowledge, alert rules (+ "add demo rules"), the thresholds in force, a live-feed log, connection and engine status. It is NOT the M4 live map and will be replaced by it. Tests: 25 model + 10 page tests (mocked API and fake socket). Verified in a real browser against the running stack (6 simulated vehicles; overspeed alerts raised and acknowledged live); phone/tablet widths were NOT visually verified (the browser tool could not change the viewport). Supporting server change: a client that connects later is told the current engine status at once (stored by the fan-out in Redis; realtime e2e test).
- **Routing cache** (found by profiling): lifetime configurable (`ROUTING_CACHE_TTL_SEC`, default 300 s, longer than any reporting interval), invalidated on every instance over Redis pub/sub; hit/miss statistics exposed.
- **Test isolation:** separate compose project for tests (own Postgres/Redis/Traccar on their own ports, wiped by `pnpm test:reset`), the global setup refuses to wipe anything else and starts every run clean, one Redis key prefix and ingestion-lease name per test file, endpoints forced to the test stack even when the shell exports development URLs, cleanup when the last app of a file closes.

**Steady-traffic smoke test (2026-11-02; 50 devices × 10 s × 2 min; production defaults; test stack on the Windows dev laptop):**
| Criterion | Required | Measured |
|---|---|---|
| Routing-cache hit rate | > 90 % | 91.7 % (550/600; the 50 misses are each device's first position) |
| p95 position-to-socket (engine feed emit → browser socket) | < 2 s | **0.96 s** (p50 0.50 s) |
| Delivery, own vehicles only | all | 600/600 deltas, 50 distinct vehicles |
| Errors | none | 0 failed requests, 0 socket drops, 0 pipeline errors / drops |
End to end from the engine's receipt the same run was p50 3.6 s / p95 4.0 s — the engine's own ~3 s buffering is most of it.

**Profiling history (informative; laptop numbers, not production):** Node was never CPU-bound (60–70 % idle, event-loop delay p99 18 ms). Defects found and fixed: routing cache TTL (5 s) below the reporting interval (10 s) so it never hit; write-through of ~1,000 vehicles row by row in one transaction that exceeded Prisma's 10 s limit; a per-vehicle database lookup inside the lock on every first position; Redis closed while commands were in flight at shutdown; the load generator counting other vehicles' deltas. 1,000 devices (~100 positions/s) went from p50 57 s / p95 89 s to all positions delivered; at that rate the engine's own feed already lagged (p50 3.1 s / p95 11 s) on that machine.

**M3b — scale proof (moved to just before M10; separate Linux host; OQ-032):**
1. 2,000 devices at 10 s (~200 positions/s) with the platform's p95 position-to-socket < 2 s, the load generator on a second machine.
2. Traccar report latency vs dataset size (`/api/reports/route`, `/trips`, `report.maxPositions`) → confirm or amend **ADR-0004 (pending M3b)**.
3. RLS + per-request transaction overhead on ~200 k rows → confirm or amend **ADR-0003 (pending M3b)**.

**Deviations / not built in M3a:** the geofence scenario asserts engine-level events only (platform geofences are M6); trip assertions wait for the trip rules (M6, OQ-007/033); the offline sweeper is a leader timer, not a BullMQ job (stateless scan; ADR-0007); per-organization threshold overrides and `alertActive` overlay are deferred (M8); no default alert rules until M8; deadlines are computed when written, so a global threshold change needs a leader re-warm; the leader is a single process (ADR-0007 option 3 if it ever becomes the limit); Redis must be a single instance (the fenced script touches undeclared keys).

**Known issues and risks:** an ungraceful leader crash loses at most one Redis flush interval of state changes (the next leader's backfill repairs positions; `stationarySince` may restart); development on Windows with the repo on `D:\` is slow and flaky (move to WSL2 on the Linux file system — see CLAUDE.md); orphaned `jest` processes from a failing run keep consuming the engine and must be killed by PID.

### M2 as built (2026-11-01)

**Delivered:** Traccar **6.16.0** in Compose (own database, internal admin port, auto-registration off, position filters); `GpsEnginePort` + Traccar adapter (client with single-flight re-auth, timeouts, GET-only retry, circuit breaker; WebSocket consumer with backoff+jitter and heartbeat; zod schemas from recorded fixtures) and a fake engine for unit tests; minimal vehicles; GPS devices with ownership vs operation, globally unique identifiers, engine sync that never loses a registration, and append-only assignment history; leader-leased ingestion with backfill; per-tenant latest state; `GET /tracking/positions` and `/vehicles/:id/location`; platform engine health + reconciliation (daily BullMQ job, never deletes); basic simulator (`apps/simulator`) and `create-sandbox-org`; 2 new migrations of hand-written SQL (partial/expression indexes, CHECKs, triggers, forced RLS); ADR-0006; `docs/GPS_INTEGRATION.md` rewritten from verified facts.
**Evidence:** `pnpm typecheck`, `lint`, `build` clean; Prisma drift check none; tests — simulator 12, shared 11, web 22, API 180 (12 suites; includes 23 GPS pipeline e2e against real Traccar, 15 database-invariant, 20 pipeline-logic unit, 21 adapter unit) all passing. **Level: verified with simulator** (real Traccar + real pipeline). Also run live on the dev stack: the simulator CLI drove a registered vehicle at ~40 km/h and the API reported it as `simulated: true`.
**Not verified on hardware** (no tracker yet): everything about real devices — protocol ports, attributes, buffering, command behaviour (OQ-002, OQ-018, OQ-019).

**Findings that changed the design** (details: GPS_INTEGRATION.md, ADR-0006): the engine stores bad data as valid ((0,0), duplicates) and pushes only positions that advance the latest fix — one future-dated fix froze a device's live feed under the default 24 h tolerance (now 10 min); OsmAnd `speed` is knots; ingestion latency ≈ 3.3 s by design; commands are queued by Traccar (hazard for M7); events reach the socket only with a web notification; a swapped lat/lon created an 11 642 km "trip".

**Deviations from the plan:**
- Reconciliation, device sync and admin diagnostics were small additions beyond the roadmap bullet list; the `GET /tracking/vehicles/:id/history`/`trips` endpoints remain M6.
- **No web UI in M2.** Roadmap M2 has none and screens without a working backend are forbidden; the live page is M4.
- Traccar's REST port is published on localhost in dev only (so the host-run API can reach it); production keeps it internal.
- The routing cache is in-process (5 s TTL), not Redis; M3 moves it.

**Known limitations:** the ingestion path writes the live state on every accepted position (no throttling yet, M3); no status derivation (moving/idling/parked/offline) — the API returns raw latest values only; badly clocked devices (>10 min ahead) are dropped by the engine without a customer-visible signal (OQ-030); one Traccar instance, unmeasured under load (OQ-009/031).

### M1 as built (2026-11-01)

**Delivered:** pnpm monorepo (`apps/api`, `apps/web`, `packages/shared|config`); Docker dev infrastructure (Postgres 17 with three roles, Redis 7); Prisma schema + 2 migrations (RLS, triggers, append-only audit); auth (register, email verification, login/logout, refresh rotation with reuse detection, password reset/change, optional TOTP + recovery codes, step-up, session list/revoke, lockout); organizations, members, invitations, roles, permission catalogue and default role bundles; tenant-context / permission / step-up guards; audit log; development email adapter; seeds and the `create-super-admin` CLI; React app with auth flows, customer shell, **separate** platform-admin shell, organization settings, users & permissions, account/security page.
**Evidence:** `pnpm typecheck`, `pnpm lint`, `pnpm build` clean; tests — shared 11, web 22, API 85 (17 unit + 68 e2e incl. 32 tenant-isolation, 17 permission/step-up/route-inventory, 19 auth) all passing against real PostgreSQL and Redis; Prisma migration drift check: none. Browser check (1440 px and 390 px): sign-up → verify → sign-in → dashboard, users, organization, account, platform-admin shell.

**Deviations from the plan (all deliberate; none changes the spec):**
- **Plan/entitlement skeleton deferred.** `subscription_plans`, `plan_entitlements`, `EntitlementService` and the `@RequireEntitlement` guard were *not* built: nothing in M1 is plan-gated and an allow-all stub would be a fake check. `GET /auth/me` returns `entitlements: {}`. Build them with the first plan-gated feature (geofencing, M6) or M9, whichever comes first.
- **Docker environment covers infrastructure only** (`pnpm infra:up` → Postgres + Redis). API and web run on the host (`pnpm dev:api`, `pnpm dev:web`); application Dockerfiles/compose arrive in M10. Host ports are non-default (Postgres 54329, Redis 63799, API 3100, web 5273) because other projects on the development machine use the usual ones.
- **Email is a development adapter** (logs + in-memory outbox); production configuration refuses it. A real provider is M8 (OQ-022).
- **i18n is partial:** navigation labels and API error messages go through `t()`/`errorMessage()`; page copy is still inline English.
- **No `positions`/vehicle tables, no countries endpoint:** onboarding creates organizations in Rwanda by default (country is configuration; only Rwanda is enabled in the seed).
- **Dependency majors chosen for known behaviour, not "latest":** NestJS 11, Prisma 6.19, zod 4, TypeScript 5.9, Vite 7, React 19, Vitest 3. Newer majors exist (Nest 12, Prisma 7/8, TypeScript 7); upgrading is a separate, tested task.
- Shared package builds to `dist` (tsup, ESM+CJS) for the API; the web app aliases the TypeScript source.

**Known limitations to track:** per-IP rate limiting is in-memory (single instance); the 10-second refresh-race grace window (ADR-0002); web bundle is ~590 kB before code-splitting (revisit when Mapbox lands); reseller access to child organizations is read-only until M9; `prisma migrate dev` generation next to hand-written SQL is unverified (OQ-014).

## Working rules

- Each milestone ends with the `gps-done-check` report (typecheck, lint, tests, migrations, build, integration/simulator checks, docs) and stops for owner confirmation.
- Per-module workflow (spec §17.2): purpose → workflows → dependencies → entities → endpoints → authorization → failure scenarios → backend → frontend → end-to-end test → docs. Steps 1–7 go into the module README *before* coding.
- No frontend screen without a working backend. Real integrations over mocks; development adapters are clearly labelled.

## Long-lead items (start early, in parallel with engineering)

| Item | Start by | Needed by | Open question |
|---|---|---|---|
| Legal advice on data protection & hosting | now | M10 (design inputs earlier) | OQ-001, OQ-020, OQ-028 |
| Order test hardware, SIMs, bench kit | after M1 | M4 (Success Milestone 2), M7 | OQ-002, OQ-010, OQ-026 |
| Installer partner for immobilizer tests | M4 | M7 | OQ-015 |
| Payment provider merchant applications | M5 | M9 | OQ-011 |
| Mapbox account/terms review | M3 | M4 | OQ-012 |
| Email/SMS provider selection | M6 | M8 | OQ-022 |
| Reseller commercial model decision | M6 | M9 | OQ-023 |

## Milestones

### M1 — Foundation  (L)
**Step zero:** verify Node/pnpm/Docker on the dev machine; spike OQ-014 (Prisma + RLS + composite FKs + `set_config`); record outcome in ADR-0003.
**Scope:** pnpm workspace; `apps/api`, `apps/web`, `packages/shared|config`; Docker dev environment (Postgres, Redis, Mailpit); Prisma + first migrations incl. RLS, roles (owner/app/system); auth per ADR-0002 (register, login, logout, refresh, recovery, email verification, sessions, optional TOTP, step-up); organizations, members, invitations; permission catalogue, system roles, guards; tenant-scoped Prisma client; web app shell with distinct customer/admin navigation and empty states (no KPI dashboard); audit log; pino logging with redaction; config validation; CI pipeline.
**Exit:** users register, log in, create organizations and manage users; mandatory fixture (Org A, Org B, Reseller R1→C1, R2→C2) and isolation + permission + auth tests pass; RLS test (set / unset context); route-scan test (every route has a permission decorator or `@Public()`); migrations apply from scratch; typecheck/lint/build clean.
**Risks:** OQ-014, R-03, R-06, R-25.

### M2 — Traccar integration and device registration  (L)
Pin Traccar version (OQ-003) and verify OQ-004/005/008; Traccar in compose (internal network, own DB, `registerUnknown` off); `GpsEnginePort` + Traccar adapter with recorded fixtures; device registration/sync (idempotent) + reconciliation job; minimal vehicle and `device_assignments`; WebSocket consumer with leader lock, reconnect, backfill; position retrieval; basic simulated device (OsmAnd) with `isSimulated` guards; `GET /tracking/positions`, `/location`.
**Exit:** the application retrieves positions from the real Traccar for a registered device; unmapped devices dropped and counted; adapter tests pass (units, WKT helper stub, 401 re-auth, reconnect+backfill). **Order test hardware now.**

### M3 — Simulator and ingestion pipeline  (XL) — split into M3a (done) and M3b (before M10)
Full scenario simulator (11 scenarios per skill); normalization, validation, anomaly handling; `deriveStatus` with exhaustive tests; Redis latest state + ring buffer + `vehicle_live_state`; coalesced Socket.IO fan-out; offline sweeper; alert-rule evaluation skeleton; **measurements**: Traccar report latency, 2,000-device load, RLS overhead → confirm or amend ADR-0004 and ADR-0003; `docs/SIMULATOR.md`.
**Split (2026-11-02):** M3a = everything except the measurements; M3b = the measurements (Traccar report latency, 2,000-device load, RLS overhead) on a separate Linux host just before M10.
**Exit:** every §9 scenario runs repeatably against real Traccar with automated assertions in CI.

### M4 — Live tracking on Mapbox  (L)
Live page (map primary, list panel, search/filter, info panel, clustering, status markers incl. alert overlay and "Simulated" badge, follow mode, full-screen); socket client merge-by-fixTime; honest "engine unavailable / last update" states; visual verification per `gps-fleet-ui`.
**Exit = Success Milestone 1 (spec §20):** register/login, create org, register vehicle and device, connect through Traccar, backend retrieves location, vehicle shown on Mapbox and updating, another organization cannot access it. **Attempt Success Milestone 2 (real tracker) as soon as hardware is in hand.**

### M5 — Vehicles, catalogue, onboarding, drivers, dashboard  (XL) — split into M5a (vehicles, drivers, categories, documents, dashboard) and M5b (catalogue, capabilities, onboarding, diagnostics, consent)
Full vehicle/driver/category/document management; device lifecycle (ADR-0005), reassignment history, replacement; device catalogue & certification (statuses per spec, evidence records); effective-capability computation; onboarding workflow incl. first-signal detection; diagnostics tools; KPI dashboard from real data; consent/acknowledgement records (OQ-020).
**Exit:** a customer onboards a simulated or real device end-to-end and sees its effective capabilities; first catalogue entries for the physical test devices recorded as **Supported but not physically verified** until bench-tested.

### M6 — Trips, playback, geofencing  (L)
History/trips via engine port with assignment-window and entitlement clipping; playback UI (play/pause/stop/speed/timeline); geofence CRUD + WKT conversion (lat-first) + Traccar sync; enter/exit events; dwell (native or delayed jobs, OQ-007); geofence notification rules.
**Exit:** replay a simulator trip; receive geofence events from scenarios; reassignment test (A→B history windows).

### M7 — Vehicle security and safe immobilization  (XL)
Per `docs/VEHICLE_SECURITY.md`: capability gating; precondition gate (pure function, exhaustively tested); state machine with BullMQ timeouts; evidence-based EXECUTED; restoration & emergency restoration; append-only security events; security dashboard; owner/security-manager notifications; emergency runbook finalised. **Bench test** (tracker + relay + test lamp) → OQ-006, OQ-018, OQ-019 resolved and recorded → **controlled vehicle test** with professional installer, stationary, engine off.
**Exit:** full workflow tested (automated + bench/controlled device); no live engine-shutdown path exists anywhere (code search for forbidden identifiers is part of the check). Customer availability additionally requires OQ-015.

### M8 — Notifications, reports, analytics  (L)
In-app and email notifications with queues/retries/cooldown; SMS & WhatsApp ports (disabled adapters); all reports; PDF/XLSX/CSV exports through signed URLs; Recharts visuals from real data only.
**Exit:** alerts reach users via configured channels; exports correct against known simulator data.

### M9 — Speed governor compliance  (XL) — NEW (spec Module 18, rev. 1.2)
Governor installation records (set speed, RURA sticker, seal, calibration, warranty, six-monthly inspections with reminders); ≤ 5 s speed records retained and retrievable; violation and tamper detection with real-time alarms to the provider; automated SMS on device offline; quarterly online/offline report; read-only Regulator portal (`REGULATOR` organization type); regulator transmission outbox with a labelled development adapter until RURA's interface and Annex A are obtained (spec B13–B16); compliance pack; simulator governor scenarios. Needs SMS and reports from M8; the owner may move it ahead of M7 if a governor supplier is the first committed customer.
**Exit:** see spec §17.4 M9 row.

### M10 — Installations, provider billing, platform administration  (XL) — was M9
Provider inventory & installation workflow with technician completion record and verification; provider plans/entitlements as data (incl. the speed-governor add-on); active-device usage metering with explainable statements; payment gateways (MTN MoMo / Flutterwave sandbox) with verified, idempotent webhooks and reconciliation; invoices, reminders, grace and suspension; provider management in platform admin; customer transfer between providers.
**Exit:** a provider's monthly invoice matches its active devices, is paid in a sandbox, and late payment follows the documented grace/suspension behaviour without data loss.

### M11 — Scale proof and production launch  (L) — was M10
**Prerequisite (owner decision 2026-11-02): M3b** — the 200 positions/s proof, Traccar report latency and RLS overhead on a separate Linux host — must be done before M10 and may be done earlier.
Production compose, Nginx, TLS, firewall for device ports, backups + restore drill, monitoring/error tracking, security review (incl. auth rotation/reuse, RLS, secrets), load test and documented results, deployment runbooks, privacy notice/ToS (OQ-028), hosting decision (OQ-001/021).
**Exit:** deployed with runbooks; Success Milestone 2 achieved if not earlier.

## Dependencies at a glance

```
M1 → M2 → M3 → M4 ──► (Success M1)
             │     └► M5 → M6
             └──────────► M7 (needs M5 catalogue/installations data model, hardware, OQ-018/019)
M6 → M8 ;  M5 → M9 ;  all → M10
```
Note: M7's installation verification dependency is satisfied in M7 by a minimal manual "installation verified" record; the full installation workflow arrives in M9 (consolidation decision — flagged for review).
