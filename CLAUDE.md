# CLAUDE.md — GPS fleet platform

Commercial multi-tenant GPS tracking / fleet management / vehicle security SaaS (Rwanda first, international by configuration). Stack: React + TypeScript + Vite + Tailwind/shadcn · NestJS + Prisma + PostgreSQL · Redis + BullMQ · Socket.IO · Traccar as GPS engine · Docker on Ubuntu VPS.

**Requirements:** `docs/PROJECT_SPEC.md` (wins on any conflict). **Design:** `docs/ARCHITECTURE.md`, `DATABASE_DESIGN.md`, `API_DESIGN.md`, `GPS_INTEGRATION.md`, `DEVICE_COMPATIBILITY.md`, `SIMULATOR.md`, `VEHICLE_SECURITY.md`, `DEVELOPMENT_ROADMAP.md`. **Decisions:** `docs/adr/`. **Unverified facts:** `docs/OPEN_QUESTIONS.md`.

## Status
Phase 0, M1, M2, M3a, **M4 and M5a approved (owner, 2026-11-02; M4 uses the open development map, ADR-0008 — the Mapbox renderer needs a token, OQ-034). M5 was split: M5a (vehicles, drivers, categories, documents, real dashboard) is approved; M5b (catalogue, capabilities, onboarding, diagnostics, consent) is IN PROGRESS.** **M3 was split (owner decision 2026-11-02): M3a = correctness of the pipeline, real-time layer, alerts and 12 simulator scenarios — approved. M3b = the load/scale proof (200 positions/s, Traccar report latency vs dataset size, RLS overhead) — moved to just before M10 and run on a separate Linux host; ADR-0003 and ADR-0004 are "pending M3b".** **M1b (provider hierarchy retrofit, spec rev. 1.2) and M5b were approved by the owner on 2026-11-04. M6 was split by the owner (2026-11-04) into M6a (trips and playback — implemented, awaiting review) and M6b (geofences — not started).** Milestone numbers changed on 2026-11-04 (M9 = speed governors, old M9 → M10, old M10 → M11). Do not start M6b until the owner approves M6a. Update this section and `docs/DEVELOPMENT_ROADMAP.md` at each milestone boundary.

**Development environment:** development is meant to run inside **WSL2 (Ubuntu) with the repository on the Linux file system** (e.g. `~/gps`, not `/mnt/d/...`), with Docker integrated into WSL2. The M1–M3a work was done on Windows with the repo on `D:`, where file watching, Docker port forwarding and process cleanup are slower and flakier; measure performance on Linux (M3b), not on that setup.

## Commands (verified in M1/M2; Node 24, pnpm 12)
```
pnpm install
pnpm infra:up            # Postgres (host 54329) + Redis (63799) + Traccar 6.16.0 (REST 58082, OsmAnd 55055); first start creates roles/DBs
pnpm infra:ensure-db     # only for a Postgres volume created before M2 (creates Traccar's own DB/user, idempotent)
cp .env.example apps/api/.env   # then set TRACCAR_USER/TRACCAR_PASSWORD (see "Traccar service admin" below)
pnpm build:shared        # builds shared + simulator to dist (required before running/testing the API)
pnpm db:migrate          # prisma migrate deploy (runs as gps_owner)   |   pnpm db:seed  # idempotent reference data
pnpm --filter @gps/api cli create-super-admin --email <e> --name "<n>"   # prints a one-time password
pnpm --filter @gps/api cli create-sandbox-org --name "<n>" --owner-email <existing user>   # only place SIM- devices may live
pnpm sim drive --id SIM-DEMO-0001 --duration 60   # simulator -> OsmAnd -> Traccar -> platform (device must be registered+assigned first)
node --env-file=.env test/fixtures/traccar/capture.cjs   # (in apps/api) re-record Traccar fixtures after an engine change
pnpm dev:api             # NestJS on :3100 (Swagger at /api/docs)       |   pnpm dev:web  # Vite on :5273 (proxies /api)
pnpm typecheck && pnpm lint && pnpm test && pnpm build
pnpm test:infra:up                         # isolated TEST stack (compose project gps-test): Postgres 54339, Redis 63809, Traccar 58092/55065 + its own Traccar admin in apps/api/.env.test (pnpm test does this itself)
pnpm test:reset                            # destroy the test stack's volumes and rebuild it from scratch   |   pnpm test:infra:down
pnpm --filter @gps/api test:e2e          # API e2e on the test stack (serial); never touches development data
pnpm --filter @gps/api test:smoke        # steady-traffic smoke test: 50 devices, 10 s interval, 2 min (part of the done-check, ~3 min)
pnpm --filter @gps/api exec prisma migrate dev --name <change>   # new migration (add raw SQL for RLS/triggers by hand)
```
Dev email is logged by the API (development adapter) — verification/reset/invitation links appear in the API log.

