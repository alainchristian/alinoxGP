---
name: gps-rbac-permissions
description: Role-based access control and plan entitlements for the GPS fleet platform — the permission key catalogue, default role bundles for platform, GPS-provider and end-customer roles, NestJS guards and decorators, resource-level policies (e.g. drivers see only their vehicle, provider staff scoped to some customers), step-up auth for sensitive actions, provider-plan and per-customer entitlement checks, and permission-driven navigation. Use whenever adding an endpoint, a role, a permission, a plan-gated feature, a menu item, or any check of "who may do this".
---

# Permissions and entitlements

Two independent questions are asked for every action, and **both** must say yes:

1. **Permission** — is this *user*, in this organization, allowed? (RBAC)
2. **Entitlement** — does the *provider's plan* include the feature, and has the provider granted it to *this end customer*, within limits? (billing)

A customer's Security Manager whose provider's plan lacks remote immobilization — or whose provider has not enabled it for that customer — has the permission but not the entitlement → rejected with `FEATURE_NOT_IN_PLAN`. Keep these concepts separate in code; mixing them makes plans impossible to change without touching roles.

## 1. Permission keys

Format: `resource.action` (or `resource.sub.action`). Defined once in `packages/shared/src/permissions.ts` as a const object, imported by API guards, seeds and the web app. Examples (extend as modules are built):

| Area | Keys |
|---|---|
| Organization | `organization.read`, `organization.update`, `organization.transfer_ownership` |
| Users & roles | `users.read`, `users.invite`, `users.update`, `users.remove`, `roles.read`, `roles.manage` |
| Vehicles | `vehicles.read`, `vehicles.create`, `vehicles.update`, `vehicles.delete`, `vehicles.documents.manage` |
| Drivers | `drivers.read`, `drivers.manage` |
| Devices | `devices.read`, `devices.register`, `devices.assign`, `devices.capabilities.read` |
| Tracking | `tracking.live.view`, `tracking.history.view`, `trips.read` |
| Geofences | `geofences.read`, `geofences.manage` |
| Alerts | `alerts.read`, `alerts.acknowledge`, `alert_rules.manage` |
| Security | `security.status.view`, `security.immobilize.request`, `security.restore.request`, `security.history.view` |
| Reports | `reports.view`, `reports.export` |
| Integrations | `integrations.manage`, `api_keys.manage` |
| Provider | `provider.customers.read`, `provider.customers.manage`, `provider.customers.suspend`, `provider.customers.limits.manage`, `provider.customers.view_data` (live/history of customers, audited), `provider.devices.register`, `provider.devices.import`, `provider.devices.assign`, `provider.devices.diagnose`, `provider.inventory.manage`, `provider.installations.manage`, `provider.installations.verify`, `provider.security.enable` (enable starter-inhibit per verified vehicle), `provider.security.emergency_restore`, `provider.staff.manage`, `provider.branding.manage`, `provider.billing.read`, `provider.billing.pay`, `provider.alerts.read` |
| Platform | `platform.providers.read`, `platform.providers.approve`, `platform.providers.manage`, `platform.providers.suspend`, `platform.customers.read` (support), `platform.customers.transfer`, `platform.catalogue.manage`, `platform.devices.diagnose`, `platform.billing.manage`, `platform.plans.manage`, `platform.support.access`, `platform.security.disable`, `platform.audit.read`, `platform.settings.manage`, `platform.regulators.manage` |
| Speed governors *(rev. 1.2)* | `provider.governors.read`, `provider.governors.manage`, `provider.governors.calibrate` (record set-speed/calibration changes — authorised technicians only), `provider.governors.inspect`, `provider.compliance.reports`, `provider.compliance.regulator_outbox.read`, `customer.governors.read` |
| Regulator *(rev. 1.2)* | `regulator.read` (governed vehicles of granted providers only, audited), `regulator.users.manage` |

(End customers have no billing permissions: they do not pay the platform.)

## 2. Default role bundles (seeded; editable later via custom roles)

Roles have a `scope`: `PLATFORM`, `PROVIDER`, `CUSTOMER` or `REGULATOR`. A role can only be assigned within its scope.

**Regulator** (external, read-only — see `gps-speed-governor-compliance`): Regulator Administrator (manages its own users) · Regulator Viewer. Regulator roles can never be granted a write permission, and regulator access needs an active `regulator_access_grants` row for the provider in question.

**End-customer organization**

