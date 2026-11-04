---
name: gps-position-pipeline
description: The GPS position ingestion and live-state pipeline for the fleet platform — normalization, validation, out-of-order/delayed/invalid/duplicate handling, tri-state ignition, vehicle status derivation (moving, idling, parked, offline, alert), Redis latest-state cache, throttled Socket.IO fan-out, offline sweeper, alert-rule evaluation, trips, and the GPS data storage/retention strategy (what lives in Traccar vs our DB, when to partition). Use for any work on positions, live tracking data, vehicle status, dashboards counts, alerts evaluation, history queries, data retention or GPS scalability.
---

# Position pipeline and GPS data

Every number a customer sees — "12 moving, 3 offline", a speed, a trip distance — comes from this pipeline. Accuracy and honesty matter more than cleverness: an unknown value must look unknown, never like a confident zero.

## 1. Flow

```
Traccar WS ─► consumer (single leader) ─► normalize ─► validate ─► resolve tenant (device→assignment→org)
   ─► ordering/dedupe ─► update latest state (Redis + vehicle_live_state) ─► derive status
   ─► emit to Socket.IO room org:<id> (coalesced) ─► enqueue evaluations (alert rules, dwell, security checks)
```

Everything after "resolve tenant" carries `providerId`, `organizationId` (the end customer) and `vehicleId`. Devices in provider stock with no assignment still update device health (visible to the provider) but produce no customer-facing state.

## 2. Normalization (done in the GPS-engine adapter)

- Speed knots → km/h (× 1.852), rounded to 0.1.
- `fixTime` (when the GPS fix happened) orders positions; `serverTime` (when it arrived) drives connectivity.
- Ignition, motion, power, battery are **tri-state**: `true`, `false`, or `null` (not reported). Never coerce `undefined` to `false`. The UI shows "Unknown" for null.
- Keep the raw attribute bag for diagnostics; expose only mapped fields to the product.

## 3. Validation and anomalies

| Case | Detection | Handling |
|---|---|---|
| Invalid fix | `valid=false`, lat/lon outside ±90/±180, or exactly (0,0) | Counts as a heartbeat (updates `lastSeenAt`), does **not** move the vehicle; flag `lastFixInvalid` |
| Out-of-order | `fixTime` older than the stored latest `fixTime` | Never overwrite latest state; history remains correct because Traccar stores it; count metric |
| Duplicate | same device + `fixTime` + coordinates | Drop |
| Delayed / buffered | `serverTime − fixTime` > threshold (e.g. 2 min) — typical after reconnect | Update history-derived data but mark `delayed`; do **not** fire "real-time" alerts (overspeed, ignition) as if happening now — fire with a delayed flag or suppress per rule config |
| Clock skew | `fixTime` in the future beyond tolerance | Clamp for display, flag device in diagnostics |
| Implausible jump | implied speed between consecutive fixes > e.g. 300 km/h | Keep raw, exclude from live marker movement, flag |

## 4. Vehicle status derivation

