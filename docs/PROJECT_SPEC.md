# GPS Tracking, Fleet Management and Vehicle Security SaaS Platform
## Consolidated Project Specification

| | |
|---|---|
| **Document** | `docs/PROJECT_SPEC.md` — single source of truth for requirements |
| **Version** | 1.0 (consolidated) — 1 November 2026 |
| **Owner** | Alain Christian Majyambere |
| **Sources merged** | (1) *Base brief* — "International GPS Tracking, Fleet Management and Vehicle Security SaaS Platform"; (2) *Extension brief* — "Extend the existing project requirements…" (declared mandatory) |
| **Initial market** | Rwanda (RWF, Africa/Kigali), architected for international expansion |

---

## 0. How to read this document

1. **Every requirement from both source briefs is preserved.** Where the extension brief added to a topic, its content has been merged into the matching section of the base brief rather than appended separately, so each topic is described in one place.
2. **Where the two briefs disagreed**, the extension brief wins (it is later and declares itself mandatory). Every such case is listed in **Appendix A — Reconciliation notes**, with the resolution applied.
3. **Items marked _[Added in consolidation]_** were not in either brief. They are small, necessary connective pieces (e.g. an endpoint for command cancellation, which the extension brief requires but neither brief listed). They are proposals and can be changed in Phase 0.
4. **Uncertain facts** (hardware capabilities, protocols, provider pricing, regulation) are collected in **Appendix B — Open questions requiring verification**. Per the extension brief, these must be verified, not assumed.
5. **"Must", "never" and "do not"** are binding. "Should" and "consider" leave room for architectural judgment, which must be documented (see Rule 9).
6. Implementation guidance for Claude Code lives in the project skills under `.claude/skills/` — see **Appendix C**.

---

## 1. Role and responsibilities

Act as a senior software architect, GPS tracking systems engineer, IoT integration specialist, SaaS product strategist, database architect, UI/UX designer and senior full-stack developer.

You are responsible for designing and building a professional, commercial-grade GPS tracking and fleet management platform.

- Do not approach this as a simple CRUD application.
- Treat it as a serious commercial SaaS platform serving individual vehicle owners, transport companies, logistics businesses, organizations managing fleets, GPS installation businesses, and other GPS tracking service providers.
- Think like a company building a commercial product that must compete with established international platforms — not a developer building a demonstration project.
- The platform launches in Rwanda and will expand into other African countries and international markets.
- Your work must demonstrate professional software engineering, thoughtful architecture, excellent user experience, security, scalability and commercial awareness.
- Do not rush into coding without understanding the complete system. First establish the architecture, system requirements, development strategy and implementation plan; then develop systematically.
- Make architectural decisions that are practical, secure, maintainable and commercially viable.

---

## 2. Product vision

We are building a **GPS Tracking, Fleet Management and Vehicle Security SaaS platform**.

### 2.1 What customers can do

1. Purchase GPS tracking devices from us.
2. Request professional installation of GPS devices.
3. Register their vehicles.
4. Connect existing GPS tracking devices from supported manufacturers.
5. Monitor vehicles in real time.
6. View historical vehicle movements.
7. Replay vehicle journeys.
8. Monitor vehicle speed and ignition status.
9. Receive vehicle security alerts.
10. Create geographical boundaries (geofences).
11. Remotely immobilize compatible vehicles through an authorized and safety-controlled process (stationary starter-inhibit only — see Module 12).
12. Monitor drivers.
13. Generate fleet management reports.
14. Manage multiple vehicles under one account.
15. Manage subscriptions and payments.
16. See which capabilities their installed GPS devices actually support (from the extension brief).

### 2.2 Business models (both must coexist in the same platform)

**Model A — Direct GPS tracking service.** We purchase GPS tracking devices, sell them to customers, arrange installation and charge recurring tracking subscription fees.

**Model B — GPS tracking software service.** Customers and existing GPS tracking businesses connect their compatible GPS devices to our platform and manage them through our software ("bring your own device").

The platform must support resellers and, in a future phase, white-label customers.

### 2.3 Supported business arrangements

