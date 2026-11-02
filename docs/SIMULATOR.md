# GPS simulator and hardware-free testing

Spec §9; §19 task 13. Implementation skill: `gps-simulator`.
**Status (2026-11-02, M3a): built** — the simulator (`apps/simulator`), the scenario runner with the twelve scenarios (§9), the fleet load generator, and the steady-traffic smoke test (§11), and the live monitor page that lets you see it (§10). Used by the GPS e2e suites through real Traccar. What it proves, and what it cannot (hardware, command round trips), is in §5.

## 1. Purpose

Exercise the **entire real pipeline** — device protocol → real Traccar → our ingestion → status derivation → Socket.IO → UI → alerts — without physical hardware and in CI. The simulator never bypasses Traccar and never writes into our database or sockets directly; otherwise "live tracking works" would be a mock claim (spec rule 3).

## 2. How it works

- `apps/simulator` (TypeScript CLI) posts positions to Traccar over the **OsmAnd protocol** (HTTP; Traccar's OsmAnd port), which Traccar decodes like any device. Devices are registered through our API as `SIM-<n>` with `isSimulated = true`, in a **sandbox** organization only.
- [Verified 2026-11-01, OQ-008 resolved] OsmAnd decoder of Traccar 6.16.0: `speed` is stored **unconverted as knots** (so the client converts km/h → knots), `timestamp` is epoch seconds, `batt` → `batteryLevel`, `ignition` and extra params become attributes, latitude 95 closes the connection, an unregistered id is answered with HTTP 400. All encoded in one module (`osmand-client.ts`) with tests; evidence in `apps/api/test/fixtures/traccar/osmand-behaviour.json`.
- Motion model: routes as GeoJSON LineStrings (hand-drawn or from OpenStreetMap with ODbL attribution — never harvested from a commercial directions API); speed profile with acceleration/cruising/slow-downs; heading from segment bearing; GPS noise of a few metres; parked drift of 1–3 km/h with ignition off; realistic reporting intervals (tens of seconds moving, minutes parked); satellites/HDOP/accuracy fields; occasional invalid fixes. Seeded RNG ⇒ reproducible runs. `--speed-factor` compresses time for CI (thresholds then use an injectable clock or scaled values — documented per test).
- The scenario runner observes the system as a customer would (REST + Socket.IO) and asserts outcomes.

## 3. Marking simulated data (non-negotiable)

`SIM-` unique-id prefix + `gps_devices.is_simulated` + `simulated=true` attribute in Traccar → propagated through live state, socket deltas, alerts, reports, exports; UI shows a "Simulated" badge. Guards: `SIMULATOR_ENABLED=false` in production; API refuses to register `SIM-` devices outside sandbox orgs; ingestion drops simulated positions for non-sandbox orgs and raises an error metric; a DB CHECK/trigger ties `is_simulated` to sandbox ownership. A visibly-labelled sandbox org may exist in production for demos.

## 4. Required scenarios (each with asserted outcomes)

`moving-route` · `stopping` (MOVING→IDLING→PARKED) · `ignition-cycle` · `geofence-enter-exit` · `disconnect` (OFFLINE after threshold, one alert) · `reconnect-buffered` (history filled, latest state not regressed, no false real-time alerts) · `delayed-transmission` · `invalid-coordinates` ((0,0), lat 95, valid=false) · `out-of-order` · `parked-drift` (no phantom trip) · `overspeed` (one alert per cooldown). Details and expected outcomes: skill `gps-simulator` §4. Delivered in M3 (one basic device in M2).

## 5. What the simulator can prove — and what it cannot

| Can prove | Cannot prove (needs real hardware, M4+/M7) |
|---|---|
| Our pipeline handles ordering, delay, invalid data, reconnects | That any real tracker's protocol quirks, attribute names or reporting behaviour match our assumptions |
| Status derivation, alerts, geofence logic, tenant isolation of live data, fan-out latency and load | Real GPS accuracy/drift, real buffering behaviour, real clock errors |
| UI behaviour under motion and at 2,000+ markers | Network/SIM/APN problems, power-loss behaviour |
| Onboarding flow and diagnostics with a "device" | **Any command round-trip**: OsmAnd is one-way — no acknowledgements, no output state |

Consequences: command workflows are tested with the **fake `GpsEnginePort`** (state machine, timeouts, evidence handling) and with real hardware in M7. A later protocol emulator (e.g. a vendor TCP protocol) is optional and would need its own decision record. Success Milestone 2 (a physical tracker in a real vehicle) is the real-world check.

## 6. Load testing

Targets to validate and record (date, hardware, results) in M3 and M10: e.g. 2,000 simulated devices at 10 s intervals (~200 positions/s), p95 ingestion→socket latency < 2 s, 200 concurrent web clients; also Traccar report latency vs dataset size (ADR-0004). These targets are proposals; adjust by ADR.

## 7. CLI

**Built in M2:**

```
# 1. once: a sandbox organization owned by an existing user (the ONLY place SIM- devices may exist)
pnpm --filter @gps/api cli create-sandbox-org --name "Demo sandbox" --owner-email you@example.com
# 2. register a vehicle and a SIM- device in that organization through the API (header X-Organization-Id), assign it
# 3. drive it
pnpm sim drive --id SIM-DEMO-0001 [--route kigali-streets] [--speed 40] [--interval 5] [--duration 120] [--speed-factor 1] [--seed 42] [--url http://localhost:55055]
```

Guards: the CLI refuses ids that do not start with `SIM-`, refuses to run when `SIMULATOR_ENABLED=false`, and every position carries `simulated=true`. The API refuses to register `SIM-` devices outside sandbox organizations, the database enforces it (CHECK + trigger; an organization owning simulated devices cannot be un-sandboxed), and ingestion drops simulated data for non-sandbox organizations or when the simulator is disabled. Verified live on 2026-11-01: a simulated vehicle moved along the Kigali loop at ~40 km/h through real Traccar and showed `simulated: true` in the API.

**Planned for M3:**

```
pnpm sim scenario <name> [--org <sandboxOrgId>] [--seed 42] [--speed-factor 10]
pnpm sim fleet --count 200 --routes kigali/* --duration 30m
pnpm sim register --count 10 --org <sandboxOrgId>
```

## 8. Done criteria (M3)

Every scenario runs in CI against real Traccar + our API, passes its assertions, and this file documents how to run each and what it proves.

## 9. M3 scenario runner (as built, 2026-11-01)

`pnpm sim scenario list` describes each scenario; `pnpm sim scenario <name|all> [--parallel]` runs them against a running API + Traccar (env: `SIM_API_URL`, `SIM_EMAIL`, `SIM_PASSWORD`, `SIM_ORG_ID` of a **sandbox** organization; optional `TRACCAR_USER/PASSWORD` for engine-level checks). Each scenario registers its own vehicle and `SIM-` device through the public API, listens on the live socket, sends real OsmAnd traffic and asserts what the platform shows. CI runs all of them in parallel (`apps/api/test/scenarios.e2e-spec.ts`) with compressed thresholds (offline 15 s, idle 6 s, parked 10 s, delayed 10 s); all 12 passed three times in a row.

| Scenario | Proves |
|---|---|
| moving-route | MOVING; marker advances; plausible speed/heading; simulated label; counts agree |
| stopping | MOVING → STATIONARY → IDLING (after threshold) → PARKED, pushed in order |
| ignition-cycle | alerts only on real transitions (first report is not a change), exactly once each; no MOVING |
| geofence-enter-exit | **engine level only** (one enter, one exit, lat-first WKT); platform geofences are M6 |
| disconnect | OFFLINE after the threshold (our last-seen), pushed to browser, one alert, flapping inside cooldown not re-alerted |
| reconnect-buffered | buffered data revives the vehicle, never regresses latest, no real-time alerts for it; live speeding still alerts |
| delayed-transmission | late data flagged delayed, no overspeed/ignition alerts; same speeding live does alert |
| invalid-coordinates | (0,0)/bad latitude never move the marker, still count as alive, flagged, recover |
| out-of-order | latest never goes backwards; engine history is fix-time ordered |
| parked-drift | drift never makes it MOVING; marker steady (engine's default trip logic still reports a tiny phantom trip — OQ-033) |
| overspeed | spike ignored; one alert per episode; second episode inside cooldown suppressed |
| implausible-jump | a swapped lat/lon teleport is not shown, flagged, next fix recovers |

Limits: the stats-based checks read global counters (scenarios run in parallel), so they are weaker than the per-vehicle API assertions. `pnpm sim fleet` is the load generator (see ROADMAP "M3 as built" for results and the unmet target).

## 10. Seeing it work: the live monitor page (M3a)

1. Start the stack: `pnpm infra:up`, `pnpm dev:api`, `pnpm dev:web` (web on http://localhost:5273; API docs on http://localhost:3100/api/docs).
2. Create a sandbox organization for the demo and feed it: `pnpm --filter @gps/api cli create-sandbox-org --name "Demo" --owner-email <a user>`, then `SIM_EMAIL=<that user> SIM_PASSWORD=<their password> SIM_ORG_ID=<the new organization id> pnpm sim fleet --count 6 --interval 5 --duration 1800`.
3. Sign in, choose that organization in the header, open **Fleet → Live monitor (M3a)**. You should see the vehicles Moving, positions and speeds changing, the live feed scrolling, and "Simulated" on every vehicle. Press *Add demo rules* (or create rules in Swagger) to see overspeed alerts appear; stop the generator for longer than the offline threshold (10 min by default) to see vehicles go Offline.

The page is a verification aid for M3a, not the M4 map.

## 11. Steady-traffic smoke test and the fleet generator (M3a)

`pnpm --filter @gps/api test:smoke` (≈ 3 min; part of the done-check, not of every `pnpm test`): 50 simulated devices report every 10 s for 2 minutes through OsmAnd → Traccar → ingestion → live state → Socket.IO, with the production defaults for caching, fan-out and persistence. It requires: routing-cache hit rate > 90 %, **p95 position-to-socket < 2 s**, every position delivered to the browser socket and only for its own vehicles, zero failed requests / socket drops / pipeline errors, and cache lifetimes taken from configuration and longer than the reporting interval. Last result (2026-11-02, Windows laptop, test stack): hit rate 91.7 %, position-to-socket p50 0.50 s / p95 0.96 s, 600/600 positions delivered, 0 errors.

**Position-to-socket** is measured from the moment the ENGINE emits a position on its own WebSocket feed (observed by a second listener, `TraccarFeed`) to the moment the browser-side socket receives the matching delta, so Traccar's ~3 s buffering and queueing are not blamed on the platform. The report also carries engine-receipt-to-browser latency (`engineToBrowserMs`), the number of matched deltas and unexpected socket disconnects.

`pnpm sim fleet --count N --interval 10 --duration 120` is the same generator for manual load runs. With `TRACCAR_USER`/`TRACCAR_PASSWORD` (and `TRACCAR_URL`) set it also reports `positionToSocketMs`. Before a load run: delete leftover `SIM-F*` devices from the engine (the leader backfills every engine device on start-up), use a fresh sandbox organization, raise `THROTTLE_DEFAULT_LIMIT`, and discard any run in which the generator itself fell behind (`sent` far below the offered rate). The 200 positions/s proof (2,000 devices) is **M3b** and needs a quiet Linux host.

## 12. Routes: the hand-drawn loop and the street-following circuit (M4)

| Route name | What it is | Used by |
|---|---|---|
| `kigali-city-loop` | 9 hand-typed points forming a rough ring. Straight segments of 400–600 m that cut across blocks; **not map-matched**. Kept exactly as it is because the scenarios and their assertions are built on it. | the 12 scenarios |
| `kigali-streets` | A closed circuit of ~7.9 km (366 points) that **follows real Kigali streets**, one-way streets respected. Generated from OpenStreetMap data. | `pnpm sim drive` (default), `pnpm sim fleet`, the steady-traffic smoke test, demos and screenshots |

`pnpm sim fleet` starts its vehicles at evenly spaced points along the circuit (`startOffsetM`), so a fleet looks like a fleet and not a convoy.

**Why two routes.** Simulated vehicles on the rough ring appear to drive over houses and outside the roads (the straight segments are not streets); that is a property of the test data, not of the map or the pipeline. Real devices send real coordinates.

**Regenerating `src/kigali-streets-loop.ts`.** It is generated, never edited by hand. Download the drivable streets once from the OpenStreetMap Overpass API (identify the tool in the User-Agent; the public servers are sometimes at capacity, so retry later):

```
curl -A "gps-fleet-platform-dev/1.0 (one-off route generation)" --data-urlencode 'data=[out:json][timeout:90];way["highway"~"^(primary|secondary|tertiary|residential|unclassified|trunk|primary_link|secondary_link)$"](-1.962,30.048,-1.936,30.080);out geom;' https://overpass-api.de/api/interpreter > osm-kigali.json
node apps/simulator/scripts/build-kigali-route.cjs osm-kigali.json > apps/simulator/src/kigali-streets-loop.ts
```

The script builds a directed street graph (largest strongly connected part, so every leg has a path), snaps six landmark waypoints to the nearest street node, joins them with shortest paths and closes the circuit. Tests check that it is several kilometres long, stays inside central Kigali, has no long straight jumps (longest gap shorter than the hand-drawn loop's, and under 350 m) and closes on itself. **They cannot prove each point lies on a drivable lane**: it is OpenStreetMap's own street geometry, so alignment is as good as OpenStreetMap's, and the development map is drawn from the same data.

**Licence.** © OpenStreetMap contributors, Open Database License (ODbL): https://www.openstreetmap.org/copyright — attribution is in the generated file header and in the map's attribution control. The route is not derived from any commercial directions service.