## Conventions learned in M1
- Global tables via `PrismaService`; tenant tables **only** via `TenantPrismaService.run()`; `SystemPrismaService` only for the reviewed uses listed on the class.
- Every route needs `@Public()`, `@Authenticated()`, `@NoTenant()` or `@RequirePermissions(...)` — a test fails otherwise. Org-scoped routes use `/organizations/:organizationId/...`.
- New tenant table ⇒ `organization_id`, composite FKs, `ENABLE`+`FORCE` RLS in the migration, isolation tests. A test fails if a table with `organization_id` lacks forced RLS.
- Never edit an applied migration; add a new one. `nest build` must not use incremental compilation (stale `dist`).
- Host ports 5432/5433/6379/3000/5173 are used by other projects on the dev machine — do not change this repo back to them.

## Conventions learned in M2
- **Traccar service admin:** on a fresh Traccar the first `POST /api/users` becomes administrator (then registration closes). Create `gps-service@platform.local` with a random password and put it in `apps/api/.env` as `TRACCAR_USER`/`TRACCAR_PASSWORD`. Do NOT use `web.serviceAccountToken` (see ADR-0006).
- Traccar env-var names split camelCase on capitals (`database.registerUnknown` → `DATABASE_REGISTER_UNKNOWN`); a misspelt variable is silently ignored — verify settings by behaviour, not by absence of errors.
- Anything Traccar-related must be justified by a recorded fixture or a test against the real container (`docs/GPS_INTEGRATION.md`). The fake engine proves nothing about live tracking.
- Positions take ~3.3 s to arrive (engine buffering); e2e tests wait with `eventually(...)`. Timestamps sent to the engine must advance (only newest fixes are pushed) and must not be > 10 min in the future.
- Never build inline code with `node -e`/heredocs containing backticks or `$` — the shell mangles it. Use the Write/Edit tools.
- Jest e2e suites share one Redis db and one Traccar; unique ids per run (`RUN` suffix) keep them independent; tests delete engine devices they created.