- Individual vehicle owners and private car owners.
- Small businesses.
- Transport and logistics companies, delivery businesses.
- Taxi and car rental businesses, bus operators.
- Large fleet operators, construction companies, organizations managing fleets.
- NGOs, government institutions and other institutions.
- GPS installation businesses.
- GPS tracking resellers and other GPS tracking service providers.
- White-label service providers (future phase).

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
| **Frontend** | React, TypeScript, Vite, Tailwind CSS, a professional component system such as shadcn/ui, React Router, TanStack Query, Zustand where appropriate, React Hook Form, Zod validation, Mapbox GL JS (maps), Recharts (analytics) |
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

**Layer 3 — Our application backend (NestJS).** Manages all commercial and application logic: customers, organizations, users, roles, permissions, vehicles, GPS device assignments, device catalogue and onboarding, installations, drivers, subscriptions, payments, notifications, reporting, vehicle security, audit logs, and API integrations.

- Traccar must remain an independent GPS processing component.
- **Never expose Traccar administrator credentials to the frontend.**
- The frontend communicates only with our NestJS API.
- NestJS must enforce tenant permissions **before** returning GPS data or executing commands.

**Layer 4 — Frontend application (React).** Provides the customer-facing platform and, separately, the platform-administration interface: live tracking dashboard, interactive maps, vehicle management, device management, trip history, vehicle security, geofencing, reports, notifications, account management, subscription management.

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
| Maps | Mapbox |
| Database | PostgreSQL |
| ORM | Prisma |
| Backend | NestJS |
| Frontend | React + TypeScript |
| Cache and queues | Redis + BullMQ |
| Deployment | Docker on Ubuntu VPS |

Keep payment and notification integrations modular so they can be introduced progressively.

---

## 6. Multi-tenant architecture (critical)

Build the platform as a multi-tenant SaaS application. Multiple independent organizations use the same application.

*Example:* Organization A — ABC Transport Ltd, 35 vehicles. Organization B — XYZ Logistics, 20 vehicles. Organization C — John, 2 vehicles. Organization D — Rwanda Tours, 12 vehicles.

Requirements:

- Strict organization-level data isolation. A customer must **never** access another organization's vehicles, devices, positions, reports, users or billing information.
- Implement tenant isolation at **both** the database and backend levels.
- Every tenant-owned business record must be associated with an organization/tenant identifier.
- Use PostgreSQL constraints and appropriate authorization controls.
- Consider PostgreSQL Row-Level Security as an additional protection where appropriate.
- Never rely exclusively on frontend filtering for tenant isolation.
- Never trust client-provided tenant identifiers.

Account types to support:

- Individual accounts.
- Business accounts.
- Fleet organizations.
- GPS tracking resellers.
- White-label organizations (future phase).

A reseller must be able to manage their own customers without accessing other resellers' information.

---

## 7. User roles and permissions

Implement role-based access control with **granular** permissions, checked in the **backend**.

| Level | Roles |
|---|---|
| **Platform** | 1. Super Administrator · 2. Operations Administrator · 3. Technical Administrator · 4. Finance Administrator · 5. Support Administrator |
| **Customer organization** | 1. Organization Owner · 2. Organization Administrator · 3. Fleet Manager · 4. Security Manager · 5. Driver · 6. Read-only Viewer |
| **Reseller** | 1. Reseller Administrator · 2. Reseller Staff |

- Example of granularity: a Fleet Manager may view vehicle locations but may not necessarily have permission to immobilize vehicles.
- Only authorized roles may execute sensitive vehicle commands.
- The customer interface and the platform administration interface must have **distinct navigation and permissions**.
- Show menu items based on permissions (cosmetic only — the backend is the authority).

---

## 8. Core system modules

> Numbering note: the base brief had 14 modules. The extension brief added three (Device Compatibility & Certification, Device Onboarding & Activation, Installation & Inventory Management). They are inserted next to Device Management so related functionality sits together. Appendix A.1 maps old numbers to new.

### Module 1 — Authentication and user management

- User registration, login, logout.
- Password recovery, email verification.
- User profile.
- Organization registration.
- Organization switching where authorized.
- Role management, permission management.
- Session management.
- Optional two-factor authentication.

### Module 2 — Main dashboard

