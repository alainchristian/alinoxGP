# Device compatibility, test hardware and verification plan

Phase 0 deliverable — 2026-11-01 (spec §19 tasks 11–12). 

> **Honesty notice.** No manufacturer datasheet, manual or Traccar protocol page was consulted in Phase 0. This document therefore states **no device capability as fact**. Device families below are *candidates to evaluate*, shortlisted from general familiarity; every capability, attribute name and command is `UNKNOWN` until bench-tested and recorded (OQ-002, OQ-018, OQ-019). Per spec rule 12, a capability is never inferred from manufacturer or model name.

## 1. How compatibility is modelled

Catalogue → variant → capabilities/commands/IO map, effective capability = catalogue ∧ installation ∧ observed (skill `gps-device-catalogue`). Statuses (spec wording): Tested and verified · Supported but not physically verified · Partially supported · Unsupported · Requires configuration. Every entry we create from documentation alone is at most **Supported but not physically verified**; **Tested and verified** requires a recorded bench or vehicle test (who, when, firmware, procedure, evidence).

## 2. Recommended first real test hardware (Task 11)

### 2.1 Selection criteria (the real deliverable)

A candidate qualifies for the **primary** test device only if the documentation shows (to be checked, not assumed):

1. A decoder for it exists in the pinned Traccar version (protocol page) — and which identifier it transmits.
2. Network technology matches what Rwandan operators support for the SIM we will use (OQ-010); avoid a 2G-only unit unless 2G longevity is confirmed.
3. A **digital output** able to drive a relay, **and** a documented way to read the output's state back (so execution can be evidenced, not assumed).
4. An **ignition input** (or a documented ignition source) so ignition is reported as a real attribute.
5. External-power sensing and backup battery reporting (for power-cut alerts).
6. Documented behaviour of the output after power loss / reboot (OQ-019) — or at least testable on the bench.
7. Configuration can be done by us (server host, port, APN) with the manufacturer's configurator or SMS commands.
8. Locally purchasable (OQ-026) with a documented manual in English.

### 2.2 Shortlist to evaluate

| Role | Candidate family (evaluate; not verified) | Why shortlisted | What could disqualify it |
|---|---|---|---|
| **Primary** — full-feature test incl. M7 bench/vehicle | Teltonika FMB-series tracker (specific model chosen after reading datasheets, criteria §2.1) | Common in fleet use; manufacturer publishes configurator and documentation; Traccar has a decoder for the family *(verify)* | Output state not readable; model lacks output/ignition input; unavailable locally |
| **Secondary** — the "cheaper device" path / catalogue contrast | GT06/Concox-family unit *(also sold under many clone names)* | Very common and cheap in African markets *(verify local availability)*; Traccar GT06 decoder *(verify)* | Clones vary wildly in firmware and wiring — which is exactly why this device exercises the catalogue's "Partially supported / Requires configuration / Unsupported" paths |
| **Optional third** | Queclink or Coban-family unit | Different protocol decoder; broadens catalogue | Only if budget allows after the first two |

**Specific caution (safety):** many low-cost trackers are marketed with "cut oil/electricity" relay features. Such wiring commonly cuts fuel or ignition feed rather than only blocking cranking. Our product accepts **only** a starter-circuit relay installation (VEHICLE_SECURITY.md). Such a device must be catalogued as *not eligible for immobilization* unless a professional installation with starter-circuit wiring is verified.

### 2.3 Suggested purchase / bench kit (quantities for the owner to confirm)

- 2 × primary device (one stays on the bench for destructive/repeat tests; one for the vehicle) — plus the manufacturer's required harness, antenna/SIM variants as applicable.
- 1 × secondary device.
- Local SIM cards with data (operator and APN per OQ-010); check whether static/public IP is needed (usually not — devices connect outbound to our server).
- 12 V bench power supply with current display, automotive relay(s) (rated for the intended load, with flyback protection), test lamp or multimeter for output observation, fuse holder, wiring and connectors; USB/serial cable for the configurator.
- A professional auto-electrician/installer for the controlled vehicle test (OQ-015). No self-install on a customer vehicle.
- A public IPv4 address for the Traccar server reachable from the mobile network (VPS with open protocol ports) — also needed for Success Milestone 2.

