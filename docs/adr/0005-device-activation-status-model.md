# ADR-0005: Device activation status = lifecycle + derived connectivity

- **Status:** Proposed (awaiting owner review) — 2026-11-01
- **Spec refs:** Module 7 activation statuses; Appendix A.3 item 7 ("decide in Phase 0 / ADR"); skill `gps-device-catalogue` §5

## Context

The spec lists eight user-facing statuses: Not registered, Registered, Awaiting configuration, Awaiting first GPS signal, Online, Offline, Configuration error, Suspended. Most describe a rarely-changing **lifecycle**; "Online/Offline" describe **connectivity**, which changes every few minutes. A suspended device can still be transmitting.

## Options

1. **One enum with all eight values.** Matches the UI list literally; makes it impossible to express "suspended and online", and online/offline flapping would write constantly to the history table and fight lifecycle transitions.
2. **Two fields:** stored `lifecycleStatus` + derived `connectivity`, combined only for display.
3. **Event-sourced status.** Overkill.

## Decision

**Option 2.**

- `lifecycleStatus` (stored, changes only via the onboarding service, each change appended to `device_status_history`): `REGISTERED → AWAITING_CONFIGURATION → AWAITING_FIRST_SIGNAL → ACTIVE`, plus `CONFIGURATION_ERROR`, `SUSPENDED`, `RETIRED`. "Not registered" is the absence of a record (shown in the onboarding UI before step 5).
- `connectivity` (derived from the latest-state pipeline, never hand-set): `ONLINE | OFFLINE | NEVER_CONNECTED`. Uses the same offline threshold function as vehicle status.
- **Display status** (pure function, exact spec wording): lifecycle wins unless `ACTIVE`, in which case show connectivity. `SUSPENDED` shows "Suspended" even when connectivity is ONLINE; diagnostics views show both.
- Connectivity transitions are **not** written to `device_status_history` (they are operational telemetry); they feed alerts ("device offline") and metrics. Only lifecycle changes are historical records.
- `AWAITING_FIRST_SIGNAL` older than a configurable period (default 24 h) creates a task for technical administrators.

## Consequences

- (+) Honest model; no write storm; suspended-but-transmitting is representable; the spec's eight labels are preserved in the UI.
- (−) Two fields to keep consistent in filters ("show offline devices" must exclude suspended/never-activated ones unless asked) — implement filtering through one shared function in `packages/shared`.
