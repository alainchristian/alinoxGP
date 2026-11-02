# Traccar quick reference

> Compiled from general knowledge of the Traccar API (versions 5.x/6.x). **Verify every item against the API reference for the version pinned in `docs/GPS_INTEGRATION.md`** before depending on it, and correct this file when something differs.

## Endpoints used by the platform

| Method & path | Purpose | Notes |
|---|---|---|
| `POST /api/session` | Log in (form-encoded `email`, `password`) | Returns user JSON + `JSESSIONID` cookie |
| `GET /api/session` | Current session | Health check of auth |
| `DELETE /api/session` | Log out | |
| `GET /api/server` | Server info | Use for engine health/version |
| `GET /api/devices` | List devices (`?uniqueId=`, `?id=`) | |
| `POST /api/devices` | Create device | Body: `name`, `uniqueId`, optional `model`, `attributes` |
| `PUT /api/devices/{id}` | Update device | Send full object |
| `GET /api/positions` | Latest positions (no params) or by `id`/`deviceId`+`from`+`to` | |
| `GET /api/reports/route` | Positions for range | `deviceId`, `from`, `to` (ISO 8601) |
| `GET /api/reports/trips` | Trips for range | depends on report settings |
| `GET /api/reports/stops` | Stops for range | |
| `GET /api/reports/summary` | Distance, max/avg speed, engine hours | |
| `GET /api/reports/events` | Events for range | optional `type` filter |
| `GET /api/commands/types?deviceId=` | Command types supported for a device | |
| `POST /api/commands/send` | Send command | Body: `deviceId`, `type`, `attributes` |
| `GET/POST/PUT/DELETE /api/geofences` | Geofence CRUD | `area` in WKT, lat-first |
| `POST /api/permissions` / `DELETE /api/permissions` | Link/unlink objects | e.g. `{ "deviceId": 1, "geofenceId": 7 }` |
| `GET /api/socket` (WebSocket) | Live stream | Messages contain `devices`, `positions`, `events` arrays |

## Device object (main fields)

`id`, `name`, `uniqueId`, `status` (`online` | `offline` | `unknown`), `disabled`, `lastUpdate`, `positionId`, `groupId`, `phone`, `model`, `contact`, `category`, `attributes`.

## Position object (main fields)

| Field | Meaning |
|---|---|
| `deviceId` | Traccar device ID |
| `protocol` | Decoder name (e.g. `teltonika`, `gt06`, `osmand`) |
| `deviceTime` | Time reported by the device |
| `fixTime` | Time of the GPS fix — use for ordering positions |
| `serverTime` | When Traccar received it — use for connectivity/offline |
| `outdated` | Position re-sent without a new fix |
| `valid` | GPS fix validity |
| `latitude`, `longitude`, `altitude` | Degrees / metres |
| `speed` | **Knots** (× 1.852 = km/h) |
| `course` | Heading, degrees 0–360 |
| `accuracy` | Metres (if provided) |
| `address` | Only if Traccar geocoding is enabled (keep it off; we geocode via our map provider) |
| `attributes` | Protocol-dependent: e.g. `ignition`, `motion`, `sat`, `hdop`, `rssi`, `power` (external V), `battery` (V), `batteryLevel` (%), `distance`, `totalDistance`, `hours`, `alarm`, `driverUniqueId`, digital I/O such as `in1`, `out1` or vendor `io…` keys |

Attribute names and availability differ by protocol and device configuration. The device catalogue maps each capability to the attribute(s) that evidence it for that model.

## Event object

`id`, `type`, `eventTime`, `deviceId`, `positionId`, `geofenceId`, `maintenanceId`, `attributes`.

Event types include: `commandResult`, `deviceOnline`, `deviceOffline`, `deviceUnknown`, `deviceInactive`, `deviceMoving`, `deviceStopped`, `deviceOverspeed`, `deviceFuelDrop`, `deviceFuelIncrease`, `geofenceEnter`, `geofenceExit`, `alarm`, `ignitionOn`, `ignitionOff`, `maintenance`, `textMessage`, `driverChanged`, `media`.

`alarm` events carry `attributes.alarm`, e.g. `sos`, `powerCut`, `lowBattery`, `tow`, `vibration`, `movement`, `overspeed`, `tampering`, `jamming`, `accident`, `hardBraking`, `hardAcceleration`. Which alarms a device produces depends on model and configuration.

## Command types (examples)

`custom`, `positionSingle`, `positionPeriodic`, `positionStop`, `engineStop`, `engineResume`, `outputControl`, `rebootDevice`, `getVersion`, `setTimezone`, `configuration`, `setSpeedLimit`, `alarmArm`, `alarmDisarm`. The set actually available is per device/protocol — always query `/api/commands/types`.

`engineStop`/`engineResume` are Traccar's generic names. In our product they may only be used as the transport for the starter-inhibit intent on a model whose installation is verified to wire that output to a starter-circuit relay (see `gps-immobilization-safety`). The words "engine stop" never appear in our UI or domain model.

## Geofence WKT

- Circle: `CIRCLE (-1.9441 30.0619, 300)` → latitude `-1.9441`, longitude `30.0619`, radius 300 m.
- Polygon: `POLYGON ((-1.95 30.05, -1.95 30.07, -1.93 30.07, -1.93 30.05, -1.95 30.05))` — latitude first, first point repeated at the end.
- GeoJSON is `[longitude, latitude]` — swap on conversion.
