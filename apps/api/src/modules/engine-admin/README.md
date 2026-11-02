# engine-admin

**Purpose:** platform-staff operations for the GPS-engine integration.
**Endpoints (permission `platform.devices.diagnose`):** `GET /admin/engine/health` (engine reachability/version, ingestion leader/stream state, ingest counters, device sync counts, last reconciliation) and `POST /admin/engine/reconcile`. They expose **no customer data** (no coordinates, names or identifiers) and read aggregate counts with the system DB role.
**Reconciliation** (`ReconciliationService`, daily via BullMQ `maintenance` queue when `WORKERS_ENABLED`, or on demand): registers devices that are PENDING/FAILED/missing in the engine, reports devices unknown to the platform and drift, **never deletes anything automatically**, writes an audit entry.
**Not yet:** per-device diagnostics (M5), engine-side drop visibility (OQ-030).
