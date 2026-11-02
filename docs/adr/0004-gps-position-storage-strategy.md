# ADR-0004: GPS position storage strategy

- **Status:** Accepted as the working strategy (raw positions stay in Traccar; latest state in Redis + `vehicle_live_state`) — **final confirmation pending M3b** (Traccar report latency vs dataset size, and the 200 positions/s load proof, both on a separate Linux host before M10; moved there by the owner on 2026-11-02). Amend by a new ADR if the revisit triggers below are hit.
- **Spec refs:** §10.2 ("evaluate whether our application needs a full copy of positions … before implementing any large-scale duplication"), §15; skill `gps-position-pipeline` §9

## Context

Traccar stores every raw position and event in its own database and exposes them through its reports API. The platform must scale toward tens of thousands of vehicles. The spec forbids blindly storing every update in the main transactional tables and requires the duplication question to be evaluated first.

Order-of-magnitude volume (**illustrative assumptions, not measurements**): a vehicle reporting every 10 s while moving for ~3 h/day and every ~5 min while parked ≈ 1,300 positions/day. 20,000 vehicles ≈ 26 M rows/day ≈ 0.8 B rows/month. This is large for any single Postgres table without partitioning, regardless of who owns it.

Things our application needs from positions:
1. Live map: latest state per vehicle.
2. History / playback / trips for a vehicle and date range (bounded by assignment windows and plan retention).
3. Dashboard/report aggregates (distance, idle time, utilisation, overspeed counts).
4. Alert evaluation and immobilization precondition checks (recent positions, last ~2 minutes).
5. Possibly later: fleet-wide analytics (heatmaps) over raw points.

## Options

A. **Traccar owns raw history; we store only derived/owned data** (latest state, daily aggregates, alerts, events, trip cache). History queries call Traccar reports.
B. **Full copy** of every position in our DB (partitioned `positions` table or TimescaleDB), ingested from the Traccar stream.
C. **Hybrid:** A now, with a pre-designed path to B, triggered by measured thresholds.
D. **Replace Traccar's storage** (point Traccar at a TimescaleDB-backed DB or a separate store). Couples us to Traccar's schema; unsupported territory.

## Decision

**Option C: start with A, with explicit triggers to move to B.**

What lives where:

| Data | Store |
|---|---|
| Raw positions, raw events, Traccar-computed trips/stops | Traccar DB (never written by us; read via `GpsEnginePort`) |
| Latest state per vehicle | Redis hash + `vehicle_live_state` (Postgres, throttled upsert) |
| **Recent-positions ring buffer** per vehicle (last ~20 fixes, short TTL) | Redis — used by the immobilization gate and short-window rules so safety checks never depend on a Traccar report round-trip |
| Alerts, geofence violations, security events, command history, audit | Our DB (append-only where required) |
| Daily aggregates per vehicle (distance, drive/idle time, engine hours, max/avg speed, overspeed count, first/last movement) | `vehicle_daily_stats`, incremental + nightly recompute |
| Trip summaries | Fetched from Traccar on demand; cached in `trips` only if report latency requires |

Retention: Traccar's global position retention is set to a ceiling ≥ the longest plan's `history_days`; the **plan-specific** history window is enforced in our API at query time. The privacy notice must state the ceiling (links to OQ-001, OQ-020).

**Triggers to introduce our own `positions` table (new ADR required):**
1. p95 latency of a 1-day route query via Traccar > 2 s at target data volume.
2. Product need for SQL analytics across many vehicles' raw points.
3. Need to support a second GPS engine for some devices.
4. Traccar's DB cannot be operated acceptably at the reached volume (storage, vacuum, backup windows).

If triggered: ingest from the existing pipeline into a table range-partitioned monthly on `fix_time` (or a TimescaleDB hypertable if compression / continuous aggregates justify the extension), PK `(device_id, fix_time, id)`, BRIN on `fix_time`, B-tree `(organization_id, vehicle_id, fix_time desc)`, retention by dropping partitions. Because ingestion already passes every position through our pipeline, adding a writer is additive — nothing in the pipeline design needs to change now.

**Measurements required in M3 (to confirm or reverse this ADR):**
- Traccar report latency vs. rows for 1 day / 7 days / 31 days routes, with the simulator generating realistic volume (record hardware, dataset size, date).
- Traccar + Postgres behaviour at ≥ 2,000 simulated devices, 10 s intervals (the skill's load target); extrapolate and document.
- RLS overhead on app-side queries (ADR-0003).

## Consequences

- (+) No duplication of the largest dataset; small, fast transactional DB; single source of truth for raw history; matches the spec's evaluate-first rule.
- (+) Safety-critical checks use data we already hold in-process (Redis ring buffer), not a remote report.
- (−) History features inherit Traccar's report performance and its trip/stop detection settings (which must be set deliberately and documented in GPS_INTEGRATION.md).
- (−) Backup/restore and capacity planning cover **two** databases; Traccar's DB is a scaling risk at the high end of the target (R-04 in ARCHITECTURE.md). Mitigation options if hit: shard devices across several Traccar instances behind the same `GpsEnginePort`, or trigger #4 above.
- (−) Cross-vehicle analytics (heatmaps, fleet-wide speed analysis) are not available until trigger #2 is met.
- (−) Aggregates must be recomputable from Traccar history so a bug in the aggregator can be corrected after the fact.
