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

Everything after "resolve tenant" carries `organizationId` and `vehicleId`.

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

- Redis hash `org:{orgId}:vehicle:{vehicleId}:state` for fast reads (live map initial load, dashboard counts).
- Postgres `vehicle_live_state` (one row per vehicle, upserted, throttled to e.g. once per 30 s per vehicle or on status change) so state survives Redis loss and is queryable.
- Initial page load: REST snapshot from latest state; then socket deltas. Clients merge by `fixTime` (ignore older deltas).

## 6. Real-time fan-out

- Coalesce per organization: buffer deltas and flush ~1 s; only the newest state per vehicle in a flush.
- Delta payload: `{ vehicleId, lat, lon, speedKmh, heading, status, ignition, lastFixAt, lastSeenAt, alertActive, simulated }`.
- Socket.IO with the Redis adapter so multiple API instances share rooms. Authorization per `gps-tenant-isolation`.
- Clients that request a single vehicle (detail view, follow mode) can join `org:<id>:vehicle:<vehicleId>` for unthrottled updates.

## 7. Offline detection

Traccar's `deviceOffline` event is a hint, not the authority. A BullMQ repeatable job (every minute) scans latest state for vehicles crossing the offline threshold, updates status, emits deltas and raises the "device offline" alert (with cooldown).

## 8. Alert evaluation

- Rule types map to spec Module 11: overspeed (threshold, minimum duration), ignition on/off (optionally within a schedule — "unauthorized movement" = movement/ignition outside allowed hours or while immobilized), geofence enter/exit/dwell, device offline, external power cut, low battery, SOS, towing, immobilization events.
- Sources: Traccar events (`alarm`, `ignitionOn`, `geofenceEnter`, …) and our own evaluation of positions (overspeed with duration, schedules).
- Each alert: persisted in `alerts` (org, vehicle, type, severity, started/ended, position snapshot, acknowledged by/at), deduplicated with a per-rule cooldown, then a notification job is enqueued (see `gps-provider-adapters`).
- Only fire for capabilities the device actually has (catalogue). No "low battery" rule offered for a device that does not report battery.

## 9. Storage strategy (default — confirm with an ADR in Phase 0/M3)

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

- Always: tenant check → clip range to assignment windows (`gps-tenant-isolation` §5) → clip to `history_days` entitlement → max span per request → call engine.
- Return positions in fix-time order; mark invalid/delayed points so playback can skip or style them.

## 11. Simulated data

Positions from devices flagged `isSimulated` carry `simulated: true` end-to-end (state, deltas, alerts, reports). The UI marks them; production refuses simulated devices outside sandbox organizations (see `gps-simulator`).

## 12. Tests

Unit: `deriveStatus` table tests (every row above + boundaries), normalization (units, tri-state), each anomaly case. Integration (real Traccar + simulator scenarios): moving route updates state and emits deltas; stop → idling → parked; disconnect → offline after threshold; reconnect with buffered positions does not regress latest state; out-of-order ignored; invalid coordinates don't move marker; overspeed alert fires once per cooldown; delayed data doesn't create false real-time alerts.