| Role | Default grant |
|---|---|
| Organization Owner | Everything in customer scope, incl. `organization.transfer_ownership` and viewing the access log of provider/platform staff. Exactly one owner per org (enforced). |
| Organization Administrator | Everything except ownership transfer. |
| Fleet Manager | Vehicles, drivers, devices (read/assign), live + history tracking, trips, geofences, alerts, reports. **Not** `security.immobilize.request` / `security.restore.request` (the spec's own example). |
| Security Manager | `security.*`, live tracking, alerts, vehicles read. |
| Driver | Own profile; `tracking.live.view` and `trips.read` limited by policy to vehicles currently assigned to them. |
| Read-only Viewer | `*.read` / `*.view` only; no exports unless granted. |

**Provider** (GPS tracking business — see `gps-provider-model`)

| Role | Default grant |
|---|---|
| Provider Owner | All `provider.*`, incl. billing and staff. Exactly one owner. |
| Provider Administrator | All `provider.*` except ownership transfer; billing read only unless granted `provider.billing.pay`. |
| Provider Operations/Support | Customers read/manage (no suspend), view customer data (audited), devices register/assign/diagnose, alerts, emergency restore. |
| Provider Technician | Devices register/import/assign, inventory, installations (not verify their own), diagnostics; view data only for vehicles in their open installation jobs. |
| Provider Finance | `provider.billing.*`, customers read. |

Optional **customer scope** per provider staff member (all customers, or a list) — enforced as a resource policy (see `gps-tenant-isolation`).

**Platform**: Super Administrator (all; very few people) · Operations Administrator (providers, approvals, customer transfers, device assignment support) · Technical Administrator (catalogue, diagnostics, Traccar operations, review of providers' first immobilizer installations) · Finance Administrator (plans, invoices, payments, platform billing) · Support Administrator (provider and customer read, tickets, time-boxed `platform.support.access` with a recorded reason).

Document the final matrix in `docs/ARCHITECTURE.md`; these defaults are a starting point the owner may adjust.

## 3. Enforcement

- `@RequirePermissions(P.VEHICLES_UPDATE)` on the handler + `PermissionsGuard`. Missing decorator on a protected route is a failing test (scan routes in a test).
- Effective permissions = union of the member's roles in the **active** organization, cached in Redis per membership, invalidated on role change.
- **Resource-level policies** live in the module's `policies/` and run inside the service: e.g. a Driver may read vehicle X only if an active driver assignment links them; provider staff only within their customer scope; a technician only for vehicles in their open jobs.
- `GET /auth/me` returns the user, memberships, active org, effective permission keys and entitlements — the web app uses this for navigation. UI hiding is convenience; the API is the authority.

## 4. Sensitive actions

Require all of: permission + entitlement + **step-up auth** (fresh password/TOTP ≤ 5 min) + audit log entry. Applies to: immobilize, restore, emergency restore, enabling vehicle security for a vehicle, role/permission changes, member removal, ownership transfer, billing/payment changes, API key creation, platform support access, provider approval/suspension, customer suspension, customer transfer, bulk device import.

## 5. Entitlements (two layers)

- **Provider plan** (set by the platform) defines features and limits as data (`plan_entitlements`: key, enabled, limit), e.g. `live_tracking`, `history_days`, `geofencing`, `reports`, `driver_management`, `security_features`, `remote_immobilization`, `api_access`, `max_staff_users`, `branding_level`, `max_active_devices` (if the plan caps it). Nothing is hardcoded per plan name.
- **Customer limits** (set by the provider, `customer_entitlements`) narrow the provider's plan per end customer. Effective entitlement for a customer = provider plan ∩ customer limit (min of limits, AND of flags).
- `EntitlementService.check(ctx, key)` / `assertWithinLimit(ctx, 'max_users')`; `@RequireEntitlement('geofencing')` for routes.
- Behaviour on expiry/grace period is configurable per plan (e.g. grace: full access + banner to provider staff only; after grace: provider console read-only except billing, customers see a neutral "contact your provider" page). Tracking ingestion is never silently discarded — data keeps arriving, access is restricted.
- The `history_days` entitlement bounds history queries (see `gps-position-pipeline`).

## 6. Audit

Role creation/changes, permission grants, membership changes and every denied sensitive action write to `audit_logs` (actor, org, action, target, before/after, IP, user agent, timestamp).

## 7. Tests

For each endpoint: allowed role succeeds; each disallowed default role gets 403; entitlement-off (at provider-plan level and at customer-limit level) returns `FEATURE_NOT_IN_PLAN`; Driver policy restricts to assigned vehicle; provider staff scope restricts customers; customer roles cannot reach `/provider/*` or `/admin/*` routes; step-up required where listed; a test fails if any controller route lacks a permission decorator or `@Public()`.