Show, from real data:

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
- Search vehicles; filter by status; filter by organization (where the user is authorized for more than one); group vehicles; select individual vehicles.
- Automatic position updates.

Real-time:

- Use Traccar WebSocket and our NestJS WebSocket infrastructure.
- Do not continuously refresh the entire page; only update the relevant vehicle information.

Map: zooming, panning, vehicle markers, marker clustering, vehicle selection, route visualization, multiple-vehicle tracking, map layers, full-screen mode.

Markers must visually distinguish: **Moving, Parked, Idling, Offline, Alert status**.

The interface must remain usable with **hundreds or thousands** of vehicles.

### Module 4 — Vehicle management

Customers can: register vehicles, edit vehicle information, assign drivers, assign GPS devices, view vehicle history, view current location, view tracking status, view immobilizer capability, view vehicle documents, manage vehicle categories.

Vehicle fields: registration number, make, model, year, color, vehicle type, VIN (where appropriate), fuel type, assigned driver, organization, GPS device, installation date, insurance expiry, inspection expiry, notes.

### Module 5 — GPS device management

Administrators can:

- Register GPS devices; assign and unassign devices to/from vehicles.
- Identify GPS manufacturer and model; store IMEI (and other identifiers, e.g. serial number).
- Monitor connection status and last communication.
- View device information, capabilities, installation information, supported commands.
- Track device ownership.
- Manage device replacement.

Rules:

- A GPS device is **not** permanently tied to a single vehicle. Support reassignment with a complete historical record.
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

- Platform administrators manage the catalogue.
- Customers can see which capabilities their installed devices support, e.g.:
  - Live vehicle tracking: Supported
  - Ignition monitoring: Supported
  - Fuel monitoring: Not supported
  - Remote immobilization: Supported
  - Trip history: Supported
- Capabilities must be determined from **verified technical information, configuration and actual device behaviour**, not simply the manufacturer or model name (see also Rule 12).

### Module 7 — GPS device onboarding and activation *(extension brief)*

Two customer categories:

- **A.** Customers purchasing GPS devices through the platform.
- **B.** Customers bringing their own compatible GPS devices.

Onboarding workflow:

1. Customer creates an account.
2. Customer registers a vehicle.
3. Customer selects or identifies the GPS device.
4. Platform checks device compatibility.
5. Device IMEI and other identifiers are registered.
6. Device is configured to communicate with the platform's GPS infrastructure.
7. Platform verifies that the device is transmitting data.
8. Vehicle is associated with the GPS device.
9. Customer receives confirmation of successful activation.

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

### Module 8 — Device inventory and installation management *(extension brief)*

For businesses that purchase hardware and installation services, maintain:

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

Technical administrators can record installation notes and test results.

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

Testing: use a controlled test device and professional installation procedures. Do not implement live engine shutdown.

### Module 13 — Driver management

- Register drivers; assign drivers to vehicles; driver contact information.
- Driving history; driver-related events; overspeeding incidents; driver performance reports.
- Do not assume the person assigned to a vehicle is the person currently driving it.
- Support driver identification where compatible hardware is available.

### Module 14 — Reporting and analytics

Reports: daily / weekly / monthly movement, distance travelled, trip history, vehicle utilization, idle time, overspeeding, geofence violations, driver activity, device connectivity, security events, immobilization history. ("Fleet Performance" in the navigation is served by this module.)

Report features: date filters, vehicle filters, driver filters, PDF export, Excel export, CSV export. Useful visualizations with Recharts — from real data only.

### Module 15 — Subscription and billing

Configurable subscription packages (examples, not fixed): **Starter** 1–3 vehicles · **Business** 4–20 · **Professional** 21–50 · **Enterprise** custom limits.

Pricing dimensions the platform administrator can configure (extension brief):

- Number of vehicles; number of GPS devices.
- Live tracking; historical tracking period.
- Geofencing; reports and analytics; driver management.
- Security features; remote immobilization.
- API access.

**Never hardcode subscription prices or plan limits.**

Support: monthly and annual subscriptions, vehicle-based pricing, upgrades, downgrades, trial periods, expiry, grace periods, invoices, payment history, payment reminders.

Payments:

- Multiple payment providers behind an abstraction. Initial Rwanda providers to investigate: **MTN Mobile Money**, **Flutterwave**. Future international providers via the same abstraction.
- Never assume a payment succeeded from a frontend response. Verify via authenticated server-side verification and provider webhooks.

### Module 16 — Customer management (platform administration)

Platform administrators can: register customers, view organizations, manage customer accounts, view registered vehicles, view subscriptions, suspend and reactivate accounts, view payments, view customer activity, manage GPS device assignments, view support requests.

### Module 17 — GPS tracking reseller management

A reseller can: register and manage their own customers, assign GPS devices, manage customer vehicles, view subscriptions, monitor device status, manage their business branding.

- Resellers must never access another reseller's customers.
- White-label capabilities are designed now for future implementation.

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

Rules:

- The simulator must clearly identify simulated devices and simulated positions.
- **Never present simulated positions as genuine customer vehicle locations**, and never allow simulated positions to appear as real customer vehicle positions in production.
- Do not replace actual GPS functionality with static mock data and claim live tracking works (Rule 3).

---

## 10. Database and GPS data architecture

### 10.1 Database design

Design a normalized PostgreSQL schema. Initial domain model (not a requirement to create every table immediately):

`users`, `organizations`, `organization_members`, `roles`, `permissions`, `role_permissions`, `countries`, `currencies`, `vehicles`, `vehicle_categories`, `drivers`, `gps_devices`, `gps_device_models`, `gps_manufacturers`, `gps_device_capabilities`, `device_assignments`, `positions`, `trips`, `geofences`, `alerts`, `notification_preferences`, `notifications`, `immobilization_commands`, `security_events`, `subscriptions`, `subscription_plans`, `invoices`, `payments`, `payment_transactions`, `resellers`, `audit_logs`, `support_tickets`.

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
| **Subscriptions** | `GET /subscriptions` · `POST /subscriptions` · `GET /subscriptions/:id` · `POST /subscriptions/:id/upgrade` |

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
| **Payments** | `POST /payments` (initiate) · `POST /webhooks/payments/:provider` (verified webhook) · `GET /invoices` |

---

## 12. UI/UX design requirements

This is a commercial product. The interface must look like a mature international SaaS fleet management platform — not a basic administration template or generic dashboard template.

Study the design quality and usability of **Samsara, Wialon, Geotab and Traccar** as references for functionality and usability — **not** as interfaces to copy.

**Design direction:** modern, professional, clean, enterprise-oriented, responsive, intuitive, information-rich without clutter, excellent map experience, consistent typography, carefully designed spacing, clear visual hierarchy.

**Avoid:** excessive gradients, excessive rounded cards, oversized headings, unnecessary animations, too many colors, generic dashboard layouts, fake charts, decorative elements that reduce usability.

**Priorities** (extension brief): live vehicle visibility, vehicle status, fleet utilization, security alerts, trip information, device health, operational performance.

**Customer navigation (suggested sidebar):**

```
OVERVIEW      Dashboard · Live Tracking
FLEET         Vehicles · Drivers · GPS Devices · Trips · Geofences
SECURITY      Alerts · Vehicle Security · Immobilization History
ANALYTICS     Reports · Fleet Performance
BUSINESS      Subscription · Billing · Invoices
SETTINGS      Organization · Users & Permissions · Notifications · Integrations
```

**Platform administration navigation** must be **distinct** from the customer interface (extension brief). *[Added in consolidation — proposal]*: Customers · Organizations & Resellers · Device Catalogue · Inventory · Installations · Device Diagnostics · Subscriptions & Plans · Payments · Support Tickets · Audit Log · Platform Settings (countries, currencies, providers).

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

---

## 14. External integrations

Each integration is a module with a clear provider abstraction, independently configurable, with credentials only in environment variables / secure configuration.