## Conventions learned in M3 (pipeline and load)
- **Test isolation:** tests run against their OWN stack (`infra/docker-compose.test.yml`, project `gps-test`), never the development services; `test/setup-env.ts` forces the test endpoints even if the shell exports development URLs, and `test/global-setup.ts` refuses to wipe anything that is not that stack. Every run starts by truncating tenant data, deleting all test Traccar devices and flushing the test Redis. Every test FILE gets its own Redis key prefix (`REDIS_KEY_PREFIX`, which also gives it its own ingestion-lease name; pub/sub channels, the Socket.IO adapter key and the BullMQ prefix carry it too) and `ctx.close()` removes the file's Redis keys and engine devices once the LAST app of the file has closed (closing a secondary app must not pull the lease from the primary). API tests run serially (`--runInBand`): the suites share one Traccar and one PostgreSQL. ioredis `keyPrefix` does not apply to `KEYS` patterns (add the prefix yourself in tests). The database has append-only history, so tenant data is removed by `pnpm test:reset` / the global setup (superuser TRUNCATE), not per test.
- **A hung Jest run is almost always a FAILING run that left apps open**; orphaned `jest` node processes keep consuming Traccar and holding leases. Run long suites with `timeout …` and `--forceExit`, send output to a file, and kill leftovers by PID (never by name: other projects run node on this machine).
- **Steady-traffic smoke test (done-check):** 50 devices / 10 s / 2 min, production defaults. Requires routing-cache hit rate > 90 %, p95 position-to-socket < 2 s (measured from the ENGINE's own feed to the browser socket, so Traccar's buffering is not blamed on the platform), no errors, own vehicles only; cache lifetimes come from configuration and must exceed the reporting interval. Run it after any change to the pipeline, caches, fan-out or persistence.
- **Live state (ADR-0007):** the ingestion leader owns the latest state in memory; Redis is written in batches by one Lua script that is rejected unless the lease key still holds the leader's token (`LiveStateStore.flushRedis`); a new leader warms up with one bulk read; PostgreSQL gets a coalesced multi-row upsert that never moves a row backwards. Nothing in the pipeline's exclusive lock may wait for Redis or PostgreSQL. The offline sweeper reads a sorted set of review deadlines (`nextStatusDeadline`), never the whole organization. Time written by the application and time written by the database (`now()`) differ by up to a second between host and container: never compare them without slack (see `DevicesService.unassign`).
- **Inside the pipeline's exclusive lock, do only what ordering needs** (one Redis read, one Redis write). Never await PostgreSQL there; no per-vehicle database lookups (a Redis miss means "new vehicle" unless the organization's hash is gone). Batch DB writes: one statement per chunk, never row-by-row in an interactive transaction (10 s timeout). Prisma binds an all-null JS array as `integer[]` — pass rows as one JSON parameter and type them in SQL.
- Any cache on the position path needs a TTL **longer than the reporting interval**; if the TTL is long, invalidation must reach every API instance (Redis pub/sub).
- Redis closes with `QUIT` after all shutdown hooks; fire-and-forget Redis writes must carry a `.catch`.
- **Load runs:** delete `SIM-F*` devices from Traccar first (the leader backfills every engine device on start-up and thousands of leftovers delay live positions), use a fresh sandbox organization, and measure Traccar's own feed lag with a second WebSocket listener to split engine latency from ours. `pnpm sim fleet --count N --interval 10 --duration 150` needs `THROTTLE_DEFAULT_LIMIT` raised on the API. Do not conclude from a run in which the generator itself fell behind (`sent` much lower than offered). Node was not CPU-bound; check event-loop delay before blaming code.
- `pnpm sim scenario <name|all>` runs the 12 scenarios against a running API (`docs/SIMULATOR.md` §9); `test/scenarios.e2e-spec.ts` runs them all with compressed thresholds.


