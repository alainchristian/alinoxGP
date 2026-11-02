# GPS integration (Traccar)

Status: **Milestone 2 implemented and verified against a real Traccar.** Last updated 2026-11-01.
Design decisions: `docs/adr/0004` (storage), `docs/adr/0006` (this integration's authentication and ingestion consistency).
Everything marked **[Verified]** was observed on the pinned version by running it; recorded responses are in
`apps/api/test/fixtures/traccar/` (regenerate with `capture.cjs`). **[Decided]** is our design. **[Not verified]** is still open (see `OPEN_QUESTIONS.md`).

## 1. Pinned version

**Traccar 6.16.0**, image `traccar/traccar:6.16.0-debian` (released 2026-09-27; confirmed through `GET /api/server` → `"version":"6.16.0"` on 2026-11-01). Never `latest`. Upgrading means: change the tag, re-run `capture.cjs`, review the fixture diff, run the whole GPS e2e suite, update this file.

## 2. Deployment (dev compose: `infra/docker-compose.dev.yml`)

- [Verified] Own PostgreSQL database `traccar` and user `traccar` on the shared server (created idempotently by `infra/postgres/init/02-traccar-db.sh`; `pnpm infra:ensure-db` for older volumes). Traccar's Liquibase migrates its own schema on start. Our app never writes to Traccar's tables.
- [Verified] Configuration by environment variables (`CONFIG_USE_ENVIRONMENT_VARIABLES=true`). **camelCase keys are split on capitals**: `database.registerUnknown` → `DATABASE_REGISTER_UNKNOWN`, `web.serviceAccountToken` → `WEB_SERVICE_ACCOUNT_TOKEN`, but `filter.future` → `FILTER_FUTURE`. (A wrongly spelled variable is silently ignored — verify every setting by behaviour.)
- Dev host ports (localhost only): REST/WebSocket `58082` → container 8082, OsmAnd `55055` → container 5055. In production **8082 is never published**; only the protocol ports in use are.
- The image contains no `curl`/`wget`; the compose healthcheck probes with bash `/dev/tcp`.
- [Verified] `database.registerUnknown=false` + an unregistered id → OsmAnd answers HTTP 400 and **nothing is auto-created**. Geocoder is disabled (`GEOCODER_ENABLE=false`).
- [Not verified] Default ports of real tracker protocols (Teltonika 5027, GT06 5023, Queclink 5004, Coban 5001 were Phase 0 beliefs): verify per protocol when the test hardware is chosen (OQ-002).

## 3. Engine configuration we depend on (and why)

| Setting | Value | Why (all [Verified]) |
|---|---|---|
| `FILTER_ENABLE` | true | Required for the individual filters to apply. |
| `FILTER_FUTURE` | **600** s | Default is 86 400 s (24 h). A fix timestamped in the future becomes the device's *latest*; Traccar pushes only positions that advance the latest, so **every later real position was silently not pushed** (reproduced with a +2 h fix). 10 min tolerates normal clock skew. Records beyond it are dropped by the engine (+30 min and +2 h were both dropped). |
| `FILTER_ZERO`, `FILTER_INVALID` | **off** | A (0,0) or invalid fix is still a heartbeat; dropping it would make a vehicle in a tunnel look offline. Our pipeline handles both (see §6). Traccar stores (0,0) as `valid:true`. |
| `server.buffering.threshold` | default **3000 ms** | Traccar buffers incoming data ~3 s to order locations. Measured end-to-end latency device → REST visibility **and** → WebSocket push is **3.1–3.5 s** for every case. Accepted; revisit only if live-map latency becomes a requirement. |
| `status.timeout` | default 600 s | Engine marks a device status `unknown` after 10 min of silence. Only a hint: our offline detection is authoritative (M3). |

Consequence: a tracker whose clock runs more than 10 minutes ahead has its data **dropped by the engine** until fixed. Diagnostics for this arrive with onboarding (M5) — recorded as OQ-030.

## 4. Authentication [Verified; ADR-0006]

- The API authenticates as a dedicated **administrator user** with `POST /api/session` (form: `email`, `password`) → `JSESSIONID` cookie. Credentials only in `TRACCAR_USER` / `TRACCAR_PASSWORD`.
- Tested and rejected: **`web.serviceAccountToken`** (`GET /api/session?token=…`) logs in as a *virtual* administrator (id 9 000 000 000 000 000 000) that is not in the database; devices it creates are linked to that nonexistent user, so it **cannot list its own devices or receive them on the WebSocket**. It would also be one more standing admin secret. It is not enabled.
- Bearer tokens (`POST /api/session/token`, expiry chosen by caller) work for REST but not as a WebSocket *header*; unnecessary here.
- Registration: a new server lets the first `POST /api/users` become administrator, then closes registration (`registration:false`). The service administrator was created that way; run that step immediately on a fresh install, with the port internal-only.
- Administrators see only devices **linked to their own user** unless `all=true` is passed; the adapter always passes it for listing/lookup.
- 401 → one single-flight re-login and one retry; a second 401 is `ENGINE_AUTH_FAILED` (no loops).

## 5. The port and adapter [Decided; implemented]

`src/integrations/gps-engine/port.ts` (`GpsEnginePort`) is all the rest of the app sees: `registerDevice` (idempotent), `findDeviceByUniqueId`, `listDevices`, `updateDevice` (read-modify-write: PUT replaces the whole object), `removeDevice`, `getLatestPositions`, `getRoute`, `subscribe`, `health`. Trips, stops, geofences and commands are added by M6/M7 — not stubbed.

- Normalization at the boundary: knots → km/h (×1.852, one decimal); UTC `Date`s; **tri-state** ignition/motion/power/battery (`null` = not reported, never `false`).
- Every response/frame is validated with zod schemas derived from recorded fixtures; malformed items are dropped and counted (`dropped_malformed`), never forwarded.
- `TraccarClient`: timeouts (5 s; 30 s for reports), GET retried once on network failure (never POST/PUT/DELETE), circuit breaker (5 consecutive outages → 10 s fail-fast), errors never include engine response bodies.
- Engine-side device **name = our device UUID** (neutral label); customer-chosen names stay in our database.
- `FakeEngineAdapter` exists for unit tests of port consumers only. It is refused in production and is never evidence that live tracking works.

## 6. Live stream and ingestion [Verified]

- `/api/socket` authenticates with the **session cookie header** (`?token=` also works; a Bearer header did **not**). Frames are separate envelopes: `{positions:[…]}`, `{devices:[…]}`; `{events:[…]}` is sent **only for users with a web notification configured** (we have none, so no events arrive — see OQ-007).
- **Only positions that become the device's newest fix are pushed.** Older fixes (buffered after a reconnect, wrong order) are stored (visible in reports) but **never pushed**. So after an outage the stream alone cannot reconstruct history; history comes from reports, and `getLatestPositions()` backfills the latest state.
- Consumer: exactly one leader across API instances (Redis lease, 15 s TTL, renewed every 5 s, released on shutdown); reconnect with exponential backoff + full jitter (1 s → 30 s cap), ping/pong heartbeat; on every (re)connect it backfills latest positions and logs the gap. Verified by a failover test: stopping the leader hands over to a second instance within ~25 s and positions keep flowing.
- Pipeline (M2 slice): route `engine device → device → open assignment → organization/vehicle` (unmapped → dropped and counted); simulated-data guards; write the latest state **inside the owning organization's tenant context**; usable-fix rule (valid, in range, not exactly (0,0)); unusable → heartbeat only; older/equal fix never regresses the state; `lastSeenAt` never moves backwards. Counters in Redis (`GET /admin/engine/health`).

## 7. OsmAnd decoder behaviour [Verified] (`osmand-behaviour.json`)

`speed` passes through **unconverted and is stored as knots** → the simulator converts km/h → knots. `timestamp` is epoch seconds (server time if absent). `batt` → `batteryLevel`; `ignition=true|false` → boolean attribute (absent when not sent); extra params (`hdop`, `sat`, `power`, `simulated`, …) → attributes. Latitude 95 → connection closed, nothing stored. (0,0), exact duplicates, older-than-latest fixes → stored. Unknown device → 400. A +30 min / +2 h timestamp → dropped (with `FILTER_FUTURE=600`).

## 8. Commands, geofences, reports (M6/M7 inputs, partly probed now)

- [Verified] `GET /api/commands/types` for an OsmAnd device offers only `custom`, yet `POST /api/commands/send` with `positionSingle` returned **202** and a `queuedCommandSent` event fired later, when the device next reported. **Traccar queues commands and delivers them on the next contact.** For immobilization this is a hazard (a stale command delivered hours later). We must only send to ONLINE devices and be able to purge queued commands on expiry; whether a purge API exists is **not verified** (`/api/commands/queue` → 404). OQ-006.
- [Verified] Geofence WKT is **latitude-first**: `CIRCLE (-1.9500 30.0700, 200)`; `geofenceEnter`/`geofenceExit` fired for positions inside/outside, and a swapped (lon,lat) point did not count as inside. Events are evaluated only for positions that advance the latest fix (an older fix inside a geofence raises nothing).
- [Verified] Reports (`route`, `trips`, `stops`, `summary`, `events`) work with `deviceId`, `from`, `to`. **A single bad point pollutes totals:** a swapped lat/lon produced an 11 642 km "trip". Distance/trip numbers shown to customers need the implausible-jump filter (M3) or Traccar's `filter.maxSpeed`/`filter.distance` (to be evaluated).
- [Not verified] Geofence dwell time natively, trip/stop settings (`minimalTripDistance`, etc.), position housekeeping/retention, behaviour at 2 000+ devices (M3 load test).

## 9. Reconciliation [Implemented]

`ReconciliationService` (BullMQ daily job + `POST /admin/engine/reconcile`): registers devices that are PENDING/FAILED or missing in the engine, reports devices **unknown to the platform** and drift, **never deletes**. Report kept in Redis for `GET /admin/engine/health`. Verified: a device registered while the engine was down stays `PENDING` (registration is not lost), the rest of the app keeps working, and reconciliation repairs it.

## 10. Failure handling

Engine down → registrations stay `PENDING` and are retried; the API stays up (verified with an app instance pointing at a closed port); `GET /admin/engine/health` reports `reachable:false`. Live views will show "tracking engine unavailable" in M4.

## 11. Verification log

| Date | Item | Result | Evidence |
|---|---|---|---|
| 2026-11-01 | Pin version (OQ-003) | 6.16.0, newest stable tag | Docker Hub tags; `/api/server` |
| 2026-11-01 | Auth model (OQ-004) | Cookie session as real admin; service-account token unusable for device ownership | `capture.cjs`, §4 |
| 2026-11-01 | WebSocket shapes (OQ-005) | Envelopes per kind; latest-only; no `events` without notification | `ws-messages.json` |
| 2026-11-01 | OsmAnd decoder (OQ-008) | speed = knots; see §7 | `osmand-behaviour.json` |
| 2026-11-01 | Ingestion latency | 3.1–3.5 s (server.buffering.threshold) | `osmand-behaviour.json` (`restVisibleAfterMs`, `wsFirstPushAfterMs`) |
| 2026-11-01 | Future-timestamp poisoning + filter | Reproduced; fixed by `FILTER_FUTURE=600` | e2e test "does NOT freeze the live feed" |
| 2026-11-01 | Command queueing (OQ-006, partial) | Queued and delivered later; purge unknown | `capture-report.json`, `report-events.json` |
| 2026-11-01 | Geofence WKT order | Latitude-first confirmed | `report-events.json` |

## 12. M3a as built (2026-11-02)

- **One consumer, with a fenced writer.** The ingestion leader (Redis lease, ADR-0006) owns the platform's live state in memory (ADR-0007) and writes Redis in lease-checked batches; a stale leader's writes are rejected by Redis. A new leader warms up from Redis before it consumes, then backfills the engine's latest position per device. Verified: failover e2e where a position is sent while **no** instance leads and appears after the takeover.
- **Latency budget (measured, test stack on a Windows laptop — indicative):** the engine itself holds a position for ~3 s (`server.buffering.threshold`) and queues under load; the platform's own share — from the engine emitting a position on its WebSocket to the browser socket receiving the delta — was **p50 0.50 s / p95 0.96 s** at 50 devices × 10 s (steady-traffic smoke test); end to end from the engine's receipt it was p50 3.6 s / p95 4.0 s. At ~100 positions/s the engine's own feed was already p50 3.1 s / p95 11 s on that machine, i.e. the engine, not the platform, dominates there. These are not production figures (M3b).
- **Positions are applied by fix time, never arrival time**; duplicates, out-of-order, implausible jumps, invalid and delayed fixes are classified (docs/SIMULATOR.md §9 lists the scenarios proving each).
- Known engine behaviours recorded: OsmAnd `speed` is stored unconverted in knots; fix times have 1-second resolution; Traccar's default trip logic reports a short phantom trip for parked GPS drift (OQ-033, M6); events reach the WebSocket only with the web notification enabled; Traccar queues commands for offline devices (M7 hazard).
