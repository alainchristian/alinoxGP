# GPS Tracking, Fleet Management and Vehicle Security SaaS Platform
## Consolidated Project Specification

| | |
|---|---|
| **Document** | `docs/PROJECT_SPEC.md` — single source of truth for requirements |
| **Version** | 1.2 — 4 November 2026 (speed governors, M3 split, prototype maps; see Appendix A.5). 1.1 — 1 November 2026 (provider-first revision) |
| **Owner** | Alain Christian Majyambere |
| **Sources merged** | (1) *Base brief* — "International GPS Tracking, Fleet Management and Vehicle Security SaaS Platform"; (2) *Extension brief* — "Extend the existing project requirements…" (declared mandatory); (3) *Owner decisions of 1 Nov 2026* — the platform serves **GPS tracking providers** (see Appendix A.4), which take precedence over both briefs where they conflict |
| **Product in one sentence** | A multi-tenant tracking platform that **GPS tracking providers** subscribe to, so they can serve and track the vehicles of **their own customers** under their own brand |
| **Initial market** | Rwanda (RWF, Africa/Kigali), architected for international expansion |

---

## 0. How to read this document

1. **Every requirement from both source briefs is preserved.** Where the extension brief added to a topic, its content has been merged into the matching section of the base brief rather than appended separately, so each topic is described in one place.
2. **Where the two briefs disagreed**, the extension brief wins (it is later and declares itself mandatory). Every such case is listed in **Appendix A — Reconciliation notes**, with the resolution applied.
3. **Items marked _[Added in consolidation]_** were not in either brief. They are small, necessary connective pieces (e.g. an endpoint for command cancellation, which the extension brief requires but neither brief listed). They are proposals and can be changed in Phase 0.
4. **Uncertain facts** (hardware capabilities, protocols, provider pricing, regulation) are collected in **Appendix B — Open questions requiring verification**. Per the extension brief, these must be verified, not assumed.
5. **"Must", "never" and "do not"** are binding. "Should" and "consider" leave room for architectural judgment, which must be documented (see Rule 9).
6. Implementation guidance for Claude Code lives in the project skills under `.claude/skills/` — see **Appendix C**.
7. **Owner decisions (1 Nov 2026) override both briefs.** The platform is sold to GPS tracking providers, not directly to vehicle owners. Text from the briefs that assumed direct sales has been rewritten; Appendix A.4 lists every change. Where the briefs say "customer", read "provider's customer" (an end-customer organization) unless the context is billing, where the paying customer is the provider.

### Glossary