| Category | Integrations |
|---|---|
| **GPS** | Traccar REST API, Traccar WebSocket |
| **Maps** | Mapbox GL JS, Mapbox Geocoding, optional alternative map providers |
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
| **M1** | Foundation | Frontend and backend projects; PostgreSQL + Prisma; initial migrations; authentication (register, login, logout, password recovery, email verification, sessions); organizations; users; roles and permissions; tenant isolation foundation; Docker development environment | Users can register, log in, create organizations and manage users; tenant isolation and permission tests pass |
| **M2** | Traccar integration and GPS device registration | Traccar in Docker; Traccar client service (REST + auth handling); device registration and synchronization; minimal vehicle record and device assignment; position retrieval; Traccar WebSocket integration; GPS event processing; basic simulated device | The application retrieves GPS positions from Traccar for a registered device |
| **M3** | GPS simulator and complete ingestion pipeline | Full scenario simulator (§9); normalization, validation, out-of-order/delayed/invalid handling; latest-state cache; vehicle status derivation; GPS data storage strategy decided and implemented | Every §9 scenario runs repeatably through the real pipeline with automated assertions |
| **M4** | Live tracking on Mapbox | Live tracking page; Mapbox; markers and clustering; status; real-time updates; selection; search/filter; info panel | A vehicle moves on the map as new coordinates arrive; another organization cannot see it (completes Success Milestone 1, §20) |
| **M5** | Vehicle management, compatibility catalogue, onboarding | Full vehicle management; device management and reassignment history; driver management; vehicle categories; device compatibility and certification catalogue; onboarding workflow and activation statuses; diagnostics tools; main dashboard on real data | A customer onboards a (simulated or real) device end-to-end and sees its effective capabilities |
| **M6** | Trips, playback, geofencing | Historical tracking; route playback; trip reports; geofence creation; enter/exit/dwell events; notification rules on geofences | Users replay a trip and receive geofence events from simulator scenarios |
| **M7** | Vehicle security and safe immobilization | Device capability detection and gating; vehicle security dashboard; command authorization; immobilization and restoration workflows; safety verification; acknowledgement and execution tracking; expiry/cancellation; audit history; emergency procedures; controlled test device | The full command workflow is tested (automated + bench/controlled test device); no live engine shutdown exists anywhere |
| **M8** | Notifications, reports, analytics | In-app and email notifications; SMS and WhatsApp abstractions; all reports; PDF, Excel, CSV exports; Recharts visualizations | Alerts reach users through configured channels; reports export correctly from real data |
| **M9** | Installation, subscriptions, payments, resellers | Inventory and installation management; subscription plans and entitlements; payment integration with verified webhooks; customer billing; invoices; payment reminders; customer administration; reseller architecture | A customer subscribes and pays (provider sandbox); a reseller manages only its own customers |
| **M10** | Production and launch | Production Docker; Nginx; SSL; logging; monitoring; backups; security review and testing; performance optimization; deployment documentation; commercial launch | Platform deployed to production with documented runbooks; **Success Milestone 2** (physical tracker in a real vehicle) achieved if not earlier |

Appendix A.2 shows how the base brief's Phases 1–9 map onto M1–M10.

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

After presenting the architectural analysis, **begin Milestone 1**. Do not stop after writing documentation. Do not move to the next milestone until the current one has been implemented, tested and documented.

---

## 20. Definition of success

**Success Milestone 1** (reached at the end of M4):

1. A user can register and log in.
2. A user can create an organization.
3. An administrator can register a vehicle.
4. An administrator can register a GPS device.
5. A GPS device can be connected through Traccar.
6. Our backend can retrieve its location.
7. Our frontend can display the vehicle on Mapbox.
8. The vehicle position updates automatically.
9. Another organization cannot access that vehicle's data.