## Conventions learned in M4 (live map and web)
- **The map sits behind a provider port** (`GET /maps/config`, ADR-0008). The browser never holds map configuration, tokens or tile URLs of its own. Development map = MapLibre + OpenStreetMap tiles (refused in production by the environment validation); Mapbox renderer is pending a token (OQ-034). Never send a secret (`sk.`) token to a browser.
- **MapLibre's web worker must be bundled by Vite** (`import … from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'` + `setWorkerUrl`, with `worker.format: 'es'`). The library's default worker lookup breaks Vite's dev pre-bundling AND is missing from the production build; check any map change against a served production build (`vite build` then `vite preview`), not only the dev server.
- **Draw vehicles as ONE clustered GeoJSON source with symbol layers, never one DOM marker per vehicle**; push data at most once per animation frame; the only DOM elements are the cluster count labels (read from `queryRenderedFeatures`, and a MapLibre `Marker` needs `setLngLat` BEFORE `addTo`). The selected vehicle is drawn on its own layer on top and left out of the clustered set (otherwise it hides inside a cluster).
- **A page that shows tenant data is remounted when the active organization changes** (`key={organizationId}` on an inner component) so nothing of the previous tenant survives in state, refs or the map; there is a test for it. Use the shared `useLiveFleet` hook for snapshot + deltas (merge by time, never backwards).
- **The live map starts from `GET /tracking/snapshot`** (whole fleet, stable order), not from the 100-row paged list; a delta for an unknown vehicle triggers a fresh snapshot.
- **Unknown is shown as Unknown / —, a vehicle with no position is listed but never drawn (and never at 0,0), simulated vehicles always carry the badge, every status has its own shape as well as its colour.**
- jsdom has no WebGL, layout or `ResizeObserver`: unit tests replace the map and the list virtualizer with stand-ins and test the pure model; the map itself is checked in a real browser with a large simulated fleet (`pnpm sim fleet --count 1000`, one browser tab; several tabs on the same laptop starve each other and give meaningless frame rates).
- Restarting the dev API with background workers on runs the device reconciliation, which re-creates in Traccar any device it finds missing (thousands of stale load-test devices after a cleanup). For load runs start the API with `WORKERS_ENABLED=false`, and clean `SIM-F*` devices from the engine first.
- Scripts written through a shell heredoc break on apostrophes and backticks: write helper scripts with the file-writing tool, then run them.

## Conventions learned in M5a (fleet records)
- **Optional means unknown:** an unset field is `null`, never a default; the UI shows a dash / "Unknown" / "Not set". Expiry is computed once, by `expiryOf` in `packages/shared/src/fleet.ts`, against the organization's calendar day (`OrgClockService`); a missing date is "Not set", never "OK".
- **Hand-written unique indexes report `target: null` inside an interactive transaction** (Prisma P2002), so the rule that failed cannot be read from the error. Decide by looking (e.g. is this VIN already on a live vehicle?), as `VehiclesService.mapError` does.
- **Assigned is not driving.** Driver wording is "assigned driver"; history rows are append-only (trigger + REVOKE DELETE). The system role cannot rewrite a closed row, so tests that need an "old" assignment insert one with an earlier `assignedAt`.
- **Sections depend on permission:** the dashboard returns `null` for drivers/devices/alerts the caller may not read; the UI hides them and never asks for data it may not see.
- Document **records** only; files wait for OQ-035. Audit entries name changed fields, not personal values.
- Web: pages that show tenant data are remounted by organization (`key`), forms keep strings and convert with the pure helpers in `fleet-model.ts` (empty → `null`).

## Conventions learned in M5b (catalogue, onboarding, diagnostics, consent)
- **Capabilities are computed, never stored or inferred from a name** (ADR-0009): `effectiveCapabilities()` in `packages/shared/src/catalogue.ts` is the one definition used by the API and the web app. No catalogue row = UNKNOWN (not "not supported"); an unverified model is never shown as verified; `remote_immobilization` is never effective (state DISABLED) until M7. The catalogue starts with ONE entry, the simulator profile (not hardware, can never be VERIFIED — a database rule). No physical device has been bench-tested.
- **Evidence rules live in the database** (triggers on `gps_device_variants`, `variant_capabilities`, `consent_notices`): VERIFIED needs a verification row; published notices are immutable; `device_status_history`, `consent_records`, `variant_verifications` are append-only. Map trigger messages to stable API codes (`mapRuleError`). Tests that need an "old" history row insert it with an earlier `at`/`assignedAt`.
- **One writer of lifecycle status:** `apps/api/src/modules/devices/device-lifecycle.ts` (compare-and-set + history). The first usable position activates a pre-active device from the pipeline's existing off-hot-path device write (self-healing for devices that already had a first signal).
- **Global catalogue tables have no RLS** and are written only by `platform.*` routes; customers read the listing without tester names. Platform tools that cross tenants use the system role (reviewed use #4 on `SystemPrismaService`), read-only apart from audited actions, and return no coordinates.
- **Tests:** the seed publishes a draft tracking notice after the test wipe, so the test environment sets `DEVICE_CONSENT_REQUIRED=false`; the consent suite boots with it `true`. `global-setup` also truncates the catalogue tables. Catalogue tests use unique names per run.
- **Consent is a mechanism, not legal text:** wording is data flagged `isDraftWording` and shown as such (OQ-020, OQ-037). The shipped notice is unreviewed.
- Web: while a device waits for its first signal the page polls every 5 s and nothing else polls; a missing fact is shown as "Not available yet", never invented; "what we do not know" lists come from the API (`missing`).
- Observed evidence only covers what the live state keeps (position, speed, ignition, motion). Power, battery, fuel and I/O stay "cannot be checked yet" until OQ-036 is resolved.
- Shell scripts built with heredocs containing backticks broke again; write scripts with the file-writing tool and run them.

## Conventions learned in M1b (provider hierarchy)
- **Words:** "provider" = a GPS tracking business (our paying customer); end customers are CUSTOMER organizations created and invited by their provider. No public sign-up except provider registration (`POST /providers/register`).
- **Every tenant table carries `organization_id` AND `provider_id`; never set `provider_id` in code** (a trigger fills and checks it; Prisma treats it as optional through the `app_null_uuid()` default). A request sets ONE RLS key: `runInOrganization` (customer) or `runAsProvider` (provider level, only for provider staff at their own provider; filter by `customerScope()` for scoped staff and never spread a scope filter over an `id` filter — use `AND`).
- **Provider staff are not members of customers.** `AccessService.resolve` derives their permissions (`permissionsActingOnCustomer`), enforces scope, and the guard logs the access. Provider staff never get security commands, ownership transfer, role management or the access log.
- **Test fixtures:** `registerUser(ctx, { organizationName })`, `createOrg` (customer) attach to a shared test provider (`ensureTestProvider`); provider tests build P1/P2 trees by hand (see `providers.e2e-spec.ts`, `provider-live.e2e-spec.ts`).
- **After changing the shared package run `pnpm build:shared`** before API tests/dev (the API consumes `dist`). A new migration that adds roles needs `pnpm db:seed` on existing databases.
- **Brand:** colours reach the UI as CSS variables from validated #RRGGBB values (`lib/branding.ts`); never provider-supplied CSS or HTML.

## Conventions learned in M6a (history)
- **Every history query goes through `HistoryService`**: clipped to the history period and to ONE tracker's installation window on THIS vehicle (`history-windows.ts`), bounded in span, vehicle looked up through RLS. Time with no tracker is "not covered", never "parked". Never ask the engine for a device's whole history.
- **What is left out is counted and said** (`hiddenTrips`, `skippedInvalid`, `thinned`, `clippedToHistoryPeriod`, `engineUnavailable`); an unreachable engine is "unknown", not an empty list.
- **Report shapes must be proven against the real container** (the stop report's coordinate names were guessed wrong until `history.e2e-spec.ts` ran). Query parameters that are dates are ISO strings in the zod schema (Swagger cannot describe `Date`).
- Web: day ranges are computed in the organization's time zone (`playback-model.ts`); the route map updates GeoJSON sources, it never recreates the map per frame.

## Start of every session
Load skill `gps-platform-workflow`, then the skills the task touches (table in that skill; index in spec Appendix C). Read the relevant spec sections before coding.

## Non-negotiable rules
1. Browser talks only to NestJS. Traccar credentials and port 8082 never leave the server/internal network. Only `integrations/gps-engine/traccar` touches Traccar.
2. Tenant context comes from the authenticated session + verified membership, never a request body. Every tenant table: `organization_id`, composite FKs, forced RLS, tests. Other tenants' resources → 404.
3. Permission **and** plan entitlement are separate checks, both enforced in the backend. UI hiding is cosmetic.
4. Remote immobilization = stationary starter-inhibit only. No generic command API, no engine-stop wording/path, no "immobilized" without execution evidence, feature disabled unless verified.
5. Never infer a device capability from manufacturer/model name. Unknown ≠ false: ignition/power/etc. are tri-state and shown as Unknown.
6. Simulated data is always flagged and refused outside sandbox orgs; never claim live tracking works from mock data.
7. No fabricated numbers or charts on dashboards; meaningful empty states.
8. Money in integer minor units; never hardcode plan prices/limits; payments verified server-side + webhooks.
9. Secrets only in env; never log passwords, tokens, secrets or (at info level) coordinates.
10. Migrations only (never `db push` outside throwaway experiments); append-only tables for audit/security/financial/assignment history.
11. No unexplained TODOs on critical functionality; no `any` without justification.
12. Uncertain facts → `docs/OPEN_QUESTIONS.md`, not guesses. Architecture-affecting decisions → ADR with alternatives.

## Definition of done
Run skill `gps-done-check` before claiming anything is done. Evidence (commands run and output) in the report; state what is not verified. Milestone end: update roadmap, stop, and wait for the owner.