| Term | Meaning |
|---|---|
| **Platform** | Us — the operator of this software (Alain's company) |
| **Provider** | A GPS tracking business (installer, tracking company, dealer) that registers on the platform and pays us per device. Formerly called "reseller" in the briefs |
| **End customer** | An individual or organization (car owner, fleet, NGO…) served by a provider; it logs in to see only its own vehicles |
| **Device** | A GPS tracker owned or managed by a provider and assigned to an end customer's vehicle |
| **Speed governor** | A device fitted to public/goods transport vehicles that limits maximum speed on the vehicle and records and transmits speed data (also called speed limiter) |
| **Governed vehicle** | A vehicle enrolled in speed-governor compliance (Module 18) |
| **Regulator** | A read-only external organization (e.g. RURA) given access to governed-vehicle compliance data |

---

## 1. Role and responsibilities

Act as a senior software architect, GPS tracking systems engineer, IoT integration specialist, SaaS product strategist, database architect, UI/UX designer and senior full-stack developer.

You are responsible for designing and building a professional, commercial-grade GPS tracking and fleet management platform.

- Do not approach this as a simple CRUD application.
- Treat it as a serious commercial B2B2C SaaS platform: **GPS tracking providers** are our paying customers, and through them the platform serves individual vehicle owners, transport companies, logistics businesses and other organizations managing fleets.
- Think like a company building a commercial product that must compete with established international platforms — not a developer building a demonstration project.
- The platform launches in Rwanda and will expand into other African countries and international markets.
- Your work must demonstrate professional software engineering, thoughtful architecture, excellent user experience, security, scalability and commercial awareness.
- Do not rush into coding without understanding the complete system. First establish the architecture, system requirements, development strategy and implementation plan; then develop systematically.
- Make architectural decisions that are practical, secure, maintainable and commercially viable.

---

## 2. Product vision

We are building a **GPS Tracking, Fleet Management and Vehicle Security SaaS platform for GPS tracking providers**.

GPS tracking providers register on the platform, connect the trackers they install, create accounts for their own customers, and track and serve those customers' vehicles. The platform never sells to vehicle owners directly and never competes with its providers for their customers.

```
Platform (us) ──bills per active device──► Provider A ──serves & bills (outside the platform)──► End customers of A
                                          Provider B ──────────────────────────────────────────► End customers of B
```

### 2.1 What providers can do

1. Register their company on the platform and, after approval, start a trial or subscription.
2. Brand the platform with their logo and colours, so their customers see the provider's brand.
3. Add their staff (administrators, operations/support, technicians, finance) with granular permissions.
4. Register GPS devices individually or in bulk (e.g. CSV import of IMEIs) from supported manufacturers, and check compatibility in the device catalogue.
5. Connect devices to the platform's GPS servers (configuration instructions per model) and verify the first signal.
6. Create and manage their end customers (individuals or organizations) and invite those customers' users.
7. Register vehicles for their customers, assign devices and drivers, and manage device replacement.
8. Manage their device stock, installations, technicians and installation verification.
9. Monitor all their customers' vehicles and device health in one console, and act as first-line support.
10. Enable vehicle security (stationary starter-inhibit) only for professionally installed and verified vehicles, and handle emergency restoration for their customers.
11. Suspend or reactivate service for an individual end customer (e.g. when the customer has not paid the provider).
12. View their usage (active devices) and pay the platform's invoices (MTN Mobile Money, Flutterwave, bank transfer).
13. If they are authorised speed-governor suppliers: record governor installations and inspections, receive violation and tamper alarms, send the required SMS alerts, produce RURA's quarterly reports, and give RURA read-only access (Module 18).

### 2.2 What end customers can do

1. Log in under their provider's brand and see only their own organization's vehicles.
2. Monitor vehicles in real time; view historical movements and replay journeys.
3. Monitor vehicle speed and ignition status.
4. Receive vehicle security alerts and notifications.
5. Create geographical boundaries (geofences) and alert rules.
6. Request immobilization/restoration of compatible, verified vehicles through the safety-controlled process (stationary starter-inhibit only — see Module 12).
7. Manage drivers (where the provider's plan allows).
8. Generate fleet management reports.
9. Manage multiple vehicles and their own users under one account.
10. See which capabilities their installed GPS devices actually support.
11. Contact their provider for support (the provider's contact details are shown in the app).

End customers do **not** buy devices, subscriptions or installations through the platform; they deal with their provider for those.

### 2.3 Business model

**Single model — tracking platform for GPS providers.** Providers pay the platform a recurring fee per **active device** (see Module 15). Each provider sets its own prices and bills its own customers outside the platform.

- *Model A of the base brief (we sell devices and installation directly) is out of scope* — owner decision, Appendix A.4.
- *Model B (bring your own device)* is now the core model, operated by providers on behalf of their customers.
- Providers are white-labelled with logo and colours in the first release. Provider-owned domains, branded email sender and branded mobile apps are a later phase (design for them now).
- Billing tools for providers to invoice their own customers are **not** in scope for the first release (possible later add-on).

### 2.4 Who the providers are and who they serve

Providers (our customers):

- GPS installation businesses and independent installers.
- GPS tracking companies currently using another platform (e.g. a manufacturer's free app or a white-label platform).
- **RURA-authorised speed-governor suppliers**, which must provide a compliant tracking platform for the governors they install (Module 18).
- Vehicle security and telematics companies adding tracking.
- Car dealers, rental companies or fleet service firms that track vehicles for others.
- In a later phase: providers in other countries, and sub-agents of providers.

Their end customers:

- Individual vehicle and motorcycle owners.
- Small businesses; transport, logistics and delivery companies.
- Taxi and car rental businesses, bus operators.
- Large fleet operators, construction companies, organizations managing fleets.
- NGOs, government institutions and other institutions.

---

## 3. Target market and internationalisation

### 3.1 Initial market

Rwanda.

- Default currency: **RWF**.
- Default timezone: **Africa/Kigali**.

### 3.2 International readiness

The architecture must support international expansion. **Do not hardcode Rwanda-specific assumptions or business rules into the core application.** Additional countries must be introduced through configuration, not rewrites.

Configurable:

- Countries.
- Currencies.
- Time zones.
- Languages (multiple languages in a future phase).
- Telephone country codes and international phone number support.
- Date and time formats.
- Tax and billing rules.
- Payment providers (country-specific payment integrations).
- Notification providers.
- Subscription plans.

### 3.3 Data protection

Design with Rwanda's applicable data protection legislation in mind — in particular for location-data access, retention, user permissions and customer consent — and with privacy requirements of future markets in mind. See Appendix B for the specific verification items (data localisation and cross-border transfer affect hosting and third-party providers).

---

## 4. Technology stack

Use this stack unless there is a compelling technical reason to propose a change (which must be explained with alternatives and a recommendation — see §18).

| Area | Choice |
|---|---|
| **Frontend** | React, TypeScript, Vite, Tailwind CSS, a professional component system such as shadcn/ui, React Router, TanStack Query, Zustand where appropriate, React Hook Form, Zod validation, maps: **MapLibre GL JS + OpenFreeMap for development and prototype**, **Mapbox GL JS (or another commercial vendor) for production**, chosen in M11, with all map setup in one module; Recharts (analytics) |
| **Backend** | Node.js, TypeScript, NestJS, REST API, WebSockets, JWT or secure session-based authentication, role-based access control, Swagger/OpenAPI |
| **Database** | PostgreSQL, Prisma ORM, proper indexing, database migrations |
| **GPS engine** | Traccar |
| **Real-time** | Traccar WebSocket, NestJS WebSocket Gateway, Socket.IO or native WebSockets where appropriate |
| **Background processing / cache** | Redis, BullMQ |
| **Infrastructure** | Ubuntu VPS, Docker, Docker Compose, Nginx, SSL certificates, GitHub, environment-based configuration |

Architecture style:

- **Modular monolith** with clearly separated domains, so individual services can be extracted later if required.
- Avoid unnecessary microservices and do not overcomplicate the architecture.

---

## 5. System architecture

### 5.1 The four layers

**Layer 1 — GPS hardware.** Physical GPS tracking devices installed in vehicles. Potential manufacturers: Teltonika, Concox, Queclink, Coban, and other manufacturers supported by Traccar. Devices communicate with the GPS server over mobile networks using their own protocols.

- Do not assume all GPS devices support identical features.
- Device capabilities must be configurable and discoverable where possible, and determined by the Device Compatibility module (Module 6).

**Layer 2 — GPS processing engine (Traccar).** Traccar handles: device communication, protocol interpretation, device identification, position processing, speed, coordinates, ignition information where supported, device events, historical positions, trips, geofences, and device commands where supported.

- Do not recreate GPS communication protocols unnecessarily.
- Integrate through Traccar's REST API and WebSocket.
- Read and understand the official documentation before implementing the integration:
  - https://www.traccar.org/documentation/
  - https://www.traccar.org/traccar-api/
  - https://www.traccar.org/api-reference/

**Layer 3 — Our application backend (NestJS).** Manages all commercial and application logic: providers, provider branding, end-customer organizations, users, roles, permissions, vehicles, GPS device assignments, device catalogue and onboarding, installations, drivers, provider subscriptions and payments, notifications, reporting, vehicle security, audit logs, and API integrations.

- Traccar must remain an independent GPS processing component.
- **Never expose Traccar administrator credentials to the frontend.**
- The frontend communicates only with our NestJS API.
- NestJS must enforce tenant permissions **before** returning GPS data or executing commands.

**Layer 4 — Frontend application (React).** One React application with three separate interfaces (see §12):

1. **Customer app** — for end customers, shown under their provider's brand: live tracking, maps, vehicles, trips, geofences, alerts, vehicle security, reports, users.
2. **Provider console** — for provider staff: all their customers, devices, onboarding, installations, support tools, branding, provider billing.
3. **Platform admin** — for our staff: providers, device catalogue, platform billing, diagnostics, audit, settings.

### 5.2 External service provider abstraction

Do not couple the application tightly to a single external provider. Create provider abstraction layers for:

- GPS tracking engines.
- Map services.
- Payment providers.
- SMS providers.
- Email services.
- WhatsApp notifications.

It must be possible to replace or add providers without rewriting the business application.

**Initial implementation:**

| Concern | Initial provider |
|---|---|
| GPS engine | Traccar |
| Maps | MapLibre + OpenFreeMap (prototype); Mapbox or alternative (production, decided in M11) |
| Database | PostgreSQL |
| ORM | Prisma |
| Backend | NestJS |
| Frontend | React + TypeScript |
| Cache and queues | Redis + BullMQ |
| Deployment | Docker on Ubuntu VPS |

Keep payment and notification integrations modular so they can be introduced progressively.

---

## 6. Multi-tenant architecture (critical)

Build the platform as a multi-tenant SaaS application with a **three-level tenant hierarchy**, enforced from the first milestone:

```
Platform (us)
├── Provider: SecureTrack Ltd            ← pays us; sees all of its own customers
│   ├── End customer: ABC Transport Ltd (35 vehicles)
│   ├── End customer: John (2 vehicles)
│   └── End customer: Rwanda Tours (12 vehicles)
└── Provider: Kigali GPS Services        ← cannot see SecureTrack or its customers
    └── End customer: XYZ Logistics (20 vehicles)
```

Requirements:

- Strict organization-level data isolation. An end customer must **never** access another organization's vehicles, devices, positions, reports, users or billing information.
- A provider must **never** access another provider's data, customers or devices.
- A provider's staff may access the data of **their own** end customers, as their permissions allow, and every such access to location history or security commands is audit-logged (the end customer's data is processed on the customer's behalf; see Appendix B11).
- An end customer must not be able to see the provider's other customers, the provider's stock, or the provider's billing with the platform.
- Moving an end customer from one provider to another is a platform-admin operation with consent from the customer, an audit trail, and history visibility rules defined in an ADR.
- Implement tenant isolation at **both** the database and backend levels.
- Every tenant-owned business record must be associated with an organization/tenant identifier.
- Use PostgreSQL constraints and appropriate authorization controls.
- Consider PostgreSQL Row-Level Security as an additional protection where appropriate.
- Never rely exclusively on frontend filtering for tenant isolation.
- Never trust client-provided tenant identifiers.

Organization types to support:

- **Platform** (one).
- **Provider** — GPS tracking business; white-labelled with logo and colours (own domain and apps in a later phase).
- **End customer** — individual account (one member) or business/fleet organization, always belonging to exactly one provider.
- *Sub-provider / agent of a provider* — later phase; design the hierarchy so a fourth level can be added without rewriting isolation.
- **Regulator** — read-only organization outside the provider hierarchy, with access limited to governed vehicles of enrolled providers (Module 18). It is not a tenant of any provider; its access is a separate, audited grant.

---

## 7. User roles and permissions

Implement role-based access control with **granular** permissions, checked in the **backend**.

| Level | Roles |
|---|---|
| **Platform** | 1. Super Administrator · 2. Operations Administrator · 3. Technical Administrator · 4. Finance Administrator · 5. Support Administrator |
| **Provider** (replaces "Reseller" of the base brief) | 1. Provider Owner · 2. Provider Administrator · 3. Provider Operations/Support · 4. Provider Technician · 5. Provider Finance |
| **End-customer organization** | 1. Organization Owner · 2. Organization Administrator · 3. Fleet Manager · 4. Security Manager · 5. Driver · 6. Read-only Viewer |
| **Regulator** (external, read-only — rev. 1.2) | 1. Regulator Administrator (manages its own users) · 2. Regulator Viewer |

- Example of granularity: a Fleet Manager may view vehicle locations but may not necessarily have permission to immobilize vehicles.
- Only authorized roles may execute sensitive vehicle commands.
- The customer app, provider console and platform admin must have **distinct navigation and permissions**.
- Provider roles act across that provider's end customers; customer roles act only inside one end-customer organization. A provider may grant a staff member access to a subset of its customers (e.g. a support agent for one region).
- Show menu items based on permissions (cosmetic only — the backend is the authority).

---

## 8. Core system modules

> Numbering note: the base brief had 14 modules. The extension brief added three (Device Compatibility & Certification, Device Onboarding & Activation, Installation & Inventory Management). They are inserted next to Device Management so related functionality sits together. Appendix A.1 maps old numbers to new.

### Module 1 — Authentication and user management

- User registration, login, logout.
- Password recovery, email verification.
- User profile.
- **Provider self-registration** (company details, contact, country), reviewed and approved by platform admins before devices can be connected.
- End-customer organizations are created by their provider; end-customer users join by invitation (no public sign-up for end customers).
- Branded login: the login page shows the provider's logo and colours when reached through the provider's login address (§12).
- Organization switching where authorized (e.g. provider staff switching between customers; a person who belongs to several organizations).
- Role management, permission management.
- Session management.
- Optional two-factor authentication.

### Module 2 — Main dashboard

Two dashboards: the **end-customer dashboard** (below) and the **provider dashboard** (all customers: active devices, devices offline or never connected, devices awaiting first signal, open alerts by customer, installations due, suspended customers, this month's billable devices).

End-customer dashboard — show, from real data:

- Total registered vehicles.
- Vehicles currently moving / parked / idling / offline.
- Vehicles with active alerts; vehicles requiring attention.
- Total distance travelled.
- Fleet utilization.
- Recent trips; recent notifications.
- Device health and operational performance (extension brief priority list).

Rules:

- Use real database values. **Do not populate production dashboards with arbitrary percentages, invented statistics or fake charts.**
- Provide meaningful empty states for new customers.
- Do not spend excessive time on attractive dashboards before a working GPS integration exists (see §17 milestone order).

### Module 3 — Live GPS tracking (most important functional module)

Features:

- Display all authorized vehicles on an interactive map.
- Display registration numbers, movement status, current speed, ignition status where supported, last GPS communication time, direction of movement, device connection status.
- Vehicle information side panel.
- Search vehicles; filter by status; filter by organization (provider staff see all their customers' vehicles and filter by customer); group vehicles; select individual vehicles.
- Automatic position updates.

Real-time:

- Use Traccar WebSocket and our NestJS WebSocket infrastructure.
- Do not continuously refresh the entire page; only update the relevant vehicle information.

Map: zooming, panning, vehicle markers, marker clustering, vehicle selection, route visualization, multiple-vehicle tracking, map layers, full-screen mode.

Markers must visually distinguish: **Moving, Parked, Idling, Offline, Alert status**.

The interface must remain usable with **hundreds or thousands** of vehicles.

### Module 4 — Vehicle management

Providers register vehicles for their customers and assign GPS devices. End customers (as permissions allow) can edit vehicle information, assign drivers, view vehicle history, current location, tracking status, immobilizer capability and vehicle documents, and manage vehicle categories. Whether an end customer may add vehicles itself is a provider setting (default: off, because each vehicle needs a device installed by the provider).

Vehicle fields: registration number, make, model, year, color, vehicle type, VIN (where appropriate), fuel type, assigned driver, organization, GPS device, installation date, insurance expiry, inspection expiry, notes.

### Module 5 — GPS device management

Provider administrators and technicians can (platform admins can do the same for support):

- Register GPS devices individually or by bulk import (CSV of IMEI/serial/model/SIM); assign and unassign devices to/from vehicles of their own customers.
- Identify GPS manufacturer and model; store IMEI (and other identifiers, e.g. serial number).
- Monitor connection status and last communication.
- View device information, capabilities, installation information, supported commands.
- Track device ownership.
- Manage device replacement.

Rules:

- A GPS device is **not** permanently tied to a single vehicle. Support reassignment with a complete historical record.
- Every device belongs to exactly one provider. An IMEI can be registered only once on the whole platform; if a second provider tries to register it, the platform tells that provider only that the device is unavailable (never who holds it) and alerts platform admins.
- Device capabilities come from Module 6 and must reflect actual hardware and configuration — never assumptions based on manufacturer name.

Example capability record (base brief; extended in Module 6):

```json
{
  "gps_tracking": true,
  "ignition_detection": true,
  "speed_monitoring": true,
  "external_power_monitoring": true,
  "digital_output": true,
  "remote_immobilization": true,
  "fuel_monitoring": false
}
```

### Module 6 — GPS device compatibility and certification *(extension brief)*

A dedicated module maintaining a structured **catalogue of supported devices**, covering different manufacturers, models, protocols, firmware versions and hardware configurations. Do not assume every tracker supports the same functionality because it uses GPS.

For every catalogue entry maintain:

- Manufacturer; device model; hardware revision; firmware version.
- Supported communication protocol; supported network technologies.
- GPS tracking capability; ignition detection; speed monitoring; external power monitoring; battery monitoring; fuel monitoring.
- Digital input capabilities; digital output capabilities.
- Immobilization compatibility.
- Supported configuration commands.
- Installation requirements; known limitations.
- Compatibility verification status; date last tested.

Compatibility statuses:

- Tested and verified.
- Supported but not physically verified.
- Partially supported.
- Unsupported.
- Requires configuration.

Rules:

- Platform administrators manage the catalogue; it is shared by all providers.
- Providers can browse the catalogue before buying hardware, request support for a new model, and submit test evidence for a model/firmware; only platform technical administrators can change a catalogue entry's verification status.
- End customers can see which capabilities their installed devices support, e.g.:
  - Live vehicle tracking: Supported
  - Ignition monitoring: Supported
  - Fuel monitoring: Not supported
  - Remote immobilization: Supported
  - Trip history: Supported
- Capabilities must be determined from **verified technical information, configuration and actual device behaviour**, not simply the manufacturer or model name (see also Rule 12).

### Module 7 — Provider onboarding, device onboarding and activation *(extension brief, adapted to providers)*

**7a. Provider onboarding**

1. Provider registers (company name, registration number, country, contact person, phone, email, expected number of devices).
2. Email and phone verification.
3. Platform admin reviews and approves (or rejects with a reason). Until approval the provider can explore a **sandbox** with simulated devices only.
4. Provider accepts the platform terms and the data processing agreement (Appendix B11).
5. Provider sets up branding (logo, colours, support contact) and invites its staff.
6. Trial starts (configurable length and device limit), then a paid plan (Module 15).

**7b. Device onboarding** — performed by the provider for each of its customers (the briefs' categories A "bought through the platform" and B "bring your own" collapse into one flow, because devices always come from the provider):

1. Provider creates the end customer (or selects an existing one).
2. Provider registers the vehicle for that customer.
3. Provider selects or identifies the GPS device model (or imports a batch of devices into its stock beforehand).
4. Platform checks device compatibility against the catalogue.
5. Device IMEI and other identifiers are registered (globally unique).
6. Device is configured to communicate with the platform's GPS infrastructure (per-model instructions; bulk configuration help for providers migrating many devices from another platform, e.g. SMS command templates — see Appendix B12).
7. Platform verifies that the device is transmitting data.
8. Vehicle is associated with the GPS device.
9. Provider and end customer receive confirmation of successful activation; the end customer's users receive their invitations if not already active.

Device activation statuses:

- Not registered
- Registered
- Awaiting configuration
- Awaiting first GPS signal
- Online
- Offline
- Configuration error
- Suspended

Provide technical administrators with tools for **diagnosing device communication problems**.

### Module 8 — Device inventory and installation management *(extension brief, run by providers)*

Each provider manages its own stock, technicians and installation jobs; providers never see each other's inventory. Platform admins can view any provider's records for support. Maintain:

- GPS device inventory.
- Device serial number and IMEI.
- Purchase date; supplier.
- Installation date; assigned technician; vehicle registration number.
- Installation status.
- Warranty information.
- Device replacement history; maintenance history.

Installation workflow statuses:

- Installation requested.
- Installation scheduled.
- Installation in progress.
- Installation completed.
- Installation verified.
- Installation failed.

Provider technicians record installation notes and test results; a provider administrator (or a provider technician other than the installer, per provider setting) marks the installation **verified**. For immobilizer installations, verification additionally requires the evidence listed in Module 12, and the platform may require a platform technical admin review for a provider's first immobilizer installations (configurable).

### Module 9 — Trip history and route playback

Users can: select a vehicle, select a date range, view recorded journeys, starting location, destination, departure time, arrival time, total distance, maximum speed, average speed, stops, idle periods, and replay journeys on the map.

Playback controls: play, pause, stop, speed adjustment, timeline navigation. Show trip statistics alongside the map.

### Module 10 — Geofencing

Support circular geofences, polygon geofences, named locations, restricted areas, company premises, warehouses, customer locations.

Generate events when vehicles:

- Enter a geofence.
- Leave a geofence.
- Remain inside or outside for a configured duration.

Users can associate notification rules with geofences.

### Module 11 — Alerts and notifications

Event-based notification system supporting:

- Overspeeding.
- Ignition ON; Ignition OFF.
- Unauthorized movement.
- Geofence entry; geofence exit.
- GPS device offline.
- External power disconnection.
- Low battery (where supported).
- SOS event (where supported).
- Towing detection (where supported).
- Vehicle immobilization events.

Channels: in-app, email, SMS, WhatsApp — behind a provider abstraction. **Start with in-app and email**; keep SMS and WhatsApp configurable for later.

Notifications to end customers carry their provider's name and logo. Providers also receive operational notifications about their fleet of devices (device never connected, offline for long periods, power cut, installation awaiting verification, a customer's security command failed). SMS/WhatsApp messages cost money: who pays (provider credits or included allowance) is a plan setting.

### Module 12 — Vehicle immobilization and security (premium feature)

Remote immobilization is implemented **only** for compatible devices with **professionally installed** immobilization systems, as a **stationary starter-inhibit function — never an engine shutdown mechanism while driving.**

Absolute rules:

- Never implement a command that cuts the engine while a vehicle is moving.
- Never send an immobilization command while a vehicle is moving.
- Never provide a generic engine-cut command or bypass vehicle safety systems.
- Never claim a vehicle has been immobilized without reliable confirmation. Sending a command does not mean the device executed it.
- If Traccar or a particular tracker cannot reliably verify safe execution, **disable the feature for that device**.
- Physical immobilization hardware must be professionally installed according to the tracker and vehicle manufacturers' documentation.

Safety and workflow requirements:

- Only compatible devices; device capability and compatibility must be verified before the feature is enabled.
- Only authorized users can request immobilization; require explicit authorization **and** confirmation.
- Require a documented safety verification process.
- Require sufficiently recent and reliable GPS and vehicle-state information; check recent speed and ignition.
- Reject when movement is detected.
- Reject when speed or ignition state is unknown, unreliable, unavailable or stale.
- Secure command workflow with a complete audit trail: the request, requesting user, timestamp, reason, delivery, device acknowledgement, execution confirmation, failure.
- Distinguish command **sent**, **acknowledged** and **successfully executed**.
- Command expiration (timeout); command cancellation where technically possible.
- Duplicate command protection; rate limiting.
- Immobilization history and restoration history.
- A safe restoration (re-enable normal starting) workflow.
- Emergency support procedures.

Command states:

```
PENDING · SENT · ACKNOWLEDGED · EXECUTED · FAILED · EXPIRED · CANCELLED
```

Responsibilities in the provider model:

- **Provider:** installs the relay on the starter circuit, records the installation evidence, verifies it, enables the feature per vehicle, trains its customer, and provides first-line emergency restoration.
- **End customer:** requests immobilization/restoration through the safety workflow (permission + step-up + confirmation + reason).
- **Platform:** enforces the safety gate and state machine for every provider, maintains which device models/firmware can support the feature, can disable the feature for a provider or device, and keeps the immutable audit trail.
- The feature is off by default for every provider; a provider must accept specific terms (installation standards and liability) before enabling it.

Testing: use a controlled test device and professional installation procedures. Do not implement live engine shutdown.

### Module 13 — Driver management

- Register drivers; assign drivers to vehicles; driver contact information.
- Driving history; driver-related events; overspeeding incidents; driver performance reports.
- Do not assume the person assigned to a vehicle is the person currently driving it.
- Support driver identification where compatible hardware is available.

### Module 14 — Reporting and analytics

Reports: daily / weekly / monthly movement, distance travelled, trip history, vehicle utilization, idle time, overspeeding, geofence violations, driver activity, device connectivity, security events, immobilization history. ("Fleet Performance" in the navigation is served by this module.)

Report features: date filters, vehicle filters, driver filters, PDF export, Excel export, CSV export. Useful visualizations with Recharts — from real data only. Exported reports carry the provider's branding.

Provider reports: active devices per customer and per month (matches the platform invoice), device connectivity health across customers, installations by status and technician, alerts by customer, security commands by customer.

### Module 15 — Provider subscription and billing

**The platform bills providers, not end customers.** Providers set their own prices and bill their customers outside the platform.

Billing unit: **active device per month** — a device that is assigned to a vehicle (or transmitting) at any time during the billing month, as defined precisely in an ADR (e.g. count of devices with an active assignment or data received during the month). Simulated/sandbox devices are never billable. Suspended end customers' devices remain billable only if the provider keeps them connected (rule configurable).

Configurable provider plans (structure, not fixed prices — see `PRICING_RESEARCH.md` for the current hypothesis):

- Volume tiers of price per active device (graduated), a minimum monthly fee, and optional prepaid device bundles.
- Feature entitlements per plan: live tracking; historical tracking period; geofencing; reports and analytics; driver management; security features; remote immobilization; API access; number of provider staff users; branding level.
- Trial (length, device limit), grace period, suspension rules.

A **speed-governor add-on** is billed per governed vehicle (Module 18) on top of the active-device fee, because governed vehicles produce 5-second data, mandatory SMS and regulator reporting.

Providers can pass plan limits down to their customers (e.g. give one customer 30-day history and another 180 days, within the provider's own plan).

**Never hardcode subscription prices or plan limits.**

Support: monthly and annual billing, upgrades, downgrades, trial periods, expiry, grace periods, usage statements (which devices were billed and why), invoices, payment history, payment reminders, and suspension after the grace period (end customers then see a neutral "service temporarily unavailable — contact your provider" message; GPS data keeps being received so nothing is lost).

Payments:

- Multiple payment providers behind an abstraction. Initial Rwanda providers to investigate: **MTN Mobile Money**, **Flutterwave**. Future international providers via the same abstraction.
- Never assume a payment succeeded from a frontend response. Verify via authenticated server-side verification and provider webhooks.

### Module 16 — Provider management (platform administration)

Platform administrators can: review and approve provider registrations, view providers and their end customers, manage provider accounts and plans, view active-device usage, view invoices and payments, suspend and reactivate providers, view provider activity, assist with device assignments and diagnostics, manage support requests from providers, and move an end customer between providers (with consent and audit).

### Module 17 — Provider console and branding (core module)

A provider can: register and manage its own end customers, invite and manage their users, assign GPS devices, manage customer vehicles, set per-customer feature limits, suspend/reactivate a customer, monitor device status across all customers, manage staff, view its usage and invoices, and manage its branding.

- Providers must never access another provider's customers, devices or data.
- **Branding (first release):** logo, colours, display name, support phone/email/WhatsApp, terms and privacy links shown in the customer app and login page; notification emails carry the provider's name and logo (sent from the platform's domain).
- **Branding (later phase, design now):** provider's own domain with TLS, branded email sender domain, branded SMS sender ID, branded mobile apps.
- End customers never see the platform's brand except a small, configurable "powered by" mention and legal pages where required.

### Module 18 — Speed governor compliance *(added 4 Nov 2026)*

**Why.** In Rwanda, public transport and goods transport vehicles must be fitted with speed governors (Presidential Order N° 25/01 of 25/02/2015, article 30 bis). RURA's *Public Notice on Minimum Requirements for Road Speed Governor Supply and Installation for Public and Goods Transport* (30 July 2020) sets what an authorised speed governor supplier must provide. That includes a tracking platform that records and transmits speed data, real-time violation alarms to the supplier **and to RURA**, RURA access to the platform, automated SMS alerts, and quarterly online/offline reports. A national standard is in draft (WTO notification G/TBT/N/RWA/905) and may change these rules (Appendix B16).

Speed-governor suppliers are therefore a natural group of **providers**, and their customers are bus, minibus, school-bus and truck operators. This module lets a RURA-authorised supplier meet the platform-side requirements on our platform, hosted in Rwanda.

**Division of responsibility**

- The **governor hardware** limits speed on the vehicle: it warns the driver with a buzzer, then progressively reduces engine power at the set speed, and is failsafe. The platform never does this remotely.
- The **platform** records, stores, transmits, alerts, reports and supports inspection. In the first release it **never changes a governor's set speed or calibration remotely** and never sends engine-power commands. Set-speed changes are made on the vehicle by the supplier's authorised technician and recorded in the platform.
- The **provider** (authorised supplier) holds the RURA authorisation, installs, calibrates, seals, maintains and inspects governors, and answers to RURA.

**RURA requirement → platform feature** (from the 2020 notice; exact wording and Annex A to be confirmed — Appendix B13)

| RURA notice requirement | Platform feature |
|---|---|
| Speed recorded in km/h at intervals of **no more than 5 seconds**, each entry with GPS coordinates; date dd/mm/yyyy, 24-hour time | Ingest and keep high-frequency records for governed vehicles; governor reports and exports always use dd/mm/yyyy and 24-hour time |
| Record and transmission format per **Annex A** | Export and transmission in the Annex A format once obtained (B13) |
| Off-board storage: speed data relayed in real time to the supplier's data storage system | Our platform is that storage system for the provider; real-time ingestion via Traccar |
| On-board non-erasable memory retaining 72 driving hours after a power cut | Hardware requirement; record in the catalogue whether each governor model meets it; support upload of on-board data after reconnection where the device supports it |
| **Every violation transmitted in real time to the supplier and to RURA's storage system, with an alarm to both** | Violation detection; real-time alarm to the provider; regulator transmission outbox (interface to be obtained — B13); delivery status per violation |
| Supplier provides RURA **access to its platform/dashboard** | Read-only **Regulator portal** (§12), scoped as below |
| Automated SMS to the client on any change, including devices going offline | SMS mandatory for governed vehicles: offline, back online, tamper, violation summary (configurable) |
| **Quarterly report** of online/offline periods | Quarterly connectivity report per provider and per vehicle, reproducible from stored connectivity periods |
| Failsafe; interference easy to detect; checked by an authorised officer | Tamper and disconnection events (power cut, speed-signal loss, device removal where the hardware reports them); inspection support view |
| Accuracy and function checked at least **every 6 months**, at motor vehicle inspection | Inspection records, due dates and reminders to provider and customer |
| RURA-approved installation sticker on each vehicle; 12-month minimum warranty; manuals; calibration equipment held only by authorised personnel | Installation record: sticker serial, seal number, set speed, calibration date and technician, warranty end, manual versions; calibration done only by provider technicians with a specific permission |
| Subscriber databases **not transferred, stored or processed outside Rwanda**; access to customer information logged | Production hosting in Rwanda for this data (in practice the whole platform); access logging already required (§13) |
| Supplier documents infrastructure, outsourced systems, access levels, backups, disaster recovery, incident management, QoS (availability, MTTR, uptime) | Platform **compliance pack** that providers attach to their RURA application, describing our hosting, backups, DR, incident process, measured uptime and access controls |
| Listed tracking-platform features: GPS speed limiter, geofence-based speed limit, geofencing, power reporting, motion detection, SOS, ignition detection and disabling, speed reporting, periodic reporting, idle alarm, anti-jamming | Mostly covered by Modules 3, 10, 11 and 14. "Ignition disabling" is offered **only** as Module 12's stationary starter-inhibit. "Geofence-based speed limit" is a device-side configuration: later phase only, after RURA confirms it is allowed and the device behaviour is verified. Jamming alarms are shown where the device reports them |

**Regulator access**

- New organization type `REGULATOR` with read-only users (e.g. RURA, and the traffic police if required).
- Scope: only vehicles enrolled as **governed** (public passenger or goods transport) by providers that are authorised governor suppliers.
- Visible data: installation and inspection records, violations (time, speed, set speed, location), tamper events, connectivity periods and quarterly reports, plus a live view of governed vehicles if RURA requires it.
- Not visible: private vehicles, geofences, unrelated history, or providers' commercial data.
- Every regulator access is audit-logged and visible to the provider. The legal basis and scope are to be confirmed (B11, B13).

**Data and performance**

- At 5-second records, one governed vehicle produces 12 records a minute; **1,000 governed vehicles ≈ 200 positions/s**, the M3b load target. Governor providers make the scale proof a real requirement, not a hypothetical one.
- Retention of governor records must meet RURA's requirement, which is to be confirmed (B14). History must stay retrievable for inspections and investigations even if the customer leaves the provider; record the rule in an ADR.

**Pricing:** governed vehicles cost more to serve (data volume, mandatory SMS, regulator reporting), so the speed-governor service is priced as an add-on per governed vehicle (Module 15, `PRICING_RESEARCH.md`).

**Sources:**
- RURA notice (PDF): https://www.rura.rw/fileadmin/user_upload/RURA/Documents/Sectors/Transport/Regulatory_instruments/Transport_Regulations_and_Guidelines/Guideline_requirements_for_road_speed_governor_supply_and_installations_for_public_and_goods_transport.pdf
- RURA transport regulations list: https://www.rura.rw/sectors/transport/regulatory-instruments/regulations-and-guidelines
- Draft standard summary (TÜV): https://www.tuv.com/regulations-and-standards/en/rwanda-maximum-road-speed-governors-for-motor-vehicles-requirements.html

---

## 9. GPS simulator and testing environment

Before connecting physical GPS hardware, establish a GPS simulation environment and use it to test the **entire data pipeline**.

The simulator generates realistic data including:

- Latitude and longitude; vehicle speed; heading.
- Ignition status; GPS signal quality.
- Device timestamp; server timestamp.
- Vehicle movement; stopped-vehicle status.
- Trip creation; geofence entry and exit.

Repeatable test scenarios:

- Vehicle moving along a route.
- Vehicle stopping.
- Ignition switching on and off.
- Vehicle entering and leaving a geofence.
- Device disconnecting; device reconnecting.
- Delayed GPS transmission.
- Invalid GPS coordinates.
- Out-of-order position messages.

Speed-governor scenarios *(rev. 1.2, for M9)*:

- Governed vehicle reporting every 5 seconds along a route.
- Vehicle reaching its set speed: speed plateaus at the set speed as the governor cuts power.
- Recorded speed above the set speed (violation), e.g. downhill or a faulty governor.
- Power cut or speed-signal disconnection (tamper), then reconnection with upload of buffered records.
- Device offline for longer than the threshold, then back online (SMS to the customer, connectivity period recorded).

Rules:

- The simulator must clearly identify simulated devices and simulated positions.
- **Never present simulated positions as genuine customer vehicle locations**, and never allow simulated positions to appear as real customer vehicle positions in production.
- Do not replace actual GPS functionality with static mock data and claim live tracking works (Rule 3).

---

## 10. Database and GPS data architecture

### 10.1 Database design

Design a normalized PostgreSQL schema. Initial domain model (not a requirement to create every table immediately):

`users`, `organizations`, `organization_members`, `roles`, `permissions`, `role_permissions`, `countries`, `currencies`, `vehicles`, `vehicle_categories`, `drivers`, `gps_devices`, `gps_device_models`, `gps_manufacturers`, `gps_device_capabilities`, `device_assignments`, `positions`, `trips`, `geofences`, `alerts`, `notification_preferences`, `notifications`, `immobilization_commands`, `security_events`, `subscriptions`, `subscription_plans`, `invoices`, `payments`, `payment_transactions`, `resellers`, `audit_logs`, `support_tickets`.

Provider-model entities *[Added in revision 1.1 — names are proposals]*: `organizations.type` (`PLATFORM | PROVIDER | CUSTOMER`) with `parent_organization_id` replacing the separate `resellers` table; `provider_profiles` (legal details, approval status, approved by/at, terms and DPA acceptance); `provider_branding` (logo, colours, display name, support contacts, legal links, future custom domain); `provider_staff_scopes` (which customers a staff member may access); `customer_entitlements` (per-customer limits set by the provider within its plan); `billing_usage_snapshots` (active devices per provider per day/month, with the device list, so invoices can be explained); `provider_feature_terms` (e.g. accepted immobilization terms); `customer_transfers` (moves between providers, with consent).

Speed-governor entities *[rev. 1.2 — proposals]*: `vehicles.use_class` (`PRIVATE | PUBLIC_PASSENGER | GOODS | SCHOOL_BUS | OTHER`); `governor_installations` (vehicle, device, governor make/model, set speed, RURA sticker serial, seal number, calibration date and technician, warranty end, status); `governor_inspections` (date, inspector, result, next due date); `governor_violations` (start/end, peak and set speed, location, duration, regulator delivery status); `governor_tamper_events`; `device_connectivity_periods` (online/offline intervals, the source of the quarterly report); `regulator_outbox` (payload in the Annex A format, attempts, delivered at, error); `regulator_access_grants` (regulator org, provider, scope, granted by/at); `compliance_reports` (quarter, provider, generated file, checksum).

Entities implied by the extension brief *[Added in consolidation — names are proposals]*: device hardware revisions / firmware versions, protocols, network technologies, compatibility records with verification status and last-tested date, supported configuration commands, device activation status history, device inventory (serial, supplier, purchase date, warranty), suppliers, technicians, installation jobs with status history, installation test results, device maintenance records, plan entitlements/limits (pricing dimensions), country settings (tax, formats, providers), notification rules.

Review relationships and identify any further entities needed.

Requirements:

- UUID primary keys where appropriate.
- Tenant identifiers on tenant-owned records.
- Proper foreign keys, appropriate indexes, timestamps.
- Soft deletion where justified.
- Preserve historical device assignments, financial records and security audit logs.

### 10.2 GPS data architecture and scalability

The platform must eventually support thousands of vehicles transmitting continuously (tens of thousands of vehicles across thousands of customers). Consider:

- Efficient GPS position ingestion.
- WebSocket-based live tracking and connection management.
- Redis caching.
- Background processing.
- Database indexing.
- Historical GPS data retention policies.
- Database partitioning (PostgreSQL partitioning or TimescaleDB if justified).
- Efficient trip calculations.
- Geofence event processing.
- Device communication monitoring.

Rules:

- Do not blindly store every GPS update in the main transactional tables.
- Traccar retains its own position database. **Evaluate** whether our application needs a full copy of positions or only selected data and aggregates, **before** implementing any large-scale duplication. Avoid unnecessary duplication.

---

## 11. API design

Clean, versioned REST API. Base path: **`/api/v1`**. Document every endpoint in Swagger/OpenAPI. Apply validation, authorization, pagination, filtering and consistent error handling.

| Area | Endpoints |
|---|---|
| **Authentication** | `POST /auth/register` · `POST /auth/login` · `POST /auth/logout` · `POST /auth/forgot-password` · `POST /auth/reset-password` · `GET /auth/me` |
| **Organizations** | `GET /organizations` · `POST /organizations` · `GET /organizations/:id` · `PATCH /organizations/:id` |
| **Vehicles** | `GET /vehicles` · `POST /vehicles` · `GET /vehicles/:id` · `PATCH /vehicles/:id` · `DELETE /vehicles/:id` |
| **GPS devices** | `GET /devices` · `POST /devices` · `GET /devices/:id` · `PATCH /devices/:id` · `POST /devices/:id/assign` · `POST /devices/:id/unassign` |
| **Tracking** | `GET /tracking/positions` · `GET /tracking/vehicles/:id/location` · `GET /tracking/vehicles/:id/history` · `GET /tracking/vehicles/:id/trips` |
| **Geofencing** | `GET /geofences` · `POST /geofences` · `PATCH /geofences/:id` · `DELETE /geofences/:id` |
| **Security** | `POST /vehicles/:id/immobilize` · `POST /vehicles/:id/restore` · `GET /vehicles/:id/security-history` |
| **Reports** | `GET /reports/fleet-summary` · `GET /reports/distance` · `GET /reports/trips` · `GET /reports/overspeeding` · `GET /reports/vehicle-utilization` |
| **Subscriptions** | `GET /subscriptions` · `POST /subscriptions` · `GET /subscriptions/:id` · `POST /subscriptions/:id/upgrade` — these refer to the **provider's** subscription with the platform |

*[Added in consolidation — proposals required by extension-brief features; finalise in `docs/API_DESIGN.md`]*

| Area | Proposed endpoints |
|---|---|
| **Security commands** | `GET /vehicles/:id/security-commands/:commandId` (status) · `POST /vehicles/:id/security-commands/:commandId/cancel` |
| **Device capabilities** | `GET /devices/:id/capabilities` (customer-visible effective capabilities) |
| **Device catalogue (platform admin)** | `GET/POST /admin/device-catalogue/manufacturers` · `GET/POST/PATCH /admin/device-catalogue/models` · `POST /admin/device-catalogue/models/:id/verifications` |
| **Onboarding** | `POST /onboarding/devices` (start) · `GET /onboarding/devices/:id` (activation status) · `POST /onboarding/devices/:id/verify-signal` |
| **Diagnostics (technical admin)** | `GET /admin/devices/:id/diagnostics` |
| **Inventory and installations** | `GET/POST /admin/inventory/devices` · `GET/POST /installations` · `PATCH /installations/:id/status` · `POST /installations/:id/test-results` |
| **Notifications** | `GET /notifications` · `PATCH /notifications/:id/read` · `GET/PUT /notification-preferences` · `GET/POST/PATCH/DELETE /alert-rules` |
| **Payments** | `POST /payments` (initiate) · `POST /webhooks/payments/:paymentGateway` (verified webhook) · `GET /invoices` · `GET /billing/usage` (active devices for a period) |
| **Provider onboarding** *(1.1)* | `POST /providers/register` (public) · `GET /admin/providers` · `POST /admin/providers/:id/approve` · `POST /admin/providers/:id/reject` · `POST /admin/providers/:id/suspend` |
| **Provider console** *(1.1)* | `GET/POST /provider/customers` · `GET/PATCH /provider/customers/:id` · `POST /provider/customers/:id/suspend` · `POST /provider/customers/:id/invitations` · `PUT /provider/customers/:id/entitlements` · `POST /provider/devices/import` (CSV, validated, idempotent) · `GET/PUT /provider/branding` · `GET/POST /provider/staff` |
| **Speed governors** *(1.2)* | `GET/POST /provider/governor-installations` · `PATCH /provider/governor-installations/:id` · `POST /provider/governor-installations/:id/inspections` · `GET /governor/violations` (customer and provider) · `GET /provider/compliance-reports?quarter=` · `POST /provider/compliance-reports/:quarter/generate` · `GET /provider/regulator-outbox` |
| **Regulator portal** *(1.2)* | `GET /regulator/vehicles` · `GET /regulator/vehicles/:id` · `GET /regulator/violations` · `GET /regulator/tamper-events` · `GET /regulator/compliance-reports` — read-only, scoped by `regulator_access_grants`, every call audited |
| **Branding (public)** *(1.1)* | `GET /branding/resolve?host=…` or `?slug=…` — returns logo/colours/name for the login page, no authentication, no sensitive data |

Note: the word "provider" is reserved for GPS tracking providers. External services (payments, SMS, maps) are called **gateways** or **integrations** in routes and code to avoid confusion (see the `gps-external-integrations` skill).

---

## 12. UI/UX design requirements

This is a commercial product. The interface must look like a mature international SaaS fleet management platform — not a basic administration template or generic dashboard template.

Study the design quality and usability of **Samsara, Wialon, Geotab and Traccar** as references for functionality and usability — **not** as interfaces to copy.

**Design direction:** modern, professional, clean, enterprise-oriented, responsive, intuitive, information-rich without clutter, excellent map experience, consistent typography, carefully designed spacing, clear visual hierarchy.

**Avoid:** excessive gradients, excessive rounded cards, oversized headings, unnecessary animations, too many colors, generic dashboard layouts, fake charts, decorative elements that reduce usability.

**Priorities** (extension brief): live vehicle visibility, vehicle status, fleet utilization, security alerts, trip information, device health, operational performance.

**Three interfaces** (one React app, separate shells, routes and navigation):

1. **Customer app** — under the provider's brand.
2. **Provider console** — under the provider's brand, with the provider's own navigation.
3. **Platform admin** — under the platform's brand, visibly marked as internal.
4. **Regulator portal** *(rev. 1.2)* — read-only, platform-branded, for RURA: governed vehicles, violations, tamper events, inspections, connectivity and quarterly reports, filtered by provider. No editing, no commands.

The provider console gains a **COMPLIANCE** group for governor suppliers: Governed Vehicles · Installations & Inspections · Violations · Tamper Events · Quarterly Reports · Regulator Deliveries.

**Customer app navigation (suggested sidebar):**

```
OVERVIEW      Dashboard · Live Tracking
FLEET         Vehicles · Drivers · GPS Devices · Trips · Geofences
SECURITY      Alerts · Vehicle Security · Immobilization History
ANALYTICS     Reports · Fleet Performance
SETTINGS      Organization · Users & Permissions · Notifications · Integrations
HELP          Contact <provider name> (phone, email, WhatsApp)
```

(The base brief's BUSINESS group — Subscription · Billing · Invoices — moves to the provider console, because end customers do not pay the platform.)

**Provider console navigation** *[Added in revision 1.1 — proposal]*:

```
OVERVIEW      Dashboard · Live Map (all customers)
CUSTOMERS     Customers · Users & Invitations · Customer Limits
DEVICES       Devices · Import · Onboarding Queue · Diagnostics · Device Catalogue
FIELD         Installations · Technicians · Stock
SUPPORT       Alerts by Customer · Security Commands · Support Requests
BUSINESS      Usage · Plan · Invoices · Payments
SETTINGS      Branding · Staff & Permissions · Notifications · API (later)
```

**Platform administration navigation** must be **distinct** from the other interfaces (extension brief). *[Proposal]*: Providers (approvals, accounts) · End Customers (search, support) · Device Catalogue · Device Diagnostics · Plans & Pricing · Usage & Invoices · Payments · Support Requests · Audit Log · Platform Settings (countries, currencies, gateways).

**Branding resolution** *[Proposal]*: in the first release each provider gets a login address on the platform's domain (e.g. `<provider-slug>.<platform-domain>` with a wildcard certificate, or `<platform-domain>/p/<slug>`). The login page loads the provider's branding from that address; after login, branding follows the user's organization. The platform's main domain shows the platform's brand (for provider sign-up and platform staff). Provider-owned custom domains come later.

Show menu items based on permissions. Design clear workflows for both customers and technical administrators.

**Live tracking page** (particular design attention): map as the primary working area; vehicle list panel; search and filters; vehicle information panel; status indicators; real-time updates; efficient use of screen space.

The interface must work on **desktop, tablet and mobile**.

---

## 13. Security requirements

The platform handles vehicle locations and remote vehicle-control functionality; security is essential.

Implement:

- Secure password hashing; authentication; secure session management.
- Role-based authorization; tenant isolation.
- API rate limiting; input validation; SQL injection protection.
- Secure HTTP headers; CORS configuration; HTTPS.
- Audit logging; secrets management.
- Database backups; error monitoring.

Additional rules:

- Never expose GPS server credentials to the frontend.
- Never expose payment secrets (anywhere outside the server's secure configuration).
- Never trust client-provided tenant identifiers or frontend authorization.
- Verify payment webhooks.
- Validate GPS command permissions.
- Log all security-sensitive actions.
- Protect vehicle location data.
- Never log passwords, tokens or sensitive credentials.
- Do not hardcode API credentials; use environment variables and secure configuration.
- Do not sacrifice security for convenience (Rule 11).
- Design location-data access, retention, permissions and customer consent with Rwanda's data protection law and future markets' privacy requirements in mind.
- Provider staff access to an end customer's location history, live view and security commands is permission-checked and audit-logged; end-customer owners can see an access log of provider and platform staff actions on their account.
- Provider branding assets (logos) are validated (type, size, no SVG scripts) and served from a safe origin.
- A provider's suspension must never expose its customers' data to anyone else, and never silently delete data.

---

## 14. External integrations

Each integration is a module with a clear provider abstraction, independently configurable, with credentials only in environment variables / secure configuration.

| Category | Integrations |
|---|---|
| **GPS** | Traccar REST API, Traccar WebSocket |
| **Maps** | Prototype: MapLibre GL JS + OpenFreeMap (no key; no satellite; no reverse geocoding — show coordinates). Production: Mapbox GL JS + Mapbox Geocoding, or an alternative vendor, decided in M11 |
| **Regulator** *(rev. 1.2)* | RURA speed-governor data transmission (violations in real time; Annex A format). Interface unknown: build an outbox with a clearly labelled development adapter until RURA provides the specification (B13) |
| **Payments** | MTN Mobile Money, Flutterwave, future international providers |
| **Notifications** | Email provider, SMS provider, WhatsApp Business Platform |

- When an integration is not yet configured, provide a **clearly identified development adapter** (Rule 4).
- If an external service is unavailable, the rest of the application must remain operational wherever possible.

---

## 15. Performance and scalability

Design for growth to thousands of customers and tens of thousands of vehicles. Consider: efficient GPS update processing, WebSocket connection management, Redis caching, background jobs, database indexing, GPS position retention policies, API pagination, map marker clustering, event processing, notification queues, monitoring, horizontal scaling.

Do not introduce complex infrastructure unnecessarily. Build a reliable foundation that can grow.

---

## 16. Testing requirements

Implement:

- Unit tests; backend integration tests; API tests; frontend component tests.
- Authentication tests; tenant isolation tests; permission tests.
- GPS integration tests (against a real Traccar instance fed by the simulator).
- Payment webhook tests.
- Vehicle security workflow tests.
- Simulator scenario tests (§9).

Write meaningful tests (Rule 8). Do not claim a feature is complete until it has been implemented and tested.

---

## 17. Development strategy

### 17.1 Principles

- Do not attempt to implement the entire platform in one uncontrolled operation. Work in structured stages.
- Do not spend excessive time building attractive dashboards before a working GPS integration exists.
- Every stage must deliver **working functionality and tests** before proceeding.
- Do not move to the next stage until the current one is implemented, tested and documented.

### 17.2 Per-module implementation approach (apply to every module)

1. Understand its business purpose.
2. Define its workflows.
3. Identify its dependencies.
4. Design its database entities.
5. Define its API endpoints.
6. Define its authorization requirements.
7. Identify failure scenarios.
8. Implement backend functionality.
9. Implement the frontend.
10. Test the complete workflow.
11. Document the implementation.

Do not create frontend screens that are disconnected from working backend functionality.

### 17.3 Phase 0 — Project analysis and architecture (before writing code)

1. Inspect the existing repository.
2. Identify existing technologies.
3. Identify existing functionality.
4. Check whether the repository already contains an application.
5. Identify missing dependencies.
6. Prepare the system architecture.
7. Prepare the database design.
8. Prepare the module structure.
9. Identify technical risks.
10. Prepare the implementation roadmap.

If the repository already contains a project, preserve useful existing functionality; do not overwrite working code unnecessarily.

Create:

- `README.md`
- `CLAUDE.md`
- `docs/ARCHITECTURE.md`
- `docs/DATABASE_DESIGN.md`
- `docs/API_DESIGN.md`
- `docs/DEVELOPMENT_ROADMAP.md`
- `docs/GPS_INTEGRATION.md`
- *[Added in consolidation]* `docs/DEVICE_COMPATIBILITY.md`, `docs/SIMULATOR.md`, `docs/VEHICLE_SECURITY.md`, `docs/OPEN_QUESTIONS.md`, `docs/adr/` (architecture decision records)

### 17.4 Milestones (authoritative sequence — from the extension brief, enriched with the base brief's phase contents)

| # | Milestone | Scope | Working deliverable |
|---|---|---|---|
| **M1** | Foundation and provider hierarchy | Frontend and backend projects; PostgreSQL + Prisma; initial migrations; authentication (login, logout, password recovery, email verification, sessions, invitations); **three-level tenancy (platform → provider → end customer)**; provider self-registration and platform approval; provider staff; provider creates end customers and invites their users; roles and permissions for all three levels; basic provider branding on login and app shell (logo, colours); tenant isolation foundation; Docker development environment | A provider registers and is approved, creates two customers and invites their users; each sees only its own data; another provider sees nothing of the first; isolation and permission tests pass |
| **M2** | Traccar integration and GPS device registration | Traccar in Docker; Traccar client service (REST + auth handling); device registration by a provider (single + CSV import) and synchronization; global IMEI uniqueness; minimal vehicle record for a customer and device assignment; position retrieval; Traccar WebSocket integration; GPS event processing; basic simulated device | The application retrieves GPS positions from Traccar for a device registered by a provider |
| **M3a** | GPS simulator and ingestion pipeline — correctness *(split 2 Nov 2026)* | Full scenario simulator (§9); normalization, validation, out-of-order/delayed/invalid/implausible handling; latest-state cache held by the ingestion leader with guarded batched writes; vehicle status derivation; offline sweeper; authenticated Socket.IO fan-out; alerts; GPS data storage strategy (ADR marked "pending M3b"); steady-traffic smoke test (50 devices, 10 s, 2 min) added to the done-check | Every §9 scenario runs repeatably through the real pipeline with automated assertions; smoke test passes |
| *(M3b)* | *Scale proof — moved into M11* | 200 positions/s load test, report-latency and RLS benchmarks, on a quiet Linux host with the load generator on a separate machine | *See M11* |
| **M4** | Live tracking map | Live tracking page for end customers and the all-customers live map for providers; **MapLibre GL JS with OpenFreeMap styles for the prototype** (no key, no cost), map setup isolated in one module so production can switch to Mapbox; markers and clustering; status; real-time updates; selection; search/filter (incl. by customer for providers); info panel | A vehicle moves on the map as new coordinates arrive; its customer and its provider see it; other customers and other providers cannot (completes Success Milestone 1, §20) |
| **M5** | Vehicle management, catalogue, device onboarding, provider console | Full vehicle management (incl. vehicle use class: private, public passenger, goods); device management and reassignment history; driver management; vehicle categories; device compatibility and certification catalogue (shared, platform-managed) **including the device type "speed governor / speed limiter" and high-frequency (≤ 5 s) reporting**; provider device onboarding workflow and activation statuses; onboarding queue; diagnostics tools; provider dashboard and customer dashboard on real data; per-customer limits set by the provider | A provider onboards a (simulated or real) device end-to-end for a customer; the customer sees its effective capabilities |
| **M6** | Trips, playback, geofencing | Historical tracking; route playback; trip reports; geofence creation; enter/exit/dwell events; notification rules on geofences | Users replay a trip and receive geofence events from simulator scenarios |
| **M7** | Vehicle security and safe immobilization | Device capability detection and gating; vehicle security dashboard; command authorization; immobilization and restoration workflows; safety verification; acknowledgement and execution tracking; expiry/cancellation; audit history; emergency procedures; controlled test device | The full command workflow is tested (automated + bench/controlled test device); no live engine shutdown exists anywhere |
| **M8** | Notifications, reports, analytics | In-app and email notifications; SMS and WhatsApp abstractions; all reports; PDF, Excel, CSV exports; Recharts visualizations | Alerts reach users through configured channels; reports export correctly from real data |
| **M9** | Speed governor compliance *(added 4 Nov 2026 — Module 18)* | Governor installation records (set speed, RURA sticker, seal, calibration, warranty, 6-monthly inspections with reminders); ≤ 5 s speed records retained and retrievable; violation and tamper detection with real-time alarms to the provider; automated SMS to the customer on device offline and other changes; quarterly online/offline report per provider; read-only **Regulator portal** for RURA; regulator transmission outbox with a clearly labelled development adapter until RURA's interface and Annex A format are obtained; compliance pack (hosting, backups, DR, QoS, access logging) for providers' RURA applications; simulator governor scenarios | A simulated governed bus exceeds its set speed: the violation reaches the provider alarm, the customer SMS and the regulator outbox within the target time; a disconnection produces a tamper/offline event; the quarterly report reproduces online/offline periods exactly; the regulator sees only enrolled governed vehicles |
| **M10** | Installations, provider billing, platform administration | Provider inventory and installation management with verification; provider plans and entitlements (incl. speed-governor add-on); active-device usage metering with explainable statements; payment integration (MTN MoMo / Flutterwave sandbox) with verified webhooks and reconciliation; invoices; payment reminders; grace period and suspension; provider management in platform admin; customer transfer between providers | A provider's monthly invoice matches its active devices, is paid through a payment sandbox, and late payment leads to the documented grace/suspension behaviour without data loss |
| **M11** | Scale proof and production launch | **M3b scale proof** (load ≥ 200 positions/s — the rate of about 1,000 governed vehicles reporting every 5 s — report latency, RLS benchmark; confirm or amend the two ADRs) on a production-like Linux host; production map source chosen (Mapbox or alternative); production Docker; Nginx; SSL; logging; monitoring; backups with tested restore; hosting in Rwanda (B1, Module 18); security review and testing; deployment documentation; commercial launch | Platform deployed to production with documented runbooks and measured capacity; **Success Milestone 2** (physical tracker in a real vehicle) achieved if not earlier |

Appendix A.2 shows how the base brief's Phases 1–9 map onto the milestones. **Ordering note:** M9 depends on SMS and reports (M8). If a speed-governor supplier becomes the first committed customer, M9 may move ahead of M7, bringing the SMS gateway and the quarterly report with it; record the change in `docs/DEVELOPMENT_ROADMAP.md`.

---

## 18. Development rules

1. **Think before coding.** Understand the requirements and existing architecture.
2. **No disconnected functionality.** Do not generate an entire application with incomplete or disconnected parts; build working modules incrementally. No frontend screens without working backend functionality.
3. **Real integrations.** Use real integrations where possible. Never replace actual GPS functionality with static mock data and claim live tracking works.
4. **Development adapters.** When an external integration is not yet configured, provide a clearly identified development adapter.
5. **Maintainable code.** Write reusable code; avoid duplicated business logic.
6. **TypeScript best practices.** Avoid unnecessary use of `any`.
7. **Migrations.** Use proper database migrations. Never manually modify the production database schema.
8. **Meaningful tests.**
9. **Document decisions.** Document important technical decisions, and update documentation whenever architectural decisions change. For any decision that could materially affect the architecture, explain the alternatives and recommend the most appropriate solution.
10. **No unexplained TODOs** for critical functionality.
11. **Security over convenience.**
12. **No capability assumptions.** Do not assume a GPS device supports a feature because another model from the same manufacturer does.
13. **Working deliverable per stage.**
14. **After each stage:** run tests; check TypeScript errors; check linting; verify database migrations; verify integration functionality; update documentation; report completed work; identify remaining work.
15. **Honest completion.** Do not claim a feature is complete until it has been implemented and tested. *(extension brief)*
16. **Flag uncertainty.** Where hardware capabilities, protocols, provider pricing or regulatory requirements are uncertain, identify the uncertainty and recommend verification rather than assuming. *(extension brief)*
17. **Keep it simple.** Modular monolith, clean module separation, no unnecessary microservices or infrastructure. *(both briefs)*

---

## 19. First task — what to do now

Do not start coding random components. Act as the solution architect first:

1. Inspect the existing project repository.
2. Produce a detailed architectural analysis.
3. Explain how the React frontend, NestJS backend, PostgreSQL, Redis and Traccar will interact.
4. Design the initial database schema (including the extension-brief entities in §10.1).
5. Define the main modules and their dependencies.
6. Define the initial API architecture.
7. Identify all external services and integrations.
8. Identify technical, operational and security risks.
9. Propose the directory structure for the project.
10. Prepare a detailed development roadmap with deliverables (aligned with §17.4).
11. Identify the hardware required for the first real GPS test.
12. Identify which Traccar features and commands are supported by the selected test hardware.
13. Define how live GPS tracking will be tested without initially depending on physical hardware (§9).
14. Define the secure and safe architecture for remote vehicle immobilization (Module 12).
15. *(Revision 1.1)* Design the three-level tenancy (platform → provider → end customer), provider onboarding and approval, branding resolution, and active-device billing measurement; record each as an ADR.

After presenting the architectural analysis, **begin Milestone 1**. Do not stop after writing documentation. Do not move to the next milestone until the current one has been implemented, tested and documented.

---

## 20. Definition of success

**Success Milestone 1** (reached at the end of M4; adapted to the provider model):

1. A GPS provider can register, and a platform admin can approve it.
2. The provider can log in and create an end-customer organization, and the customer's user can accept an invitation and log in under the provider's branding.
3. The provider can register a vehicle for that customer.
4. The provider can register a GPS device.
5. A GPS device can be connected through Traccar.
6. Our backend can retrieve its location.
7. Our frontend can display the vehicle on the map (MapLibre in the prototype) — for the end customer and in the provider's all-customers map.
8. The vehicle position updates automatically.
9. Another end customer of the same provider, and any other provider, cannot access that vehicle's data.

**Success Milestone 2:** a physical GPS tracker installed in a real vehicle **by a real provider** sends its coordinates to our server and the vehicle appears in the provider's console and in its customer's app. *(Can be attempted as soon as M4 is complete and test hardware is available; it is required before M7's controlled-device testing.)*

**Success Milestone 3 — speed governors** *(rev. 1.2, end of M9; then with real hardware)*: a governed vehicle of a RURA-authorised supplier reports speed at least every 5 seconds; a violation raises the provider alarm, reaches the regulator outbox (or RURA itself once the interface exists) and appears in the Regulator portal; an offline period triggers the customer SMS and appears correctly in the quarterly report.

**Long-term objective:** a fully operational commercial GPS tracking and fleet management SaaS platform that can be deployed, sold, maintained and expanded internationally.

---

## 21. Final instruction and priorities

Approach this project as a commercial product that will compete with established international GPS tracking and fleet management platforms. Prioritise:

1. Architectural quality.
2. GPS integration reliability and real hardware compatibility.
3. Security and data security.
4. Excellent user experience.
5. Data accuracy.
6. Multi-tenant isolation.
7. Maintainability.
8. Scalability.
9. Commercial readiness, customer trust, operational reliability and a sustainable business model.

Do not build merely to demonstrate functionality.

**Begin with project analysis and architecture.**

---

## Appendix A — Reconciliation notes

### A.1 Module renumbering

| Base brief | This document |
|---|---|
| Module 1 Authentication | Module 1 |
| Module 2 Dashboard | Module 2 |
| Module 3 Live tracking | Module 3 |
| Module 4 Vehicle management | Module 4 |
| Module 5 GPS device management | Module 5 |
| — (extension §1) | **Module 6** Device compatibility and certification |
| — (extension §2) | **Module 7** Device onboarding and activation |
| — (extension §7) | **Module 8** Inventory and installation management |
| Module 6 Trip history | Module 9 |
| Module 7 Geofencing | Module 10 |
| Module 8 Alerts and notifications | Module 11 |
| Module 9 Immobilization | Module 12 (merged with extension §4) |
| Module 10 Drivers | Module 13 |
| Module 11 Reporting | Module 14 |
| Module 12 Subscription and billing | Module 15 (+ pricing dimensions, extension §6) |
| Module 13 Customer management | Module 16 (now Provider management — rev. 1.1) |
| Module 14 Reseller management | Module 17 (now Provider console and branding, a core module — rev. 1.1) |

### A.2 Phases (base brief) → Milestones (extension brief)

| Base brief phase | Milestone(s) | Note |
|---|---|---|
| Phase 0 Analysis | Phase 0 | Kept — the extension brief has no equivalent and does not remove it |
| Phase 1 Foundation | M1 | Same scope |
| Phase 2 Traccar integration | M2 + M3a (M3b in M11) | The extension brief splits out the simulator and ingestion pipeline as its own milestone; split again on 2 Nov 2026 |
| Phase 3 Live tracking | M4 | Same scope |
| Phase 4 Vehicle and fleet management | M5 (+ minimal vehicle/device in M2) | M5 adds the catalogue and onboarding |
| Phase 5 Trips and geofencing | M6 | Same scope |
| Phase 6 Security and immobilization | M7 | Same scope |
| Phase 7 Notifications and reports | M8 | Same scope |
| Phase 8 Commercial features | M10 | Adds installation management |
| Phase 9 Production readiness | M11 | Adds the M3b scale proof, security testing and commercial launch |
| — | M9 | Speed governor compliance (added 4 Nov 2026; not in either brief) |

### A.3 Conflicts and how they were resolved

1. **Phase plan vs milestone sequence.** The base brief defines Phases 0–9; the extension brief defines Milestones 1–10 and says to "prioritize" them. *Resolution:* milestones are authoritative; Phase 0 is retained in front of M1.
2. **Success Milestone 1 vs milestone order.** Success Milestone 1 requires "an administrator can register a vehicle", but full vehicle management is M5. *Resolution:* M2 introduces a minimal vehicle record (registration number, organization) so a device can be assigned and shown on the map in M4; M5 completes vehicle management.
3. **Simulator timing.** The base brief places "development mode with simulated devices" in Phase 2; the extension brief makes the simulator its own milestone (M3). *Resolution:* one basic simulated device in M2 to prove the connection; the full scenario simulator in M3 (now M3a; scale proof M3b in M11).
4. **Device management timing.** The base brief puts device management in Phase 4; the extension brief puts device *registration* in M2 and the catalogue/onboarding in M5. *Resolution:* register-and-sync in M2; full device lifecycle, reassignment history, catalogue and onboarding in M5.
5. **Driver management and customer management** are not named in the extension brief's milestones. *Resolution:* drivers in M5 (base brief Phase 4); customer administration in M10 (base brief Phase 8).
6. **Main dashboard timing.** The base brief lists the dashboard as Module 2; the extension brief says not to build dashboards before GPS integration works. *Resolution:* M1 delivers only the application shell and empty states; the KPI dashboard is built in M5 when real data exists.
7. **Activation statuses mix lifecycle and connectivity.** "Online" and "Offline" describe connectivity while the other statuses describe onboarding lifecycle; a suspended device can still be online. *Resolution:* the user-facing list is kept exactly; internally it should be modelled as a lifecycle status plus a derived connectivity state (decide in Phase 0 / ADR).
8. **Capability lists differ.** The base brief's example JSON has 7 keys; the extension brief lists more (battery, digital inputs, network technologies, configuration commands). *Resolution:* the catalogue uses the union.
9. **GPS engine abstraction.** The base brief says Traccar is an "independent component"; the extension brief requires a GPS-engine provider abstraction. *Resolution:* both — Traccar sits behind a GPS-engine interface and Traccar-specific types do not leak outside its adapter.
10. **Command cancellation.** The base brief lists a CANCELLED state; the extension brief adds "cancellation where technically possible". No cancel endpoint existed. *Resolution:* proposed endpoint added in §11.
11. **"Fleet Performance"** appears in the base brief's sidebar but no module defines it. *Resolution:* served by Module 14 (Reporting).
12. **Distinct admin interface.** The base brief gives only the customer sidebar; the extension brief requires distinct customer and admin navigation. *Resolution:* a proposed admin navigation is added in §12.

### A.4 Owner decisions of 1 November 2026 — provider-first platform

| Decision | Effect on this spec |
|---|---|
| The platform is for **GPS tracking providers only**; we do not sell devices, installation or tracking to vehicle owners | Model A removed (§2.3); "purchase devices from us" and "request installation" removed from end-customer features; inventory/installations become provider-run (Module 8) |
| **End customers log in themselves**, created and invited by their provider | No public sign-up for end customers (Module 1); provider console creates customers and invitations (Module 17) |
| **Branding: provider logo + colours** in the first release; own domain/apps later | Branding module and resolution (Module 17, §12); custom domains designed for later |
| **The platform bills providers per active device**; providers bill their customers outside the platform | Module 15 rewritten; end-customer billing screens removed from the customer app (§12) |
| Resellers become the core | "Reseller" renamed "Provider"; three-level tenancy required from M1 (§6, §17.4); reseller roles replaced by provider roles (§7) |

Brief text that conflicts with these decisions has been rewritten in place; nothing else from the briefs was removed.

### A.5 Owner decisions of 2–4 November 2026 (revision 1.2)

| Decision | Effect on this spec |
|---|---|
| **M3 split**: correctness (M3a) completed; scale proof (M3b) postponed to before launch, on a quiet Linux host | §17.4: M3a row; M3b folded into M11 |
| **Maps**: free MapLibre + OpenFreeMap for the prototype; Mapbox (or another vendor) for production | §4, §14, M4 and M11 rows; B6 widened |
| **Speed governors** added to the roadmap | New Module 18; new milestone M9; old M9 → M10 and old M10 → M11; Regulator organization type, roles, portal and API; open questions B13–B16 |

---

## Appendix B — Open questions requiring verification

These must be verified (and recorded in `docs/OPEN_QUESTIONS.md` with outcome and date) rather than assumed.

| # | Topic | Why it matters | How to verify |
|---|---|---|---|
| B1 | **Data localisation (Rwanda Law No. 058/2021 on personal data protection and privacy).** Published legal summaries state that personal data must be stored in Rwanda unless the data controller/processor holds authorisation from the National Cyber Security Authority (NCSA), and that transfers outside Rwanda need NCSA authorisation or another legal basis. | Determines where the VPS and databases may be hosted, and whether sending location or contact data to Mapbox, email/SMS providers or payment providers outside Rwanda needs authorisation. Also affects registration as a data controller and breach-notification procedures. | Confirm with a Rwandan lawyer / the NCSA Data Protection and Privacy Office before choosing production hosting. Prefer Rwanda-hosted infrastructure until confirmed. |
| B2 | **Test hardware selection.** | Task 11 and 12; immobilization requires a device with a controllable digital output, reliable ignition input and a way to confirm output state. | Choose a candidate model, read its manufacturer documentation and the Traccar protocol page, then bench-test. Record results in the catalogue as "Tested and verified" only after testing. |
| B3 | **Traccar version and API details** (authentication method, WebSocket behaviour, command queuing for offline devices, trip/stop report settings, geofence dwell support, retention settings). | The integration must match the deployed version. | Pin the Traccar Docker image version; verify against that version's documentation and API reference; record in `docs/GPS_INTEGRATION.md`. |
| B4 | **Mobile network and SIM** (operators' 2G/3G/4G coverage and any network sunset plans; M2M/IoT SIM plans; APN settings; SMS sender ID registration). | Device choice (LTE vs 2G) and device configuration. | Confirm with MTN Rwanda and Airtel Rwanda. |
| B5 | **Payment providers** (MTN MoMo and Flutterwave API versions, webhook signing, sandbox access, fees, settlement, merchant onboarding requirements). | Module 15. | Provider documentation and merchant agreements. |
| B6 | **Production map vendor, pricing and terms** (Mapbox or alternative: map loads, satellite, geocoding volumes, rules on storing geocoding results; whether sending vehicle coordinates to a foreign geocoding service is acceptable under B1 and Module 18). | Cost model, whether trip addresses can be cached/stored, data localisation. | Vendor pricing pages and terms; decide in M11. |
| B7 | **WhatsApp Business Platform** requirements (business verification, template approval, pricing). | Module 11. | Meta documentation. |
| B8 | **Immobilizer installation standards** (vehicle warranty, insurance, any local regulation on aftermarket immobilizers). | Module 12 liability and installation procedures. | Installer partners, insurers, legal advice. |
| B9 | **Tax rules** (VAT applicability and invoice requirements, e.g. electronic billing obligations). | Module 15 invoices. | Rwanda Revenue Authority guidance / accountant. |
| B10 | **RURA licensing.** At least one Rwandan tracking company states it is licensed by RURA to provide GPS vehicle tracking and telematics services. | Determines whether the platform, each provider, or both need a licence (and which category), and whether provider approval should check a provider's licence. | Ask RURA (ICT licensing) and a lawyer; record the answer and any licence numbers to collect during provider approval. |
| B11 | **Data protection roles.** In the provider model the provider is likely the data controller for its customers' data and the platform a data processor — to be confirmed. | Contract structure (data processing agreement with each provider), registration with the NCSA data protection office, breach-notification duties, who answers data-subject requests. | Lawyer familiar with Law No. 058/2021. |
| B12 | **Migrating providers' existing devices.** Providers' trackers currently report to other platforms; moving them means changing each device's server address and port (often by SMS or a configuration tool), and some devices may be locked by the previous vendor. | Onboarding effort, bulk configuration tooling, and sales promises. | Test on each shortlisted model; collect the configuration commands per model in the catalogue. |
| B13 | **RURA speed-governor data interface.** The 2020 notice refers to an **Annex A** (record format and minimum data) that is not in the published PDF, and requires violations to reach "the Regulatory Authority storage system" in real time without saying how. | Module 18 transmission, export format and the Regulator portal scope. | Request Annex A and the transmission specification (API, protocol, credentials, test environment) from RURA's transport department; ask whether portal access alone is enough until then. |
| B14 | **Speed-governor rules still in force**: which vehicle classes must have governors and their set speeds, retention period for speed records, inspection procedure, sticker and seal rules, and whether amendments since 2020 apply. | Data model, retention, reminders and reports. | RURA and Rwanda National Police; also check the public transport bus (2021) and school bus (2023) regulations for tracking requirements. |
| B15 | **Governor hardware and protocols.** Which governor/limiter models Rwandan suppliers use, whether Traccar decodes them, and how they report set speed, limiting events, tamper and power-cut signals, and on-board data uploads. | Catalogue entries, violation and tamper detection accuracy. | Ask 2–3 authorised suppliers for their models and documentation; bench-test with Traccar; record findings in the catalogue. |
| B16 | **Draft national speed-governor standard** (WTO notification G/TBT/N/RWA/905; entry into force to be determined). | May replace the 2020 notice's requirements. | Obtain the draft from the Rwanda Standards Board or the WTO notification portal; track adoption. |

---

## Appendix C — Project skills index

The repository ships Claude Code skills in `.claude/skills/`. Each loads automatically when relevant.

| Skill | Use when |
|---|---|
| `gps-platform-workflow` | Starting any session, milestone or module; deciding where code goes |
| `gps-api-conventions` | Writing any NestJS module, endpoint, DTO, Prisma model or migration |
| `gps-tenant-isolation` | Touching any tenant-owned data, query, cache key, socket room or job |
| `gps-rbac-permissions` | Adding permissions, roles, guards, entitlements or permission-driven UI |
| `gps-traccar-integration` | Anything that talks to Traccar |
| `gps-position-pipeline` | Position ingestion, status derivation, live updates, storage/retention, alert evaluation |
| `gps-simulator` | Building or running the simulator and scenario tests |
| `gps-device-catalogue` | Device catalogue, capabilities, onboarding, activation, assignment history, inventory, installations |
| `gps-immobilization-safety` | Anything related to immobilization, restoration or vehicle commands |
| `gps-provider-model` | Anything about GPS providers: registration, approval, branding, provider console, end-customer management, active-device billing |
| `gps-external-integrations` | Payment gateways, email/SMS/WhatsApp, maps/geocoding, webhooks, regulator transmission |
| `gps-speed-governor-compliance` | Speed governors, governed vehicles, violations, tamper events, inspections, quarterly reports, Regulator portal, RURA transmission |
| `gps-fleet-ui` | Any frontend page, component, map or chart |
| `gps-done-check` | Before claiming any task, module or milestone is done |
