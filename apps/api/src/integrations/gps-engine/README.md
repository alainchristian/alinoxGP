# integrations/gps-engine

**The only place that knows about a GPS engine.** `port.ts` defines `GpsEnginePort` and the normalized types the rest of the application uses; `traccar/` is the Traccar implementation (client, adapter, WebSocket stream, mapper, zod schemas); `fake/` is an in-memory engine for **unit tests of port consumers only** (refused in production; never evidence that live tracking works).

Read `docs/GPS_INTEGRATION.md` before changing anything here: it records which behaviours were **verified against the pinned Traccar (6.16.0)** and why the configuration looks the way it does. Schemas and tests are driven by recorded fixtures in `apps/api/test/fixtures/traccar/` — regenerate them with `capture.cjs` after any engine upgrade and review the diff.

Rules: Traccar types never leave `traccar/`; never log payloads or coordinates; errors never carry engine response bodies; adding a port method means implementing it in the Traccar adapter **and** the fake, with tests.
