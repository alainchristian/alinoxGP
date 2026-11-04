---
name: gps-device-catalogue
description: Device compatibility & certification catalogue (platform-managed, shared by all GPS providers), effective-capability resolution, provider-run device onboarding and bulk import, activation lifecycle, diagnostics, device ownership and assignment history, provider inventory, and installation management. Use for any work on GPS device models, firmware, protocols, capabilities ("does this tracker support ignition/fuel/immobilization"), IMEI registration or CSV import, activation statuses, device reassignment or replacement, stock/warranty, technicians and installation jobs.
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

Device types: `TRACKER` (default) and `SPEED_GOVERNOR` (a speed limiter with recording/transmission — rev. 1.2, see `gps-speed-governor-compliance`). For governor models, the catalogue also records:
- minimum reporting interval (must allow ≤ 5 s)
- whether 72 driving hours are kept in non-erasable on-board memory, and how that data can be uploaded
- which attributes signal limiting/overspeed, power cut, speed-signal loss and jamming
- the manufacturer authorisation document of the supplying provider (RURA requires it)

A governor model is never "Tested and verified" until its violation and tamper signals are bench-tested (spec B15).

Capability keys: `gps_tracking`, `trip_history` (derived: needs gps_tracking), `ignition_detection`, `speed_monitoring`, `motion_detection`, `external_power_monitoring`, `battery_monitoring`, `fuel_monitoring`, `digital_inputs`, `digital_outputs`, `driver_identification`, `sos_button`, `towing_detection`, `remote_configuration`, `remote_immobilization`, and for governors `speed_limiting_events`, `tamper_power_cut`, `tamper_speed_signal`, `jamming_detection`, `onboard_record_upload`.

## 3. Effective capability of one installed device

```
effective(cap) = catalogue(variant, cap)
               ∧ installation(cap)      — e.g. ignition wire on DIN1? relay on DOUT1 to starter circuit? installation VERIFIED?
               ∧ observed(cap)          — has the device actually reported the evidence attribute recently?
```

States shown internally: `VERIFIED`, `SUPPORTED_UNVERIFIED`, `PARTIAL`, `NOT_SUPPORTED`, `REQUIRES_CONFIGURATION`, `UNKNOWN`. Customer-facing labels are simpler: **Supported · Partially supported · Not supported · Needs setup**, with a tooltip explaining why (e.g. "Supported by this model, but the ignition wire was not connected during installation").

`remote_immobilization` is effective **only** if: variant capability verified + verified `STARTER_INHIBIT_ON/OFF` commands + confirmation attribute defined + installation verified with starter-circuit relay wiring + ignition observed. Otherwise the feature is disabled for that device (`gps-immobilization-safety`).

Recompute effective capabilities on: catalogue change, firmware change detected, installation verification, and periodically from observed attributes. Store the result with a `computedAt` and the reasons.

## 4. Device onboarding (spec Module 7b) — always done by a GPS provider

The platform has no direct-sale path: every device belongs to a provider (see `gps-provider-model`). The provider either imports devices into its stock first, or registers one while onboarding a customer.

Steps → system behaviour:

1. Provider (approved, not suspended) creates or selects the end customer.
2. Provider registers the vehicle for that customer.
3. Provider selects manufacturer/model/firmware, or picks a device already in its stock.
4. Compatibility check: show the variant's status and capabilities. Unsupported/unknown model → "Request support for this model" to platform technical admins; onboarding stops honestly.
5. Register identifiers: IMEI validated (15 digits + Luhn check digit), **globally** unique across all providers (an IMEI already registered elsewhere → neutral "device unavailable — contact support" to the provider + alert to platform admins; never reveal the other provider). Serial, SIM ICCID/phone if relevant.
6. Configuration instructions generated from the catalogue: server host, the protocol's port, APN guidance, required device settings, and SMS command templates where the model supports them — important for providers migrating devices from another platform.
7. Wait for first signal: the pipeline detects the first position for this device and advances the status.
8. Assign device to the vehicle (creates an assignment record under the customer).
9. Confirmation to the provider and the end customer (in-app + email, provider-branded), including the effective capabilities.

Bulk import (`POST /provider/devices/import`): CSV with IMEI, model/variant, serial, SIM, optional customer + vehicle. Dry-run first (per-row validation: format, Luhn, duplicate in file, already registered, unknown model), then commit; idempotent on IMEI; result report downloadable. Large files run as a BullMQ job.

