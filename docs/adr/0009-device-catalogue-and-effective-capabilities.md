# ADR-0009: Device catalogue, effective capabilities and onboarding lifecycle

- **Status:** Accepted for M5b (owner can overrule) — 2026-11-02
- **Spec refs:** Modules 5, 6, 7; Rule 12 (never infer a capability from a model name); ADR-0005 (lifecycle + connectivity); skill `gps-device-catalogue`

## Context

Customers must see what their installed device really supports. The platform cannot assert a capability from a manufacturer or model name, and as of this ADR **no physical device has been bench-tested** (DEVICE_COMPATIBILITY.md §5 is empty). The catalogue therefore starts with almost nothing, and everything it records must carry its evidence and its honest status.

## Options for storing the catalogue

1. **Normalized tables** — manufacturer → model → variant (hardware revision + firmware range) → per-capability rows → append-only verification (evidence) log.
2. **One JSON document per model** — fast to build, but no per-capability evidence, no constraint on capability keys, no queryable history.

## Decision

**Option 1.** Global (not tenant-owned) tables, written only through platform-staff routes (`platform.catalogue.manage`), read by customers through a listing that exposes only models marked listed.

- A variant's `compatibilityStatus` is one of `VERIFIED · SUPPORTED_UNVERIFIED · PARTIAL · UNSUPPORTED · REQUIRES_CONFIGURATION`. **`VERIFIED` cannot be set without a verification record** (who, when, firmware, procedure, evidence), enforced by the service and a database CHECK on the log.
- Each capability row carries `support` (`SUPPORTED · PARTIAL · NOT_SUPPORTED · REQUIRES_CONFIGURATION`), the evidence attribute name and notes. A capability that has no row is **UNKNOWN**, never "not supported".

## Effective capability (computed, stored with reasons)

`effective(cap) = catalogue(variant, cap) ∧ installation(cap) ∧ observed(cap)`.

In M5b:
- **Catalogue** is read from the device's variant. No variant chosen → every capability is `UNKNOWN` ("the model has not been identified").
- **Observed** is evaluated for what the live state actually records today: `gps_tracking` (a usable position), `speed_monitoring` (speed reported), `ignition_detection` and `motion_detection` (tri-state not null). A device that has reported but never delivered the evidence shows **Needs setup**, with the reason. Capabilities whose evidence the platform does not yet keep (external power, battery, fuel, digital I/O, SOS, towing) show the catalogue state with the stated reason "not yet observable by the platform" — they are never promoted to verified by observation (OQ-036).
- **Installation** records do not exist until M9 (installation jobs). Capabilities that depend on wiring (`ignition_detection`, `external_power_monitoring`, `digital_outputs`, `remote_immobilization`) are therefore at most `SUPPORTED_UNVERIFIED`, whatever the catalogue says, unless a platform technician has recorded a verified installation check on the device.
- **`remote_immobilization` is never effective in M5b** (rule 4: feature disabled unless verified; the command path is M7). The reason is stated.
- Display labels for customers: **Supported · Partially supported · Not supported · Needs setup · Unknown**, each with the reason.

## Lifecycle (ADR-0005 made concrete)

`REGISTERED → AWAITING_CONFIGURATION → AWAITING_FIRST_SIGNAL → ACTIVE`, plus `CONFIGURATION_ERROR`, `SUSPENDED`, `RETIRED`. All transitions go through one service and write `device_status_history` (append-only). The first usable position moves a device to `ACTIVE` from any pre-active state except `SUSPENDED`/`RETIRED`. A device registered with a chosen model starts at `AWAITING_CONFIGURATION`; the customer confirming "configured" moves it to `AWAITING_FIRST_SIGNAL`. `AWAITING_FIRST_SIGNAL` older than 24 h is flagged in diagnostics.

## Consent

A mechanism, not legal text. Versioned notices (platform-managed, immutable once published) and append-only acknowledgement records (who accepted which version, when, for which device). The notice wording shipped in development is a **draft that has not been reviewed by a lawyer** and says so on screen (OQ-020). Whether a customer must acknowledge before registering a device is a product setting defaulting to **required**.

## Consequences

- (+) Honest by construction: unknown ≠ unsupported; no capability without evidence; verified requires a recorded test.
- (+) Replacing the engine or adding a protocol only adds catalogue rows.
- (−) Until the physical test devices are bench-tested the catalogue holds only the platform simulator profile (exercised through real Traccar, **not a physical device**) and customers with real devices will see "Request support" or Unknown capabilities. That is correct.
- (−) Observed evidence for power/battery/IO needs the pipeline to keep more attributes (OQ-036) — deliberately not done in M5b to avoid touching the position path without the M3b load proof.
