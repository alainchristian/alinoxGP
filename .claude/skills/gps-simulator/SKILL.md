---
name: gps-simulator
description: Design and use of the GPS device simulator for the fleet platform (apps/simulator) — feeding a real Traccar instance over the OsmAnd protocol, simulated-device flagging and production guards, route files, realistic motion/noise/reporting intervals, the required repeatable scenarios (route, stop, ignition, geofence, disconnect/reconnect, delayed, invalid, out-of-order), scenario assertions and load testing. Use whenever building, extending or running the simulator, writing pipeline or end-to-end tests that need GPS data, demoing live tracking without hardware, or load-testing.
---

# GPS simulator

The simulator exists so the **whole real pipeline** (device protocol → Traccar → our ingestion → status → sockets → UI → alerts) can be exercised before hardware arrives and in CI. It must never become a shortcut that bypasses Traccar, and its data must never be mistaken for a real vehicle.

## 1. Architecture

- `apps/simulator`: a TypeScript CLI. It sends positions to Traccar using the **OsmAnd protocol** (HTTP, default port 5055), which Traccar decodes like any device. Typical parameters: `id`, `lat`, `lon`, `timestamp`, `speed`, `bearing`, `altitude`, `accuracy`, `batt`, plus extra parameters (e.g. `ignition=true`) that Traccar keeps as attributes. **Verify** in the pinned Traccar version's OsmAnd decoder: accepted parameter names, timestamp format, and the unit expected for `speed`. Encode the findings in one place (`osmand-client.ts`) with tests.
- OsmAnd is one-way: devices cannot acknowledge commands. Command workflows are therefore tested with (a) a fake `GpsEnginePort` in unit/integration tests, and (b) real hardware in M7. Optionally, a later protocol emulator (e.g. Teltonika Codec 8 over TCP) can add command round-trips — record that as a decision if pursued.
- The scenario runner talks to our API and Socket.IO to assert outcomes — it observes the system like a customer would.

## 2. Marking simulated data (non-negotiable)

- Simulated devices use `uniqueId` prefix `SIM-` and have `gps_devices.isSimulated = true` (and a `simulated=true` attribute in Traccar).
- `isSimulated` propagates to latest state, socket deltas, alerts, reports and exports. The UI shows a "Simulated" badge on markers, lists and detail panels.
- Production guards:
  - `SIMULATOR_ENABLED=false` in production config.
  - The API refuses to register `SIM-` devices unless the provider (or its customer) has `isSandbox = true`.
  - Ingestion drops simulated positions for non-sandbox organizations and raises an error metric.
  - Simulated devices are never billable (`gps-provider-model` §6).
- **Provider sandbox:** every newly registered provider gets a sandbox (a sandbox customer with a few `SIM-` vehicles driving Kigali routes) to explore the product before approval and to train staff. It is visibly labelled simulated everywhere and cannot be mixed with real devices.
- A demo/sales sandbox in production is allowed only if it is flagged sandbox and everything in it is visibly labelled simulated.

## 3. Realistic motion

- Routes: GeoJSON `LineString` files in `apps/simulator/routes/` (e.g. Kigali city loops, a Kigali–Musanze highway run). Draw them by hand or derive from OpenStreetMap data with ODbL attribution; do not harvest routes from a commercial directions API whose terms forbid storing results.
- Motion model: interpolate along the line using a speed profile (acceleration, cruising, slowing at turns), heading from the bearing between points, GPS noise of a few metres, occasional drift while parked (1–3 km/h noise with ignition off — exactly the case the safety logic must handle).
- Reporting intervals like real trackers: e.g. every 10–30 s or on heading change while moving, every 5–30 min while parked (configurable per simulated "model").
- Signal quality fields: satellites, HDOP/accuracy; occasional invalid fixes in tunnels.
- Timestamps in UTC; scenarios are **seeded** so runs are reproducible.

## 4. Required scenarios (spec §9)

Each scenario lives in `apps/simulator/scenarios/<name>.ts` with steps **and** expected outcomes:

| Scenario | Steps | Expected outcome (asserted) |
|---|---|---|
| `moving-route` | ignition on, drive a route | status MOVING, marker moves, speed/heading plausible, trip appears in history |
| `stopping` | drive, stop with ignition on, then off | MOVING → IDLING (after idle threshold) → PARKED; trip ends; stop recorded |
| `ignition-cycle` | ignition on/off several times while stationary | ignitionOn/ignitionOff alerts per rule, no trips for zero-distance cycles (per trip settings) |
| `geofence-enter-exit` | create geofence, drive through it | one enter and one exit event; notification enqueued; dwell event if configured |
| `disconnect` | drive, then stop sending | OFFLINE after threshold; offline alert once |
| `reconnect-buffered` | after disconnect, send buffered older positions then live ones | history filled, latest state not regressed, no false real-time alerts for buffered data |
| `delayed-transmission` | send positions with fixTime minutes in the past | marked delayed; no real-time overspeed/ignition alerts as "now" |
| `invalid-coordinates` | (0,0), lat 95, valid=false | heartbeat updates lastSeen; marker does not jump; diagnostics flag |
| `out-of-order` | send fix t3 then t2 | latest state stays at t3; history ordered by fixTime |
| `parked-drift` | ignition off, speed noise 1–3 km/h | stays PARKED (no phantom trip) |
| `overspeed` | exceed limit for longer than min duration | one overspeed alert per cooldown |
| `governor-route` *(M9)* | governed bus, record every 5 s along a route | all records stored and retrievable; dd/mm/yyyy 24 h in exports |
| `governor-limiting` *(M9)* | speed rises to the set speed and plateaus | no violation; limiting event recorded if the model reports one |
| `governor-violation` *(M9)* | speed above set speed for N records (e.g. downhill) | one violation episode; provider alarm; regulator outbox entry |
| `governor-tamper` *(M9)* | external power to 0 / speed signal lost, then restored with buffered upload | tamper event; offline period closed and kept; history filled; customer SMS once |

## 5. CLI

```
pnpm sim scenario <name> [--org <sandboxOrgId>] [--seed 42] [--speed-factor 10]
pnpm sim fleet --count 200 --routes kigali/* --duration 30m   # demo / load
pnpm sim smoke [--governed 100]                               # steady-traffic smoke test (gps-done-check)
pnpm sim register --count 10 --provider <sandboxProviderId> --customer <sandboxCustomerId>
                                                               # creates SIM- devices via our provider API
```

**Do not compress time by sending timestamps ahead of the wall clock.** Traccar records its own server time and may reject or flag future-dated positions, so fast-forwarded scenarios contradict themselves. This was a mistake in an earlier version of this skill. Run scenarios in real time with **short test thresholds from configuration** (e.g. offline after 30 s, idling after 20 s). `--speed-factor` may only speed up movement along the route, never timestamps.

**Anomaly scenarios run at two levels.** Traccar's decoders and filters may drop some bad input (e.g. latitude 95) before our pipeline sees it.
- Unit-test our validator with recorded or hand-made positions.
- End-to-end, assert only that bad input does not break anything or move the marker. Document what Traccar itself filters (M3a findings in `docs/GPS_INTEGRATION.md`).

## 6. Load testing

- Targets to validate in M11 (the M3b scale proof; adjust in ADR): e.g. 2,000 simulated devices at 10 s intervals, or 1,000 governed vehicles at 5 s (~200 positions/s) with p95 ingestion→socket latency < 2 s, and 200 concurrent web clients.
- Measure Traccar CPU/DB, our consumer lag, Redis, Postgres, socket fan-out. Record results in `docs/` with date and hardware.
- Lessons from M3:
  - Run the full load test (M3b, now in M11) on a quiet Linux host, with the **load generator on a different machine**. On a shared laptop the generator itself fell behind at 2,000 devices.
  - The generator measures latency **only for its own vehicles' deltas**.
  - Load-test data goes into a throwaway environment and is deleted afterwards.
  - Day to day, use the steady-traffic smoke test (`pnpm sim smoke`, see `gps-done-check`).

## 7. Done criteria for M3a (governor scenarios: M9)

Every scenario above runs in CI against real Traccar + our API, passes its assertions, and is documented in `docs/SIMULATOR.md` (how to run, what each proves).
