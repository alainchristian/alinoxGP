---
name: gps-device-catalogue
description: Device compatibility & certification catalogue, effective-capability resolution, device onboarding and activation lifecycle, diagnostics, device ownership and assignment history, inventory, and installation management for the GPS fleet platform. Use for any work on GPS device models, firmware, protocols, capabilities ("does this tracker support ignition/fuel/immobilization"), IMEI registration, bring-your-own-device onboarding, activation statuses, device reassignment or replacement, stock/warranty, technicians and installation jobs.
---

# Device catalogue, onboarding and installations

The core rule (spec Rule 12 and Module 6): **a capability is never inferred from a manufacturer or model name.** It is established from verified documentation, the actual installation, and observed device behaviour. Two FMB-series units on different firmware, or the same unit wired differently, can have different capabilities.

## 1. Catalogue model

```
gps_manufacturers (id, name, website)
gps_device_models (id, manufacturerId, name, protocol, networkTechnologies[], identifierType [IMEI|SERIAL|OTHER],
                   defaultReportingIntervals, installationRequirements, knownLimitations, docsUrl)
gps_device_variants (id, modelId, hardwareRevision, firmwareMin, firmwareMax|null,
                     compatibilityStatus, lastTestedAt, testedBy, notes)
variant_capabilities (variantId, capabilityKey, support [SUPPORTED|PARTIAL|NOT_SUPPORTED|REQUIRES_CONFIGURATION],
                      evidenceAttribute (e.g. "ignition", "io239"), evidenceNotes, verifiedAt, verifiedBy)
variant_commands (variantId, intent (e.g. STARTER_INHIBIT_ON), engineCommandType, template/attributes,
                  outputIndex, confirmationAttribute, verifiedAt)
variant_io_map (variantId, kind [DIN|DOUT|AIN], index, defaultUse, notes)
```

`compatibilityStatus` values (spec): **Tested and verified · Supported but not physically verified · Partially supported · Unsupported · Requires configuration.** Store as enum `VERIFIED | SUPPORTED_UNVERIFIED | PARTIAL | UNSUPPORTED | REQUIRES_CONFIGURATION`; display the spec wording.

A new firmware version outside a variant's tested range is `SUPPORTED_UNVERIFIED` until tested.

## 2. Capability keys (union of both briefs)

`gps_tracking`, `trip_history` (derived: needs gps_tracking), `ignition_detection`, `speed_monitoring`, `motion_detection`, `external_power_monitoring`, `battery_monitoring`, `fuel_monitoring`, `digital_inputs`, `digital_outputs`, `driver_identification`, `sos_button`, `towing_detection`, `remote_configuration`, `remote_immobilization`.

## 3. Effective capability of one installed device

```
effective(cap) = catalogue(variant, cap)
               ∧ installation(cap)      — e.g. ignition wire on DIN1? relay on DOUT1 to starter circuit? installation VERIFIED?
               ∧ observed(cap)          — has the device actually reported the evidence attribute recently?
```

States shown internally: `VERIFIED`, `SUPPORTED_UNVERIFIED`, `PARTIAL`, `NOT_SUPPORTED`, `REQUIRES_CONFIGURATION`, `UNKNOWN`. Customer-facing labels are simpler: **Supported · Partially supported · Not supported · Needs setup**, with a tooltip explaining why (e.g. "Supported by this model, but the ignition wire was not connected during installation").

`remote_immobilization` is effective **only** if: variant capability verified + verified `STARTER_INHIBIT_ON/OFF` commands + confirmation attribute defined + installation verified with starter-circuit relay wiring + ignition observed. Otherwise the feature is disabled for that device (`gps-immobilization-safety`).

Recompute effective capabilities on: catalogue change, firmware change detected, installation verification, and periodically from observed attributes. Store the result with a `computedAt` and the reasons.

## 4. Onboarding (spec Module 7)

Paths: **A** — device bought through us (already in inventory, pre-configured, usually installed by our technician); **B** — bring your own device.

Steps → system behaviour:

1. Account created (M1).
2. Vehicle registered.
3. Customer selects manufacturer/model (B) or the device is pre-selected (A).
4. Compatibility check: show the variant's status and capabilities. Unsupported/unknown model → "Request support" ticket; onboarding stops honestly.
5. Register identifiers: IMEI validated (15 digits + Luhn check digit), global uniqueness enforced (an IMEI already registered to another organization → generic error to the customer + alert to technical admins; never reveal the other org). Serial, SIM ICCID/phone if relevant.
6. Configuration instructions generated from the catalogue: server host, the protocol's port, APN guidance, required device settings. For path A technicians do this.
7. Wait for first signal: the pipeline detects the first position for this device and advances the status.
8. Assign device to vehicle (creates an assignment record).
9. Confirmation to the customer (in-app + email), including the effective capabilities.

## 5. Activation status

Spec list (shown to users): **Not registered · Registered · Awaiting configuration · Awaiting first GPS signal · Online · Offline · Configuration error · Suspended.**

Model it as two fields, combined for display — because a suspended device can still be transmitting, and "online/offline" changes every few minutes while lifecycle changes rarely:

- `lifecycleStatus`: `REGISTERED → AWAITING_CONFIGURATION → AWAITING_FIRST_SIGNAL → ACTIVE`, plus `CONFIGURATION_ERROR`, `SUSPENDED`, `RETIRED`. ("Not registered" = no record.)
- `connectivity` (derived from latest state): `ONLINE` / `OFFLINE` / `NEVER_CONNECTED`.
- Display: lifecycle wins unless `ACTIVE`, in which case show connectivity.

Rules: transitions only through the onboarding service; each transition written to `device_status_history` (from, to, actor/system, reason, at). `AWAITING_FIRST_SIGNAL` older than e.g. 24 h raises a task for technical admins. `CONFIGURATION_ERROR` is set by diagnostics (e.g. positions arriving with wrong protocol port, invalid fixes only, wrong time zone).

## 6. Diagnostics for technical admins

Per device: Traccar status and last update; last raw message time; protocol; last N positions with validity/delay flags; attributes seen (and which capability evidence is missing); reporting interval observed vs expected; firmware reported (if the protocol provides it); recent `commandResult` events; unknown-device connection attempts from Traccar logs that match this identifier. Read-only by default; actions (re-sync to Traccar, resend configuration) are audited.

## 7. Ownership and assignment history

- `gps_devices.ownerOrganizationId` (platform inventory, a reseller, or a BYOD customer) is separate from **assignment** to a vehicle.
- `device_assignments (id, organizationId, deviceId, vehicleId, assignedAt, unassignedAt|null, reason, assignedBy, unassignedBy)` — append-only. Partial unique indexes: one open assignment per device, one open assignment per vehicle.
- Replacement = unassign old (reason `REPLACED`), assign new, link `replacedByDeviceId`.
- History/trips/reports for a vehicle are stitched across devices using assignment windows; tenant visibility follows the windows (`gps-tenant-isolation` §5).

## 8. Inventory and installations (spec Module 8)

Inventory (`device_inventory`): serial, IMEI, model/variant, supplier, purchase date, purchase reference, warranty end, SIM ICCID/MSISDN, status `IN_STOCK | RESERVED | INSTALLED | RMA | RETIRED`, location, maintenance records.

Technicians: users with a technician profile (platform or reseller staff).

Installation jobs (`installations`): customer org, vehicle (registration number), device, technician, scheduled time, status history.

Status workflow (spec): **Requested → Scheduled → In progress → Completed → Verified**, or **Failed** from Scheduled/In progress (with reason; may be rescheduled).

Completion record (filled by the technician): wiring map (power, ground, ignition input, outputs used and what they drive), relay type and location, photos, firmware version read from the device, test checklist with results: GPS fix obtained; ignition on/off detected in the platform; external power cut detected; for immobilizer installs, starter-inhibit relay test **performed with the vehicle stationary and engine off**, re-enable test passed; notes.

Verification (technical admin): reviews the record and platform evidence, then sets **Verified** — this is what allows installation-dependent capabilities (including `remote_immobilization`) to become effective.

## 9. Tests

IMEI validation (Luhn), duplicate IMEI across orgs (no leak), lifecycle transitions allowed/forbidden, first-signal detection, effective-capability matrix (catalogue × installation × observed), immobilization stays disabled unless every condition holds, assignment partial-unique constraints, history stitching across replacement, installation status workflow and verification permission.
