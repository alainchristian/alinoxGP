# Live tracking (M4)

**Purpose.** The page where a dispatcher watches the fleet: a map as the main area, a searchable and filterable vehicle list, a detail panel for the selected vehicle, follow mode, full screen, honest connection and engine states. Route `/app/live` (customer app, full-bleed shell). The older `/app/monitor` stays as a diagnostics page for the raw feed, alert rules and thresholds.

**Workflow (skill steps 1–7).**
1. *Business purpose:* see where every vehicle is and what state it is in, right now, without refreshing.
2. *Workflow:* open the page → snapshot of the whole fleet (`GET /tracking/snapshot`) → pushed deltas over Socket.IO merged by time → pick a vehicle in the list or on the map → details, trail, optional follow.
3. *Dependencies:* M3a pipeline and feed (`/tracking/*`, Socket.IO `vehicle:delta`, `alert:new`, `engine:status`); `GET /maps/config` (ADR-0008); alerts (`GET /alerts`) for the alert ring.
4. *Entities:* none of its own (reads live state; nothing is stored by the page).
5. *Endpoints used:* `GET /maps/config`, `GET /tracking/snapshot`, `GET /tracking/summary`, `GET /tracking/status-config`, `GET /alerts`, Socket.IO feed.
6. *Authorization:* permission `tracking.live.view` for everything the page shows; `alerts.read` for the alert ring and details. Navigation hides the entry for others, but the API decides. Other organizations' vehicles are never returned (404 / absent) and the page is remounted per organization.
7. *Failure scenarios:* engine unavailable (banner), socket reconnecting (banner, last known positions), socket closed by the server (banner), no vehicles (explanation), vehicles without a position (listed, not drawn, counted), map provider unsupported or unreachable (message, list still works), no WebGL (message, list still works), snapshot cut at the server cap (message).

**Files.**
- `live-model.ts` — pure logic (GeoJSON features, bounds, trails, alert ring, labels). Tested without a browser.
- `useLiveFleet.ts` — snapshot + deltas + summary + connection state; shared with the monitor page. **Callers must remount it per organization.**
- `LiveMap.tsx` — the MapLibre map: one clustered GeoJSON source (never one DOM marker per vehicle), `setData` at most once per animation frame, cluster counts as light DOM labels, hover breakdown, selected vehicle on its own layer above the clusters, trail, follow, fit-to-fleet, full screen.
- `marker-images.ts` — marker artwork drawn on a canvas: every status has its own shape as well as its colour (arrow that turns with heading, pause mark, "P", square, hollow circle, dashed circle), plus the Simulated badge.
- `LivePage.tsx` — layout (list | map | details; drawer and bottom sheet below 1024 px), virtualized list (TanStack Virtual), filters, panels.

**Rules to keep.** Unknown stays unknown (Unknown / —, never 0 or Off). A vehicle without a position is never drawn at 0,0. Simulated vehicles always show the badge (list, marker, details). The development map says so. Colour is never the only signal.

**Not here yet.** Group-by (needs categories, M5), driver and capabilities in the details (M5), history/trips links (M6), security actions (M7), reverse geocoding (M6, OQ-012), satellite layer and the Mapbox renderer (OQ-034).

**Tests.** `live-model.test.ts`, `LivePage.test.tsx` (map and virtualizer stood in for: jsdom has no WebGL or layout; includes the tenant-switch test). The map itself is verified in a real browser (see the roadmap's "M4 as built").
