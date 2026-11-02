# Vehicle security and safe immobilization

Phase 0 deliverable — 2026-11-01 (spec Module 12; §19 task 14). **Architecture and runbook skeleton — nothing implemented or hardware-verified.** Implementation skill: `gps-immobilization-safety`. Unknowns: OQ-006, OQ-015, OQ-018, OQ-019.

## 1. Product definition

The feature is a **stationary starter-inhibit**: it prevents the *next engine start* of a parked vehicle. It is **not** an engine shutdown mechanism and nothing in the product can stop a running engine.

Domain vocabulary: `STARTER_INHIBIT_ON` (immobilize) / `STARTER_INHIBIT_OFF` (restore). The words "engine stop / cut / kill" do not appear in the UI, API or code identifiers outside the Traccar adapter's transport mapping (Traccar's own command names).

## 2. Absolute rules (binding)

1. No code path, API, UI or admin tool sends a command intended to stop a running engine; **no generic "send command" feature exists**.
2. Never send an immobilization command while the vehicle is moving, or when speed/ignition is unknown, stale, invalid or contradictory.
3. Never say "immobilized" without execution **evidence**. Sent and acknowledged are shown as exactly that.
4. Feature enabled per device only when its effective capability is VERIFIED; otherwise disabled and not shown as available.
5. Immobilization hardware is professionally installed per tracker and vehicle manufacturer documentation, on the **starter (cranking) circuit**. Fuel-pump or ignition-feed cut wiring is not accepted for this product.
6. Unknown is unsafe: reject.

## 3. Defence in depth

| Layer | Control |
|---|---|
| 1 Hardware (the real safety layer) | Relay on starter circuit — activation cannot stop a running engine; installation recorded and verified by a technical admin (Installation → "Verified" gates the capability). |
| 2 Device-side conditions (where verified) | e.g. output activation conditional on speed/ignition if the specific variant supports it (OQ-018). Never assumed. |
| 3 Server preconditions | Pure function over a snapshot, evaluated at request time and **again immediately before sending** (§4). |
| 4 Human authorization | Permission + plan entitlement + step-up auth (≤ 5 min) + typed confirmation (registration number) + reason code/text. |
| 5 Audit & notification | Append-only `security_events`; owner and security managers notified of every request and terminal outcome. |

Software cannot remove the delay between "last known stationary" and execution; this is why layer 1 is mandatory.

## 4. Precondition gate — all must pass

| # | Check | Reject code |
|---|---|---|
| 1 | Org entitlement `remote_immobilization` | `FEATURE_NOT_IN_PLAN` |
| 2 | Permission `security.immobilize.request` and step-up ≤ 5 min | `FORBIDDEN` / `STEP_UP_REQUIRED` |
| 3 | Effective capability VERIFIED (variant, verified commands, confirmation attribute, verified installation, observed ignition) | `CAPABILITY_NOT_VERIFIED` |
| 4 | Device ONLINE (**no queuing for offline devices**) | `DEVICE_OFFLINE` |
| 5 | Latest fix age ≤ `maxFixAgeSeconds` (platform default 60; platform-admin-configurable; customers cannot loosen) | `STALE_POSITION` |
| 6 | Latest fix valid, not delayed/outdated | `INVALID_POSITION` |
| 7 | Ignition reported and false | `IGNITION_ON` / `IGNITION_UNKNOWN` |
| 8 | Every position in the last `stationaryWindowSeconds` (default 120, ≥ 2 positions) ≤ `stationarySpeedKmh` (default 3) and motion ≠ true | `VEHICLE_MOVING` / `INSUFFICIENT_DATA` |
| 9 | No non-terminal command for the vehicle (DB partial unique index) | `COMMAND_IN_PROGRESS` |
| 10 | Rate limits (user, vehicle, organization) | `RATE_LIMITED` |
| 11 | Reason + typed confirmation | `CONFIRMATION_REQUIRED` |

Defaults above are starting points from the project skill, **not validated** thresholds; the stationarity tolerance depends on measured parked drift of the real tracker (DEVICE_COMPATIBILITY.md row 7). The gate reads the Redis recent-positions ring buffer (ADR-0004), not a Traccar report. The UI shows the same checklist live via `security-preconditions`.

## 5. Command state machine

