# tracking

**Purpose:** turns the GPS engine's live stream into per-tenant "latest state" and serves it. **M2 slice** of the position pipeline (skill `gps-position-pipeline`); status derivation, Redis state, Socket.IO fan-out, alerts, anomaly handling for delayed/implausible data and throttled persistence are **M3**.
**Owned table:** `vehicle_live_state` [T] — one row per vehicle, tri-state values (`null` = not reported). Raw positions stay in Traccar (ADR-0004).
**Flow:** `IngestionService` (one Redis-leased leader; backfill after every (re)connect) → `PositionPipelineService` → route device→assignment→organization → simulated-data guards → write **inside the owning organization's tenant context**.
**Rules enforced:** unmapped devices dropped + counted; (0,0)/invalid/out-of-range fix = heartbeat only (marker never jumps); older/equal fix never regresses state; `lastSeenAt` monotonic; device claiming `simulated` that is not simulated is blocked; simulated data blocked for non-sandbox organizations and when `SIMULATOR_ENABLED=false`.
**Endpoints:** `GET /tracking/positions` (paged), `GET /tracking/vehicles/:id/location` — permission `tracking.live.view`. A vehicle with no device answers `reason: NO_DEVICE`, one with no data yet `NO_DATA_YET`; nothing is invented.
**Counters** (Redis hash `gps:ingest:stats`): `accepted`, `heartbeat_invalid`, `ignored_out_of_order`, `dropped_unmapped`, `dropped_malformed`, `unassigned_device`, `blocked_simulated`, `backfilled`, `processing_errors`.
**Logging:** no coordinates are ever logged.
**Tests:** `position-pipeline.service.spec.ts` (decision logic, in-memory fakes), `test/gps-pipeline.e2e-spec.ts` (simulator → real Traccar → API, tenant isolation, failover).
