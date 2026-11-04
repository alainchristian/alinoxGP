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
- **Speed governors are not a command channel.** Speed limiting is done by the governor hardware on the vehicle. The platform never changes a governor's set speed or calibration remotely, and never sends engine-power commands (see `gps-speed-governor-compliance`). RURA's "ignition detection and disabling" maps only to this skill's stationary starter-inhibit.
- Domain language: `STARTER_INHIBIT_ON` (immobilize) / `STARTER_INHIBIT_OFF` (restore). The words "engine stop/cut/kill" never appear in our UI, API or code identifiers outside the Traccar adapter's transport mapping.

## 2. Defence in depth

1. **Hardware (the real safety layer):** professionally installed relay on the **starter (cranking) circuit**, per tracker and vehicle manufacturer documentation, so activation cannot stop a running engine — it only blocks cranking. Installation must be recorded and verified. Fuel-pump or ignition-feed cut wiring is not an accepted installation for this product.
2. **Device-side conditions where supported:** some trackers can make output activation conditional on speed or ignition (e.g. certain Teltonika firmware supports speed-conditioned output control). Use it when the catalogue marks it verified for that variant.
3. **Server-side preconditions** (§3), checked at request time **and again immediately before sending**.
4. **Human authorization:** permission + entitlement (provider plan, provider's terms accepted, provider enabled it for this customer and this vehicle) + step-up auth + typed confirmation + reason.
5. **Audit and notification** of every request and outcome.

Software checks cannot eliminate the delay between "last known stationary" and execution; that is why layer 1 is mandatory and why the feature is disabled where it is not verified.

## 3. Precondition gate (all must pass)

| # | Check | Reject code |
|---|---|---|
| 1 | Entitlement `remote_immobilization` effective for this customer (provider plan ∩ customer limit), provider has accepted the vehicle-security terms, provider not suspended, feature not disabled by the platform for this provider/device, and the provider has **enabled** it for this vehicle (`provider.security.enable`, step-up, audited) | `FEATURE_NOT_IN_PLAN` / `FEATURE_NOT_ENABLED` |
| 2 | Permission `security.immobilize.request` + step-up auth ≤ 5 min | `FORBIDDEN` / `STEP_UP_REQUIRED` |
| 3 | Effective capability `remote_immobilization` = VERIFIED (variant, commands, confirmation attribute, verified installation) | `CAPABILITY_NOT_VERIFIED` |
| 4 | Device connectivity ONLINE (no queuing for offline devices) | `DEVICE_OFFLINE` |
| 5 | Latest fix age ≤ `maxFixAgeSeconds` (platform default 60; platform-admin configurable; providers and customers cannot loosen it) | `STALE_POSITION` |
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
- **Emergency restoration**, first line: the customer's **provider** (`provider.security.emergency_restore` + step-up + reason); second line: platform Support/Technical admins (`platform.support.access` + reason). The customer's owner and security managers are notified in both cases.

## 5a. Who does what (provider model)

| Party | Responsibility |
|---|---|
| Provider | Installs the starter-circuit relay, records and verifies installation evidence, accepts the vehicle-security terms, enables the feature per vehicle, trains the customer, first-line emergency restoration, 24/7 contact shown to the customer |
| End customer | Requests immobilize/restore through this workflow |
| Platform | Enforces this gate and state machine for every provider; owns the catalogue (which variants can do it); may require review of a provider's first immobilizer installations; can disable the feature per provider/device (`platform.security.disable`); keeps the immutable audit trail; second-line support |

Provider staff may also *request* immobilization on a customer's behalf only if the provider setting allows it and the customer's owner has consented; the request still passes the full gate and is shown in the customer's access log.

## 6. Audit, notification, emergency procedures

- `security_events` is append-only: database-level protection (revoke UPDATE/DELETE from the app role, or a trigger that rejects them). Contains every request, rejection (with failures), transition, and restoration.
- Notify the customer's owner + security managers **and the provider's operations staff** on every request and every terminal outcome (in-app + email; SMS/WhatsApp when configured).
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
- Cross-tenant: another customer of the same provider, and any other provider, cannot see or command the vehicle (404).
- Entitlement off at provider-plan level, at customer-limit level, provider terms not accepted, feature not enabled for the vehicle, provider suspended, platform-disabled; permission missing; step-up missing.
- Provider emergency restoration works with its permission and notifies the customer; provider staff of another provider cannot.
- **Real-hardware protocol for M7:** bench test first (tracker + relay + test lamp, no vehicle); then a controlled vehicle test with a professional installer, vehicle stationary, engine off, in a safe location; record results in the catalogue and installation record before any customer use.
