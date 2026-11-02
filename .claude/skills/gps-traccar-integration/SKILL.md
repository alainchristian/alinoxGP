---
name: gps-traccar-integration
description: How the GPS fleet platform integrates with Traccar — Docker deployment and ports, the GpsEnginePort abstraction and Traccar adapter, service-account authentication, device registration and reconciliation, WebSocket consumption with reconnect/backfill, unit conversion, command discovery and sending, geofence sync (WKT lat/lon order), reports usage, failure handling and integration testing against a real Traccar container. Use for any code or config that calls Traccar, consumes its WebSocket, maps its data, or when the user mentions Traccar, device protocols, ports, IMEI registration or GPS server setup.
---

# Traccar integration

Traccar is the protocol engine: it speaks to devices, decodes ~200 protocols, stores raw positions/events, computes trips/stops and evaluates geofences. Our NestJS app owns everything commercial and every authorization decision. Read `references/traccar-reference.md` for object shapes and endpoints.

**Version discipline.** Pin the Traccar image tag (never `latest`) and record the version in `docs/GPS_INTEGRATION.md`. API details change between major versions; before relying on any endpoint, field or behaviour, check it against the documentation/API reference for the pinned version (https://www.traccar.org/api-reference/). Anything not confirmed goes into `docs/OPEN_QUESTIONS.md`.

## 1. Deployment

- Container `traccar/traccar:<pinned>` in compose, on an internal Docker network.
- Traccar uses its **own** PostgreSQL database (same server is fine initially; separate database + separate DB user). Our app never writes to Traccar's tables directly.
- Config in `infra/traccar/traccar.xml` (mounted). Keep `database.registerUnknown` (auto-create unknown devices) **off** in production — devices are registered only through our onboarding flow.
- Expose to the internet only the protocol ports in use. Common Traccar defaults (verify on the protocol pages for the pinned version): `5055` OsmAnd (simulator), `5027` Teltonika, `5023` GT06 (Concox and many clones), `5004` GL200 (Queclink), `5001` GPS103 (Coban). Open each as TCP and, where the protocol uses it, UDP.
- Port `8082` (web UI + REST + WebSocket) is **internal only**. Technical admins reach the Traccar UI through VPN/SSH tunnel, never publicly.

## 2. The port/adapter boundary

`integrations/gps-engine/port.ts` defines our domain interface — Traccar types never leave the adapter:

```ts
export interface GpsEnginePort {
  registerDevice(input: { uniqueId: string; name: string; model?: string }): Promise<EngineDeviceRef>;
  updateDevice(ref: EngineDeviceRef, patch: Partial<{ name: string; disabled: boolean }>): Promise<void>;
  findDeviceByUniqueId(uniqueId: string): Promise<EngineDeviceRef | null>;
  getLatestPositions(refs: EngineDeviceRef[]): Promise<EnginePosition[]>;
  getRoute(ref: EngineDeviceRef, from: Date, to: Date): Promise<EnginePosition[]>;
  getTrips(ref: EngineDeviceRef, from: Date, to: Date): Promise<EngineTrip[]>;
  getStops(ref: EngineDeviceRef, from: Date, to: Date): Promise<EngineStop[]>;
  getSupportedCommands(ref: EngineDeviceRef): Promise<string[]>;
  sendCommand(ref: EngineDeviceRef, cmd: EngineCommand): Promise<EngineCommandSubmission>;
  upsertGeofence(g: EngineGeofenceInput): Promise<EngineGeofenceRef>;
  linkGeofence(device: EngineDeviceRef, geofence: EngineGeofenceRef): Promise<void>;
  stream(): AsyncIterable<EngineStreamMessage>; // positions, events, device status
}
```

`EnginePosition` is already normalized: speed in **km/h** (Traccar reports **knots** — multiply by 1.852), timestamps as `Date` (UTC), ignition as `boolean | null` (null = not reported), plus `raw` attributes for diagnostics.

## 3. Authentication to Traccar

- A dedicated service user (administrator) with a long random password, credentials only in env (`TRACCAR_URL`, `TRACCAR_USER`, `TRACCAR_PASSWORD`).
- Session: `POST /api/session` (form-encoded `email`, `password`) returns a `JSESSIONID` cookie used for REST and WebSocket. Newer versions also support API tokens (Bearer) — prefer them if the pinned version supports it; verify.
- On `401`, re-authenticate once with single-flight (one login shared by concurrent callers), then retry the request once. Never loop.

## 4. Devices

- `uniqueId` is the identifier the device sends — usually the IMEI, but some protocols use a different ID. The catalogue entry for the model states which (see `gps-device-catalogue`).
- Registration is idempotent: `findDeviceByUniqueId` first; create if absent; store `traccarDeviceId` on our `gps_devices` row.
- Name in Traccar: our device ID or a neutral label — not customer names (keeps Traccar free of personal data where possible).
- Our database is the source of truth. A nightly **reconciliation job** compares our devices to Traccar's and reports drift (missing, extra, disabled mismatch) to technical admins. It never deletes automatically.
- Suspending a customer disables the device in Traccar only if the business rule says data should stop being accepted; by default keep receiving data and restrict *access* in our app.

## 5. WebSocket consumption

- Connect to `/api/socket` with the session cookie. Messages are JSON objects that may contain `devices`, `positions` and/or `events` arrays.
- Run exactly **one** consumer across API instances (Redis lock with TTL + renewal); it publishes normalized messages to the internal pipeline (see `gps-position-pipeline`). If the lock holder dies, another instance takes over.
- Reconnect with exponential backoff + jitter (cap ~30 s). After reconnect, **backfill** latest positions via REST (`GET /api/positions` returns latest per device) so status is correct, and log the gap duration.
- Treat every message as untrusted input: validate with zod, drop malformed, count drops.
- Map `deviceId → organization` through our DB before anything is emitted. Unknown device → drop + metric.

## 6. Commands

- Discover per device: `GET /api/commands/types?deviceId=…`. Store/display only what is both offered by Traccar **and** verified in the catalogue for that model/firmware.
- Send: `POST /api/commands/send`. A success response means Traccar accepted/sent it — **not** that the device executed it.
- Device responses arrive as `commandResult` events. Most protocols give no correlation ID; correlate by device + time window + expected response pattern, and treat a match as **acknowledgement only**.
- Traccar can queue commands for offline devices (behaviour varies by version/protocol — verify). Our immobilization workflow forbids queued delivery: it only sends to online devices and expires otherwise.
- **Never expose a generic "send command" or `engineStop` action in the product.** Immobilization uses only the safety workflow in `gps-immobilization-safety`, mapped to a model-specific, verified command template.

## 7. Geofences

- Our DB is the source of truth (owned by the organization, GeoJSON). We push them to Traccar for enter/exit evaluation and link them to the relevant devices (`POST /api/permissions` with `deviceId` + `geofenceId`).
- Traccar's `area` is WKT with **latitude first**: `CIRCLE (lat lon, radiusMetres)`, `POLYGON ((lat lon, lat lon, …, firstPoint))`. GeoJSON is **longitude first**. Convert explicitly, close polygons, and unit-test with a known point inside/outside. This swap is the most common geofence bug.
- "Remain inside/outside for N minutes" (dwell): if the pinned version does not support it natively, implement it in our pipeline with BullMQ delayed jobs started on enter/exit and cancelled on the opposite event.
- When a device is reassigned, re-link geofences for the new vehicle/org and unlink the old ones.

## 8. History and reports

- Use Traccar reports for history: `/api/reports/route` (positions), `/api/reports/trips`, `/api/reports/stops`, `/api/reports/summary`, `/api/reports/events` with `deviceId`, `from`, `to` (ISO 8601). Request JSON (`Accept: application/json`).
- Always clip the requested range to the device-assignment window and the plan's `history_days` **before** calling Traccar.
- Trip/stop detection depends on Traccar's report settings (minimal trip duration/distance, minimal parking, use-ignition). Set them deliberately, document them in `docs/GPS_INTEGRATION.md`, and make sure dashboard numbers and reports use the same source.

## 9. Failure handling

- Timeouts on every call (e.g. 5 s REST, longer for reports), retries only for idempotent GETs, circuit breaker around the adapter.
- If Traccar is down, the rest of the app keeps working; live views show "Tracking engine unavailable — last update hh:mm" instead of stale data looking live; a health endpoint reports engine status to admins.

## 10. Testing

- Integration tests run against a **real Traccar container** (compose test profile), fed by the simulator over OsmAnd. A test that claims "live tracking works" must pass through real Traccar.
- Adapter unit tests use recorded Traccar JSON fixtures (captured from the pinned version) — not invented shapes.
- Specific tests: knots→km/h conversion; lat/lon WKT conversion; re-auth on 401; WebSocket reconnect + backfill; unknown device dropped; command submission ≠ acknowledgement.
