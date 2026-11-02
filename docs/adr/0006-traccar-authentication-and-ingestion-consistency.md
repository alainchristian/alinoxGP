# ADR-0006: Traccar authentication and ingestion consistency

- **Status:** Proposed (awaiting owner review) — 2026-11-01. Based on behaviour verified against Traccar 6.16.0 (`docs/GPS_INTEGRATION.md`).
- **Spec refs:** §5.1 (Traccar independent; credentials never exposed), §10.2, rule 16 (verify, don't assume); skill `gps-traccar-integration`.

## Context

Phase 0 assumed a Traccar service account and a WebSocket consumer. Testing the real engine showed things that change the design:

1. Traccar offers a static `web.serviceAccountToken` (virtual admin) — attractive, but that virtual user is not in the database; devices it creates cannot be listed by it nor delivered to it over the WebSocket.
2. The WebSocket pushes only positions that **advance** a device's latest fix. One future-dated fix (default tolerance 24 h) silences the device's live feed.
3. Traccar stores junk as valid ((0,0), duplicates, older fixes) and delays everything ~3 s by design (`server.buffering.threshold`).
4. Commands are queued and delivered on the next contact.

## Options

**Authentication:** (A) real administrator user + session cookie; (B) static service-account token; (C) per-request API tokens minted from a user.
**Clock/future fixes:** (a) leave defaults, handle in our pipeline; (b) set `filter.future` to a small tolerance in Traccar; (c) rewrite timestamps to server time for chosen protocols (`time.override`).
**Bad coordinates ((0,0), invalid):** (i) drop in Traccar (`filter.zero/invalid`); (ii) keep in Traccar, handle in our pipeline.

## Decision

- **Authentication: (A).** Dedicated administrator `gps-service@…` with a random password in env; `POST /api/session` cookie; single-flight re-login on 401. (B) is not enabled (it is unusable for device ownership and is an extra standing secret). (C) adds nothing.
- **Future fixes: (b)** `FILTER_FUTURE=600`. Our pipeline cannot repair Traccar's notion of "latest", so the engine must refuse the poison. Consequence accepted: a tracker whose clock is >10 min ahead loses data until fixed → diagnostics in M5 (OQ-030). (c) is a possible per-model remedy later, verified per protocol.
- **Bad coordinates: (ii).** A (0,0) or invalid fix is still proof the device is alive; our pipeline treats it as a heartbeat and never moves the marker.
- **Consistency model:** latest state is written only from stream/backfill positions that advance `lastFixAt`; older/equal fixes only refresh liveness; history for playback and reports is always read from Traccar reports (never reconstructed from the stream). After every reconnect, backfill the latest positions.
- **Single consumer:** one leader via Redis lease; handlers are idempotent so a double delivery or failover overlap cannot corrupt state.
- **Tenant routing:** every position is resolved `engine device → our device → open assignment → organization`; writes happen inside that organization's tenant context. Unmapped devices are dropped and counted.
- **Commands (for M7):** because Traccar queues, the immobilization workflow sends only to online devices and must be able to purge queued commands on expiry (to be verified, OQ-006).

## Consequences

- (+) No path for a bad timestamp to freeze a live feed; no cross-tenant routing without our database mapping; engine outages cannot lose registrations.
- (+) Behaviours are pinned by recorded fixtures and an end-to-end suite against a real Traccar, so an engine upgrade that changes them fails tests.
- (−) Data from badly clocked devices is dropped at the engine (visible only in Traccar logs until M5 diagnostics).
- (−) ~3 s fixed latency from `server.buffering.threshold`; lowering it trades ordering safety for latency (not done).
- (−) The service administrator is a high-privilege account in Traccar; it is internal-only and its password is an environment secret (rotation procedure to be written in M10).
- (−) Dependence on a stream that only pushes "newest" positions means real-time views are not a complete log; this is by design (ADR-0004) but must be remembered when building history features.
