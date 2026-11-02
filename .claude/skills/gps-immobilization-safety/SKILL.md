---
name: gps-immobilization-safety
description: Safety architecture and mandatory rules for remote vehicle immobilization in the GPS fleet platform — stationary starter-inhibit only (never engine shutdown while driving), defence-in-depth layers, the server-side precondition gate (capability, installation, online, fresh valid fix, ignition off, sustained stationarity), the PENDING/SENT/ACKNOWLEDGED/EXECUTED/FAILED/EXPIRED/CANCELLED state machine, evidence for execution, restoration, audit, emergency procedures and required tests. Use for ANY work touching immobilize, restore, relays, digital outputs, engineStop/engineResume, vehicle commands, vehicle security status or the security dashboard — even small UI or wording changes.
---

# Safe immobilization (stationary starter-inhibit)

This feature can put people in danger if done wrong. The product design is: **prevent the next engine start of a parked vehicle** — not stop a running engine. Every rule below exists because a specific failure (stale data, GPS drift, network delay, a misleading "success" message) could otherwise immobilize a moving vehicle or mislead an owner whose vehicle is being stolen.

## 1. Absolute rules

- No code path, API, UI or admin tool sends a command intended to stop a running engine. No generic "send command" feature in the product.
- Commands are sent only to devices whose `remote_immobilization` capability is **effective** (`gps-device-catalogue` §3) — otherwise the feature is not shown as available.
- Unknown is unsafe: any missing, stale, invalid or contradictory input → **reject**, with a specific reason.
- Never say "immobilized" without execution evidence. "Sent" and "acknowledged" are shown as what they are.
- Domain language: `STARTER_INHIBIT_ON` (immobilize) / `STARTER_INHIBIT_OFF` (restore). The words "engine stop/cut/kill" never appear in our UI, API or code identifiers outside the Traccar adapter's transport mapping.

## 2. Defence in depth

1. **Hardware (the real safety layer):** professionally installed relay on the **starter (cranking) circuit**, per tracker and vehicle manufacturer documentation, so activation cannot stop a running engine — it only blocks cranking. Installation must be recorded and verified. Fuel-pump or ignition-feed cut wiring is not an accepted installation for this product.
2. **Device-side conditions where supported:** some trackers can make output activation conditional on speed or ignition (e.g. certain Teltonika firmware supports speed-conditioned output control). Use it when the catalogue marks it verified for that variant.
3. **Server-side preconditions** (§3), checked at request time **and again immediately before sending**.
4. **Human authorization:** permission + plan entitlement + step-up auth + typed confirmation + reason.
5. **Audit and notification** of every request and outcome.

Software checks cannot eliminate the delay between "last known stationary" and execution; that is why layer 1 is mandatory and why the feature is disabled where it is not verified.

## 3. Precondition gate (all must pass)