## 3. What must be verified for the chosen devices (Task 12)

Each row is `UNKNOWN` until a dated entry is added. "How" is the verification method; results go to the catalogue (variant capabilities/commands/IO map) and to `variant_verifications` evidence.

| # | Item to verify | How | Result |
|---|---|---|---|
| 1 | Protocol decoder exists in pinned Traccar; default port; identifier type | Traccar protocol page + connect device | UNKNOWN |
| 2 | Device appears in Traccar after configuration; position decoded; fix valid; speed unit sanity (compare to a known speed) | Bench + short drive of the secondary device | UNKNOWN |
| 3 | Firmware version reported (via protocol or configurator) and effect on capabilities | Configurator / attributes | UNKNOWN |
| 4 | Attributes actually delivered in Traccar for: ignition, motion, external power voltage, battery voltage/level, satellites, HDOP, RSSI, digital inputs/outputs, odometer | Inspect raw attributes with each input toggled | UNKNOWN |
| 5 | Reporting intervals: moving, stationary/parked, on ignition change, on heading change; configurable range | Configurator + observation | UNKNOWN |
| 6 | Behaviour when the network drops: does it buffer; are buffered records sent with original fix times; order of delivery | Disconnect SIM/antenna for minutes, reconnect | UNKNOWN |
| 7 | GPS drift while parked, ignition off (speed noise magnitude) — input to the stationarity threshold | Leave on window for hours | UNKNOWN |
| 8 | Command types Traccar offers for this device (`/api/commands/types`), and which actually work over TCP | Query + send harmless ones (e.g. position request) | UNKNOWN |
| 9 | `commandResult` content and whether it can be correlated to the command | Observe events | UNKNOWN |
| 10 | Output control: which command sets/clears the digital output; **is the output state readable in subsequent positions (confirmation attribute)**; latency from send to state change | Bench with relay + lamp | UNKNOWN |
| 11 | **Output state after tracker power loss, reboot, supply reconnect, loss of GPS/network (OQ-019)** | Bench with scripted power cycles; record each | UNKNOWN |
| 12 | Whether output can be made conditional on speed/ignition device-side (variant-specific) | Manual + bench | UNKNOWN |
| 13 | Offline behaviour of commands: does Traccar queue; does the device execute late (OQ-006) | Send while device offline; observe on reconnect | UNKNOWN |
| 14 | Event/alarm types generated: ignition on/off, power cut, low battery, SOS, tow/vibration, overspeed; and which require configuration | Trigger each | UNKNOWN |
| 15 | Current draw, supply range, installation requirements and warnings from the manual | Manual | UNKNOWN |
| 16 | Time handling (device time vs fix time vs server time; time zone issues; clock skew after long offline periods) | Observe over days | UNKNOWN |
| 17 | SIM/APN settings needed; data usage per day at chosen intervals | Operator + measurement | UNKNOWN |

Exit rule for hardware readiness of M7: rows 8–13 answered for the immobilization-candidate variant, recorded in the catalogue, and OQ-006/018/019 marked RESOLVED with evidence. Until then `remote_immobilization` remains disabled for that variant.

## 4. Catalogue seed policy (as built in M5b)

The only seeded entry is the **platform simulator profile**: exercised through the real engine, not a physical device, "Supported but not physically verified", and the database refuses to ever mark it verified. No real model is catalogued until the bench tests in §3 are done and recorded through the platform's verification log. Everything below still applies.


M5 seeds the catalogue with the tested devices only. Entries based purely on documentation are labelled "Supported but not physically verified" with the source cited. Models with no source remain absent; the onboarding UI then offers "Request support" instead of guessing (skill `gps-device-catalogue` §4).

## 5. Verification log

| Date | Device / variant | Item # | Result | Evidence | By |
|---|---|---|---|---|---|
| — | — | — | — | — | — |