**Success Milestone 2:** a physical GPS tracker installed in a real vehicle sends its coordinates to our server and the vehicle appears in our own application. *(Can be attempted as soon as M4 is complete and test hardware is available; it is required before M7's controlled-device testing.)*

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
| Module 13 Customer management | Module 16 |
| Module 14 Reseller management | Module 17 |

### A.2 Phases (base brief) → Milestones (extension brief)

| Base brief phase | Milestone(s) | Note |
|---|---|---|
| Phase 0 Analysis | Phase 0 | Kept — the extension brief has no equivalent and does not remove it |
| Phase 1 Foundation | M1 | Same scope |
| Phase 2 Traccar integration | M2 + M3 | The extension brief splits out the simulator and ingestion pipeline as its own milestone |
| Phase 3 Live tracking | M4 | Same scope |
| Phase 4 Vehicle and fleet management | M5 (+ minimal vehicle/device in M2) | M5 adds the catalogue and onboarding |
| Phase 5 Trips and geofencing | M6 | Same scope |
| Phase 6 Security and immobilization | M7 | Same scope |
| Phase 7 Notifications and reports | M8 | Same scope |
| Phase 8 Commercial features | M9 | M9 adds installation management |
| Phase 9 Production readiness | M10 | M10 adds security testing and commercial launch |

### A.3 Conflicts and how they were resolved

1. **Phase plan vs milestone sequence.** The base brief defines Phases 0–9; the extension brief defines Milestones 1–10 and says to "prioritize" them. *Resolution:* milestones are authoritative; Phase 0 is retained in front of M1.
2. **Success Milestone 1 vs milestone order.** Success Milestone 1 requires "an administrator can register a vehicle", but full vehicle management is M5. *Resolution:* M2 introduces a minimal vehicle record (registration number, organization) so a device can be assigned and shown on the map in M4; M5 completes vehicle management.
3. **Simulator timing.** The base brief places "development mode with simulated devices" in Phase 2; the extension brief makes the simulator its own milestone (M3). *Resolution:* one basic simulated device in M2 to prove the connection; the full scenario simulator in M3.
4. **Device management timing.** The base brief puts device management in Phase 4; the extension brief puts device *registration* in M2 and the catalogue/onboarding in M5. *Resolution:* register-and-sync in M2; full device lifecycle, reassignment history, catalogue and onboarding in M5.
5. **Driver management and customer management** are not named in the extension brief's milestones. *Resolution:* drivers in M5 (base brief Phase 4); customer administration in M9 (base brief Phase 8).
6. **Main dashboard timing.** The base brief lists the dashboard as Module 2; the extension brief says not to build dashboards before GPS integration works. *Resolution:* M1 delivers only the application shell and empty states; the KPI dashboard is built in M5 when real data exists.
7. **Activation statuses mix lifecycle and connectivity.** "Online" and "Offline" describe connectivity while the other statuses describe onboarding lifecycle; a suspended device can still be online. *Resolution:* the user-facing list is kept exactly; internally it should be modelled as a lifecycle status plus a derived connectivity state (decide in Phase 0 / ADR).
8. **Capability lists differ.** The base brief's example JSON has 7 keys; the extension brief lists more (battery, digital inputs, network technologies, configuration commands). *Resolution:* the catalogue uses the union.
9. **GPS engine abstraction.** The base brief says Traccar is an "independent component"; the extension brief requires a GPS-engine provider abstraction. *Resolution:* both — Traccar sits behind a GPS-engine interface and Traccar-specific types do not leak outside its adapter.
10. **Command cancellation.** The base brief lists a CANCELLED state; the extension brief adds "cancellation where technically possible". No cancel endpoint existed. *Resolution:* proposed endpoint added in §11.
11. **"Fleet Performance"** appears in the base brief's sidebar but no module defines it. *Resolution:* served by Module 14 (Reporting).
12. **Distinct admin interface.** The base brief gives only the customer sidebar; the extension brief requires distinct customer and admin navigation. *Resolution:* a proposed admin navigation is added in §12.

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
| B6 | **Mapbox pricing and terms** (map loads, geocoding volumes, rules on storing geocoding results). | Cost model and whether trip addresses can be cached/stored. | Mapbox pricing page and terms of service. |
| B7 | **WhatsApp Business Platform** requirements (business verification, template approval, pricing). | Module 11. | Meta documentation. |
| B8 | **Immobilizer installation standards** (vehicle warranty, insurance, any local regulation on aftermarket immobilizers). | Module 12 liability and installation procedures. | Installer partners, insurers, legal advice. |
| B9 | **Tax rules** (VAT applicability and invoice requirements, e.g. electronic billing obligations). | Module 15 invoices. | Rwanda Revenue Authority guidance / accountant. |

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
| `gps-provider-adapters` | Payments, email/SMS/WhatsApp, maps/geocoding, webhooks |
| `gps-fleet-ui` | Any frontend page, component, map or chart |
| `gps-done-check` | Before claiming any task, module or milestone is done |