| # | Check | Reject code |
|---|---|---|
| 1 | Org entitlement `remote_immobilization` | `FEATURE_NOT_IN_PLAN` |
| 2 | Permission `security.immobilize.request` + step-up auth ≤ 5 min | `FORBIDDEN` / `STEP_UP_REQUIRED` |
| 3 | Effective capability `remote_immobilization` = VERIFIED (variant, commands, confirmation attribute, verified installation) | `CAPABILITY_NOT_VERIFIED` |
| 4 | Device connectivity ONLINE (no queuing for offline devices) | `DEVICE_OFFLINE` |
| 5 | Latest fix age ≤ `maxFixAgeSeconds` (platform default 60; platform-admin configurable, customers cannot loosen it) | `STALE_POSITION` |
| 6 | Latest fix valid, not delayed/outdated | `INVALID_POSITION` |
| 7 | Ignition reported and **false** (device without ignition evidence → feature disabled by #3) | `IGNITION_ON` / `IGNITION_UNKNOWN` |
| 8 | Sustained stationarity: every position in the last `stationaryWindowSeconds` (default 120, ≥ 2 positions) has speed ≤ `stationarySpeedKmh` (default 3, tolerating GPS drift with ignition off) and `motion` ≠ true where reported | `VEHICLE_MOVING` / `INSUFFICIENT_DATA` |
| 9 | No non-terminal command for this vehicle (DB partial unique index on `vehicle_id` where state in PENDING/SENT/ACKNOWLEDGED) | `COMMAND_IN_PROGRESS` |
| 10 | Rate limits: per user, per vehicle, per organization | `RATE_LIMITED` |
| 11 | Reason (enum: theft, unauthorized use, rental agreement breach, other + text) and confirmation (user types the registration number) | `CONFIRMATION_REQUIRED` |

The gate is a pure function over a snapshot (`evaluateImmobilizationPreconditions(snapshot, config, now)`) returning `{ allowed, failures[] }`, so it is exhaustively unit-testable. The UI shows the same checklist live and explains every failure in plain language.

## 4. State machine

```
PENDING ──send ok──► SENT ──commandResult matched──► ACKNOWLEDGED ──confirmation evidence──► EXECUTED
   │                  │                                │
   │ cancel           │ ackTimeout                      │ confirmTimeout / negative evidence
   ▼                  ▼                                ▼
CANCELLED          EXPIRED                           FAILED
   (any state) ── engine/send error, pre-send recheck fails ──► FAILED
```

- **PENDING:** created after the gate passes; re-check gate just before send. Cancellable.
- **SENT:** Traccar accepted the command. Cancellation is generally not technically possible once sent; offer it only if the device/protocol supports a verified cancel/override, otherwise the user restores instead.
- **ACKNOWLEDGED:** a `commandResult` from the device was correlated (device + time window + expected response pattern). This is *not* execution.
- **EXECUTED:** evidence that the output is actually active — the confirmation attribute defined in the catalogue for this variant (e.g. the DOUT state attribute in subsequent positions) shows the expected value. If a variant has no confirmation channel, it cannot be enabled.
- **EXPIRED / FAILED:** timeouts (defaults: ack 120 s, confirm 180 s; configurable by platform admin) run as BullMQ delayed jobs with idempotent handlers. Messaging must be honest: "We could not confirm the vehicle's status. It may or may not be immobilized. Contact support: …".

Each transition is a row in `immobilization_command_events` (state, at, source, evidence JSON). The command row stores: org, vehicle, device, intent, requester, reason, idempotency key, precondition snapshot, engine command ID, current state, timestamps.

**Vehicle security status** (`NORMAL | STARTER_INHIBITED | UNKNOWN`) changes only on EXECUTED evidence (or on observed output state from positions), never on SENT/ACKNOWLEDGED. If the observed output state ever contradicts the recorded status, show UNKNOWN and alert security managers and support.

## 5. Restoration

- Intent `STARTER_INHIBIT_OFF`, same workflow, separate permission `security.restore.request`, step-up auth, reason, audit.
- Restoring is safe while moving, so gate checks 6–8 do not apply; device must still be online (no queuing) and capability verified.
- **Emergency restoration** by Support/Technical admins (`platform.support.access` + reason) for owner lock-outs; owner and security managers are notified.

## 6. Audit, notification, emergency procedures

- `security_events` is append-only: database-level protection (revoke UPDATE/DELETE from the app role, or a trigger that rejects them). Contains every request, rejection (with failures), transition, and restoration.
- Notify organization owner + security managers on every request and every terminal outcome (in-app + email; SMS/WhatsApp when configured).
- `docs/VEHICLE_SECURITY.md` must contain the emergency runbook: vehicle inhibited in an unsafe location; device offline while inhibited (restoration requires connectivity — installer's physical procedure as recorded in the installation); suspected false activation; police/theft cooperation process; 24/7 support contact. Each step names who does what.

## 7. API (spec + consolidation proposals)

- `POST /vehicles/:id/immobilize` → `202` with command resource, or `422` with `{ code, failures[] }`.
- `POST /vehicles/:id/restore` → same shape.
- `GET /vehicles/:id/security-commands/:commandId` → state + timeline.
- `POST /vehicles/:id/security-commands/:commandId/cancel` → only from PENDING (or SENT if verified cancellable).
- `GET /vehicles/:id/security-history` → paginated commands + events.
- All require `Idempotency-Key`.

## 8. Required tests

- Gate: each of the 11 checks failing alone → rejected with the right code; all passing → allowed; boundary values (fix age exactly at limit, speed exactly at threshold); null ignition; single position in window; parked drift within tolerance passes, above tolerance fails.
- Re-check before send fails (vehicle started moving between request and send) → FAILED, nothing sent.
- Duplicate request while one in progress → `COMMAND_IN_PROGRESS` (also at DB level under concurrency).
- ACK without evidence → stays ACKNOWLEDGED then FAILED at timeout; vehicle status never becomes STARTER_INHIBITED.
- Timeout → EXPIRED with honest message; late ACK after EXPIRED is recorded but does not resurrect the command.
- Cancel allowed only in permitted states.
- Restoration path; emergency restoration requires support permission and notifies owner.
- Audit rows immutable (UPDATE/DELETE fail).
- Cross-tenant: org B cannot see or command org A's vehicle (404).
- Entitlement off, permission missing, step-up missing.
- **Real-hardware protocol for M7:** bench test first (tracker + relay + test lamp, no vehicle); then a controlled vehicle test with a professional installer, vehicle stationary, engine off, in a safe location; record results in the catalogue and installation record before any customer use.
