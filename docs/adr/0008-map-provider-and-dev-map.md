# ADR-0008: Map provider behind a port; open development map until a Mapbox token exists

- **Status:** Accepted — 2026-11-02 (owner decision). Mapbox renderer **pending a token** (OQ-034); Success Milestone 1 item 7 ("display the vehicle on Mapbox") is therefore not yet met.
- **Spec refs:** §12 (Mapbox), §15, `ARCHITECTURE.md` (`MapProviderPort`), OQ-012; skill `gps-fleet-ui` §4.

## Context

The spec names Mapbox GL JS for the live map. Mapbox needs an account and a public access token (`pk.…`), which the owner has not provided yet; the map is the point of M4 and must be seen working now. Mapbox's terms, pricing and the data-protection side of sending locations to a third party are still open (OQ-012, OQ-001). Tile requests reveal the viewed area (not our vehicles: vehicle data never goes to a map provider) to whoever serves the tiles.

## Options

1. **Wait for a Mapbox token before drawing any map.** Faithful to the spec; blocks the milestone and every visual check.
2. **Mapbox GL JS now with a placeholder.** Cannot run without a token; would be unverified code.
3. **MapLibre GL JS (BSD-licensed fork of the Mapbox GL engine) with OpenStreetMap raster tiles, for DEVELOPMENT ONLY, behind a provider port.** Runs today; the layers, sources, clustering and events used are the same GL style-spec features Mapbox GL JS supports, so switching renderer is a small, contained change. OpenStreetMap's tile usage policy allows only light use and forbids production use.
4. **MapLibre with a commercial tile provider.** Production-capable, but a new vendor, cost and terms to evaluate that the owner did not ask for.

## Decision

Option 3.

- **The server decides.** `GET /maps/config` (permission `tracking.live.view`) returns the provider, tile templates or style URLs, attribution and, for Mapbox, a **public** token. The browser holds no map configuration of its own. Behind it sits `MapProviderPort` with two adapters: `DevOsmMapProvider` and `MapboxMapProvider`.
- **The development map cannot reach production.** Environment validation refuses `MAP_PROVIDER=dev-osm` when `NODE_ENV=production`, refuses `mapbox` without a token, and refuses any token that is not a public `pk.` token (a secret `sk.` token must never be sent to a browser — refused even when unused). The UI shows a "Development map" badge whenever the provider is development-only, and the configuration carries a notice.
- **This build draws only `dev-osm`.** If the server is configured for `mapbox`, the page says so plainly and the vehicle list keeps working; nothing is faked. Adding the Mapbox renderer means installing `mapbox-gl`, loading it for `provider === 'mapbox'` with the style URLs from the configuration, and verifying with a real token (OQ-034).
- **MapLibre's web worker** is bundled by Vite (`?worker&url`) and handed to MapLibre explicitly. Without that the map works only in development with pre-bundling off, and **fails in the production build** (the worker file is not emitted) — found and fixed in M4 and checked in a served production build.
- Reverse geocoding stays off (the detail panel shows "Address: not available"); it will arrive behind the same port in M6 once OQ-012 is settled.

## Consequences

- The map is visible and testable now; the production map is one contained change away but **unverified against Mapbox** until a token exists.
- Satellite imagery and Mapbox styles are not available with the development provider (the configuration says `null`; the UI does not pretend).
- Mapbox GL JS v2+ is under Mapbox's licence while MapLibre is BSD: the choice of renderer per provider is a licensing decision to keep explicit (revisit with OQ-012).
- Tile requests to OpenStreetMap carry the viewport and the browser's IP address to a third party; acceptable for development with simulated data, not for production (hence the guard).
- Tests: provider unit tests, environment-validation tests, the `/maps/config` endpoint test (including the permission), the pure model tests of the page, and browser verification (clusters, selection, follow, 1,000 vehicles, production build).