```
PENDING ─send ok─► SENT ─commandResult correlated─► ACKNOWLEDGED ─state evidence─► EXECUTED
  │ cancel           │ ack timeout                      │ confirm timeout / negative evidence
  ▼                  ▼                                  ▼
CANCELLED          EXPIRED                            FAILED      (any state: send error / pre-send recheck fails ─► FAILED)
```

- PENDING cancellable. SENT cancellable only if a verified cancel/override exists for the variant; otherwise user restores.
- ACKNOWLEDGED ≠ executed. EXECUTED requires the catalogue-defined confirmation attribute showing the expected output state; a variant without a confirmation channel cannot be enabled.
- Timeouts (defaults: ack 120 s, confirm 180 s; platform-configurable) are idempotent BullMQ delayed jobs. A late acknowledgement after EXPIRED is recorded but does not resurrect the command.
- Honest messaging on EXPIRED/FAILED: "We could not confirm the vehicle's status. It may or may not be immobilized. Contact support: …".
- `VehicleSecurityStatus` = `NORMAL | STARTER_INHIBITED | UNKNOWN`; changes only on execution evidence or observed output state; if observation contradicts the record → `UNKNOWN` + alert security managers and support.
- Every transition is an append-only `immobilization_command_events` row (state, time, source, evidence JSON).

## 6. Restoration

`STARTER_INHIBIT_OFF` through the same workflow with its own permission (`security.restore.request`), step-up, reason and audit. Safe while moving, so checks 6–8 are skipped, but the device must be online and the capability verified. **Emergency restoration** by Support/Technical admins (`platform.support.access` + reason, time-boxed) for owner lock-outs; owner and security managers notified.

## 7. Audit

`security_events` and `immobilization_command_events` are append-only (UPDATE/DELETE revoked from the app role + reject trigger), recording requests, rejections (with failure list), transitions, restorations and emergency restorations, with requester, time, reason, delivery, acknowledgement, execution evidence and failure (spec Module 12).

## 8. Test strategy

Unit: gate (each check failing alone; boundaries; null ignition; single-position window; drift within/above tolerance). Workflow with fake engine: pre-send recheck failure sends nothing; duplicate request → `COMMAND_IN_PROGRESS` (also at DB level under concurrency); ACK without evidence never reaches EXECUTED; timeout → EXPIRED; late ACK; cancel only in allowed states; restoration; emergency restoration permission and owner notification; audit immutability; cross-tenant 404; entitlement/permission/step-up missing. A code-search check proves forbidden identifiers/paths do not exist outside the adapter.

**Real hardware protocol (M7):** (1) bench: tracker + relay + test lamp, no vehicle — answer OQ-006/018/019; (2) controlled vehicle test with a professional installer, vehicle **stationary, engine off**, safe location; (3) record results in the catalogue and installation record; (4) only then may a customer use the feature (and only after OQ-015). Do not implement live engine shutdown at any stage.

## 9. Emergency runbook (skeleton — owner must fill in names, numbers and legal steps before launch)

| Situation | Who | Steps |
|---|---|---|
| Vehicle inhibited in an unsafe location | Customer / Support | Customer requests restoration (step-up) → if unavailable, Support performs emergency restoration (reason recorded) → confirm via position/status evidence → notify owner. |
| Device offline while inhibited | Support + installer | Restoration requires connectivity. Follow the installer's physical bypass procedure recorded in the installation record; log the manual action; investigate offline cause. |
| Suspected false activation / wrong vehicle | Support lead | Restore, preserve audit trail, review gate snapshot and actor, notify owner, incident report. |
| Theft recovery cooperation | Owner + Support + police | Owner files report; support shares verified location history only through legal channel and per data-protection rules (OQ-001/020); no immobilization while moving — only when the gate passes. |
| Account compromise suspected | Support | Revoke sessions, require password reset, review security history, restore if needed. |
| 24/7 support contact | _TBD by owner_ | Number/email to be displayed on EXPIRED/FAILED messages and in the owner notification. |
| Legal/insurance contact | _TBD by owner_ | OQ-015. |

## 10. Dependencies on other decisions

Effective-capability logic (`gps-device-catalogue` §3); minimal installation-verified record in M7 (full installation workflow in M9 — flagged in roadmap); notifications in M7 limited to in-app + email (SMS later, M8).
