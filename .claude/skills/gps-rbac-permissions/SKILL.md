---
name: gps-rbac-permissions
description: Role-based access control and plan entitlements for the GPS fleet platform — the permission key catalogue, default role bundles for platform, customer-organization and reseller roles, NestJS guards and decorators, resource-level policies (e.g. drivers see only their vehicle), step-up auth for sensitive actions, subscription entitlement checks, and permission-driven navigation. Use whenever adding an endpoint, a role, a permission, a plan-gated feature, a menu item, or any check of "who may do this".
---

# Permissions and entitlements

Two independent questions are asked for every action, and **both** must say yes:

1. **Permission** — is this *user*, in this organization, allowed? (RBAC)
2. **Entitlement** — does this *organization's plan* include the feature, and is it within limits? (billing)

A Security Manager on a Starter plan without remote immobilization has the permission but not the entitlement → rejected with `FEATURE_NOT_IN_PLAN`. Keep these concepts separate in code; mixing them makes plans impossible to change without touching roles.

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
| Billing | `billing.read`, `billing.manage` |
| Integrations | `integrations.manage`, `api_keys.manage` |
| Platform | `platform.customers.read`, `platform.customers.manage`, `platform.customers.suspend`, `platform.catalogue.manage`, `platform.inventory.manage`, `platform.installations.manage`, `platform.devices.diagnose`, `platform.billing.manage`, `platform.plans.manage`, `platform.support.access`, `platform.audit.read`, `platform.settings.manage` |
| Reseller | `reseller.customers.read`, `reseller.customers.manage`, `reseller.devices.assign`, `reseller.branding.manage` |

## 2. Default role bundles (seeded; editable later via custom roles)

Roles have a `scope`: `PLATFORM`, `ORGANIZATION` or `RESELLER`. A role can only be assigned within its scope.

**Customer organization**

| Role | Default grant |
|---|---|
| Organization Owner | Everything in organization scope, incl. `billing.manage`, `organization.transfer_ownership`. Exactly one owner per org (enforced). |
| Organization Administrator | Everything except ownership transfer; billing read only unless the owner grants `billing.manage`. |
| Fleet Manager | Vehicles, drivers, devices (read/assign), live + history tracking, trips, geofences, alerts, reports. **Not** `security.immobilize.request` / `security.restore.request` (the spec's own example). |
| Security Manager | `security.*`, live tracking, alerts, vehicles read. |
| Driver | Own profile; `tracking.live.view` and `trips.read` limited by policy to vehicles currently assigned to them. |
| Read-only Viewer | `*.read` / `*.view` only; no exports unless granted. |

**Platform**: Super Administrator (all; very few people) · Operations Administrator (customers, inventory, installations, device assignment) · Technical Administrator (catalogue, diagnostics, Traccar operations, installation verification) · Finance Administrator (plans, invoices, payments, platform billing) · Support Administrator (customer read, tickets, time-boxed `platform.support.access` with a recorded reason).

**Reseller**: Reseller Administrator (manage own customers, assign own devices, branding, view subscriptions) · Reseller Staff (read + limited device/vehicle operations for own customers).

Document the final matrix in `docs/ARCHITECTURE.md`; these defaults are a starting point the owner may adjust.

## 3. Enforcement

- `@RequirePermissions(P.VEHICLES_UPDATE)` on the handler + `PermissionsGuard`. Missing decorator on a protected route is a failing test (scan routes in a test).
- Effective permissions = union of the member's roles in the **active** organization, cached in Redis per membership, invalidated on role change.
- **Resource-level policies** live in the module's `policies/` and run inside the service: e.g. a Driver may read vehicle X only if an active driver assignment links them; reseller staff only within child orgs.
- `GET /auth/me` returns the user, memberships, active org, effective permission keys and entitlements — the web app uses this for navigation. UI hiding is convenience; the API is the authority.

## 4. Sensitive actions

Require all of: permission + entitlement + **step-up auth** (fresh password/TOTP ≤ 5 min) + audit log entry. Applies to: immobilize, restore, role/permission changes, member removal, ownership transfer, billing/payment method changes, API key creation, platform support access, customer suspension.

## 5. Entitlements

- Plans define features and limits as data (`plan_entitlements`: key, enabled, limit), e.g. `live_tracking`, `history_days`, `geofencing`, `reports`, `driver_management`, `security_features`, `remote_immobilization`, `api_access`, `max_vehicles`, `max_devices`. Nothing is hardcoded per plan name.
- `EntitlementService.check(orgId, key)` / `assertWithinLimit(orgId, 'max_vehicles')`; `@RequireEntitlement('geofencing')` for routes.
- Behaviour on expiry/grace period is configurable per plan (e.g. grace: full access + banner; after grace: read-only; tracking ingestion is never silently discarded — data keeps arriving, access is restricted).
- The `history_days` entitlement bounds history queries (see `gps-position-pipeline`).

## 6. Audit

Role creation/changes, permission grants, membership changes and every denied sensitive action write to `audit_logs` (actor, org, action, target, before/after, IP, user agent, timestamp).

## 7. Tests

For each endpoint: allowed role succeeds; each disallowed default role gets 403; entitlement-off returns `FEATURE_NOT_IN_PLAN`; Driver policy restricts to assigned vehicle; step-up required where listed; a test fails if any controller route lacks a permission decorator or `@Public()`.