Pure function `deriveStatus(state, now, thresholds)` — unit-tested exhaustively. Thresholds are configurable (platform defaults, per-organization overrides; also informed by the device's reporting interval from the catalogue).

| Status | Rule (defaults are starting points) |
|---|---|
| `NO_DATA` | Device assigned but never reported |
| `OFFLINE` | `now − lastSeenAt` > offline threshold (default 10 min; at least ~2× the device's parked reporting interval) |
| `MOVING` | speed ≥ 5 km/h (and `motion` true if reported) |
| `IDLING` | ignition `true` and speed < 5 km/h for ≥ 3 min |
| `PARKED` | ignition `false`; or ignition `null` and stationary ≥ 5 min |
| `STATIONARY` | ignition `null` and stationary < 5 min (brief stop, unknown ignition) |

Precedence: `NO_DATA` > `OFFLINE` > `MOVING` > `IDLING` > `PARKED`/`STATIONARY`. **Alert** is an overlay (badge/ring on the marker), not a replacement status — a moving vehicle with an SOS is still moving.

Counts on the dashboard are computed from the same function — one definition, everywhere.

## 5. Latest state

Design learned from M3. Each item fixed a measured bottleneck:

- **The ingestion leader holds every vehicle's latest state in memory.** There is a single leader, so no Redis read is needed on the hot path.
- **Redis** `org:{orgId}:vehicle:{vehicleId}:state` is written behind, in **batched pipelines** (~1 s). Every write is guarded by the **lease token** (e.g. a Lua script that checks the token first), so a leader that lost its lease cannot overwrite the new leader's data.
- **A new leader warms up with one bulk read from Redis.** Never fall back to one database query per vehicle; that capped cold start at ~4 positions/s.
- **Postgres `vehicle_live_state`** is saved every ~30 s (and on status change) with **one multi-row upsert** (e.g. `INSERT … SELECT FROM unnest(…) ON CONFLICT …`). Never write it row by row inside one long transaction; that timed out at ~1,000 vehicles.
- **Cache lifetimes** (e.g. the device→tenant routing cache) come from configuration and must be **longer than the slowest normal reporting interval**. A 5 s TTL with 10 s reporting never hits. A test asserts this rule.
- **Profile before optimising**, and never make writes fire-and-forget without a test proving no data is lost.
- Initial page load: REST snapshot from latest state; then socket deltas. Clients merge by `fixTime` (ignore older deltas).

## 6. Real-time fan-out

- Coalesce per organization: buffer deltas and flush ~1 s; only the newest state per vehicle in a flush. Emit each flush to the customer room `org:<customerId>` and to the provider room `provider:<providerId>` (see `gps-tenant-isolation` §5).
- Delta payload: `{ vehicleId, lat, lon, speedKmh, heading, status, ignition, lastFixAt, lastSeenAt, alertActive, simulated }`.
- Socket.IO with the Redis adapter so multiple API instances share rooms. Authorization per `gps-tenant-isolation`.
- Clients that request a single vehicle (detail view, follow mode) can join `org:<id>:vehicle:<vehicleId>` for unthrottled updates.

## 7. Offline detection

Traccar's `deviceOffline` event is a hint, not the authority. Keep a Redis **sorted set whose score is each vehicle's offline deadline** (last seen + that vehicle's own threshold); update it on every position. A repeatable job (every 15–60 s) runs one `ZRANGEBYSCORE … -inf now` to find vehicles past their deadline. It then updates status, emits deltas, raises the "device offline" alert (with cooldown) and closes the vehicle's `device_connectivity_periods` row. Never scan the whole state hash (`HGETALL`).

**Governed vehicles** (speed governors, rev. 1.2) report every ≤ 5 s, and all their records are retained for compliance. Violation, tamper and connectivity-period logic is described in `gps-speed-governor-compliance`. 1,000 governed vehicles ≈ 200 positions/s, which is the M3b target.

## 8. Alert evaluation

- Rule types map to spec Module 11: overspeed (threshold, minimum duration), ignition on/off (optionally within a schedule — "unauthorized movement" = movement/ignition outside allowed hours or while immobilized), geofence enter/exit/dwell, device offline, external power cut, low battery, SOS, towing, immobilization events.
- Sources: Traccar events (`alarm`, `ignitionOn`, `geofenceEnter`, …) and our own evaluation of positions (overspeed with duration, schedules).
- Each alert: persisted in `alerts` (org, vehicle, type, severity, started/ended, position snapshot, acknowledged by/at), deduplicated with a per-rule cooldown, then a notification job is enqueued (see `gps-external-integrations`). Recipients can be the end customer's users and, for operational alerts, the provider's staff.
- Only fire for capabilities the device actually has (catalogue). No "low battery" rule offered for a device that does not report battery.

## 9. Storage strategy (default — ADR written in M3a, confirmed or amended by the M3b scale proof in M11)

Speed-governor records (5 s, retained per RURA, spec B14) are the most likely reason to revisit "raw positions only in Traccar": compliance queries over months of governed-vehicle data may need our own partitioned store. Decide in the M3b ADR review.

**Raw positions stay in Traccar's database.** Our database stores only what we own or need to query fast:

| Data | Where |
|---|---|
| Raw positions, raw events | Traccar DB (queried via Traccar reports API) |
| Latest state per vehicle | Redis + `vehicle_live_state` |
| Alerts, geofence violations, security events, command history | Our DB (domain records, append-only where required) |
| Daily aggregates per vehicle (distance, driving time, idle time, engine hours, max/avg speed, overspeed count, first/last movement) | Our DB `vehicle_daily_stats`, computed nightly + incrementally; powers reports and dashboards |
| Trip summaries | Fetched from Traccar on demand; optionally cached in `trips` if reports latency requires it |

Why: avoids duplicating the largest dataset (the spec requires evaluating before duplicating), keeps one source of truth for raw history, and keeps our DB small.

**Retention.** Traccar's own position retention setting is global; plan-based history (`history_days`) is enforced at query time in our API. Set a global ceiling (≥ the longest plan) in Traccar config, document it, and reflect it in the privacy notice.

**Revisit triggers** — introduce our own positions store only when one is true, via an ADR:
- Traccar report latency for typical queries exceeds targets (e.g. p95 > 2 s for a 1-day route).
- Analytics need SQL across many vehicles' raw positions (heatmaps, fleet-wide speed analysis).
- We need to move off Traccar for some devices (multi-engine).

Then: ingest from the pipeline into a `positions` table range-partitioned by month on `fix_time` (native partitioning, or a TimescaleDB hypertable if its compression/continuous aggregates justify the extension), primary key `(device_id, fix_time, id)`, BRIN index on `fix_time`, B-tree `(organization_id, vehicle_id, fix_time desc)`, and partition dropping for retention.

## 10. History queries

- Always: tenant check → clip range to assignment windows (`gps-tenant-isolation` §5) → clip to the effective `history_days` entitlement (provider plan ∩ customer limit) → max span per request → call engine.
- Return positions in fix-time order; mark invalid/delayed points so playback can skip or style them.

## 11. Simulated data

Positions from devices flagged `isSimulated` carry `simulated: true` end-to-end (state, deltas, alerts, reports). The UI marks them; production refuses simulated devices outside sandbox organizations (see `gps-simulator`).

## 12. Tests

Unit: `deriveStatus` table tests (every row above + boundaries), normalization (units, tri-state), each anomaly case. Integration (real Traccar + simulator scenarios): moving route updates state and emits deltas; stop → idling → parked; disconnect → offline after threshold; reconnect with buffered positions does not regress latest state; out-of-order ignored; invalid coordinates don't move marker; overspeed alert fires once per cooldown; delayed data doesn't create false real-time alerts.