## 5. Activation status

Spec list (shown to users): **Not registered · Registered · Awaiting configuration · Awaiting first GPS signal · Online · Offline · Configuration error · Suspended.**

Model it as two fields, combined for display — because a suspended device can still be transmitting, and "online/offline" changes every few minutes while lifecycle changes rarely:

- `lifecycleStatus`: `REGISTERED → AWAITING_CONFIGURATION → AWAITING_FIRST_SIGNAL → ACTIVE`, plus `CONFIGURATION_ERROR`, `SUSPENDED`, `RETIRED`. ("Not registered" = no record.)
- `connectivity` (derived from latest state): `ONLINE` / `OFFLINE` / `NEVER_CONNECTED`.
- Display: lifecycle wins unless `ACTIVE`, in which case show connectivity.

Rules: transitions only through the onboarding service; each transition written to `device_status_history` (from, to, actor/system, reason, at). `AWAITING_FIRST_SIGNAL` older than e.g. 24 h appears in the provider's onboarding queue and notifies the provider (platform technical admins see it only on request or if it persists). `CONFIGURATION_ERROR` is set by diagnostics (e.g. positions arriving with wrong protocol port, invalid fixes only, wrong time zone).

## 6. Diagnostics for provider technicians and platform technical admins

Per device: Traccar status and last update; last raw message time; protocol; last N positions with validity/delay flags; attributes seen (and which capability evidence is missing); reporting interval observed vs expected; firmware reported (if the protocol provides it); recent `commandResult` events; unknown-device connection attempts from Traccar logs that match this identifier. Read-only by default; actions (re-sync to Traccar, resend configuration) are audited.

## 7. Ownership and assignment history

- `gps_devices.providerId` (the provider that registered it — always set) is separate from **assignment** to a customer's vehicle. An unassigned device is provider stock (`organization_id` = provider).
- `device_assignments (id, organizationId, deviceId, vehicleId, assignedAt, unassignedAt|null, reason, assignedBy, unassignedBy)` — append-only. Partial unique indexes: one open assignment per device, one open assignment per vehicle.
- Replacement = unassign old (reason `REPLACED`), assign new, link `replacedByDeviceId`.
- History/trips/reports for a vehicle are stitched across devices using assignment windows; tenant visibility follows the windows (`gps-tenant-isolation` §5).

## 8. Inventory and installations (spec Module 8) — per provider

Each provider has its own stock, technicians and jobs; isolation as for any tenant data. Platform admins can read them for support.

Inventory (`device_inventory`): serial, IMEI, model/variant, supplier, purchase date, purchase reference, warranty end, SIM ICCID/MSISDN, status `IN_STOCK | RESERVED | INSTALLED | RMA | RETIRED`, location, maintenance records.

Technicians: provider staff with the Provider Technician role (and optionally a technician profile: phone, region).

Installation jobs (`installations`): provider, customer org, vehicle (registration number), device, technician, scheduled time, status history.

Status workflow (spec): **Requested → Scheduled → In progress → Completed → Verified**, or **Failed** from Scheduled/In progress (with reason; may be rescheduled).

Completion record (filled by the technician): wiring map (power, ground, ignition input, outputs used and what they drive), relay type and location, photos, firmware version read from the device, test checklist with results: GPS fix obtained; ignition on/off detected in the platform; external power cut detected; for immobilizer installs, starter-inhibit relay test **performed with the vehicle stationary and engine off**, re-enable test passed; notes.

Verification: a **provider administrator** (or a provider technician other than the installer, if the provider allows) reviews the record and platform evidence, then sets **Verified** — this is what allows installation-dependent capabilities to become effective. For immobilizer installations, the platform may additionally require review by a platform technical admin for a provider's first N installations (configurable), and `remote_immobilization` stays disabled until that review passes.

Catalogue ownership: only **platform** technical admins change catalogue entries and verification status. Providers can request a new model and upload test evidence, which platform admins review.

## 9. Tests

IMEI validation (Luhn), duplicate IMEI across providers (no leak), bulk import dry-run and idempotent commit, lifecycle transitions allowed/forbidden, first-signal detection, effective-capability matrix (catalogue × installation × observed), immobilization stays disabled unless every condition holds, assignment partial-unique constraints, history stitching across replacement, installation status workflow and verification permission.
