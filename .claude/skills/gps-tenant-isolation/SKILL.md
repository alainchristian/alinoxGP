---
name: gps-tenant-isolation
description: Multi-tenant isolation rules for the GPS fleet platform — how organization context is resolved, how every tenant-owned table, query, Prisma call, PostgreSQL RLS policy, Redis key, Socket.IO room, BullMQ job, export file and Traccar device mapping is scoped, plus reseller hierarchy and the mandatory isolation tests. Use whenever code reads or writes vehicles, devices, positions, trips, geofences, alerts, drivers, users, reports or billing, or adds a table, endpoint, cache, socket event or background job — tenant leaks are the most damaging bug this product can have.
---

# Tenant isolation

A leak here means one company watching another company's vehicles in real time. Isolation is therefore enforced in several independent layers, so a mistake in one layer is caught by another. Do not remove a layer because another one "already covers it".

## 1. Tenant model

- `organizations.type`: `PLATFORM` | `RESELLER` | `CUSTOMER` (individuals are customer organizations with one member).
- `organizations.parentOrganizationId`: set for customers managed by a reseller.
- Users belong to organizations through `organization_members` (with role assignments). One user may belong to several organizations.
- Access rules:
  - A customer member sees only their own organization.
  - A reseller member sees their reseller org and its **direct child** customers — never siblings, never another reseller's tree.
  - Platform staff access customer data only through admin routes, with permission checks and audit entries.

## 2. Resolving the active organization

- The client may *request* an active org (e.g. header `X-Organization-Id` after an org switch). The `TenantContextGuard` must verify, from the database (cached briefly in Redis, invalidated on membership change), that the user is a member of that org — or, for resellers, that it is their direct child.
- If no valid membership: 404/403 and nothing else. Never fall back to "the org in the body".
- The resolved `TenantContext { organizationId, actingAs, userId, membershipId }` lives in request scope (AsyncLocalStorage, e.g. `nestjs-cls`) so repositories can read it without parameter threading.

## 3. Database layer

Every tenant-owned table:

- Has `organization_id uuid NOT NULL` with an FK to `organizations`.
- Has indexes that **start** with `organization_id` for its common queries (`(organization_id, created_at desc)`, `(organization_id, status)`).
- Uses tenant-scoped uniqueness: `UNIQUE (organization_id, registration_number)` — not global — except identifiers that are truly global (a device IMEI is globally unique).
- Prevents cross-tenant references with composite foreign keys: give parent tables `UNIQUE (organization_id, id)` and reference `(organization_id, vehicle_id)`, so a vehicle in org A can never point to a driver in org B, even through a bug. Add these in migration SQL.

Row-Level Security (defence in depth, enabled from M1 on core tables):

```sql
ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicles FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON vehicles
  USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
```

The `NULLIF(…, '')` matters: once a custom setting has been used on a pooled connection, `current_setting(name, true)` returns an empty string (not NULL) after the transaction ends, and `''::uuid` raises an error. With `NULLIF`, "no tenant set" simply matches no rows.

- The app connects as a role that is **not** the table owner and does not have `BYPASSRLS`. Migrations run as a separate owner role.
- Set the org per transaction: `SELECT set_config('app.current_org_id', $1, true)` as the first statement inside an interactive Prisma transaction. The tenant-scoped Prisma client (below) does this for you.
- `set_config(..., true)` is transaction-local, which is what makes it safe with connection pooling. Never use session-level `SET` with a pool.
- Platform-admin and system jobs that legitimately cross tenants use a separate, explicitly named client (`systemPrisma`) whose every use is reviewed and audited. Reseller access to children: set `app.current_org_id` to the specific child being acted on — do not write "parent can see all" policies.
- Benchmark RLS overhead in M3; keep it unless measurements show a real problem, and record the decision in an ADR.

## 4. Application layer

- Repositories use a Prisma client extension (`tenantPrisma`) that, for tenant models, injects `organizationId` into every `where`/`data` and throws if a query on a tenant model arrives without tenant context. Keep the list of tenant models in one place and add a test that fails when a new model has `organizationId` but is missing from the list.
- Look up resources by `(organizationId, id)`, never by `id` alone.
- Services never accept `organizationId` from DTOs for ordinary operations.

## 5. GPS-specific isolation

- **Traccar has no notion of our tenants that we trust.** Our DB maps `traccar_device_id → gps_device → organization`. Every position/event from Traccar is resolved through this mapping before it goes anywhere. Unmapped device IDs are dropped and counted (and surfaced to technical admins as possible onboarding issues).
- **Device reassignment changes who may see history.** History and trip queries must be bounded by `device_assignments` windows: org A may see positions from device D only for the time ranges when D was assigned to A's vehicle. A device moved to org B must not reveal B's later movements to A, and vice versa. This applies to every history, trip, report and export query.
- Live updates go to Socket.IO room `org:<organizationId>` (optionally `org:<id>:vehicle:<vehicleId>`). Authorize at handshake and on every room join; on org switch or membership revocation, leave rooms / disconnect. Never emit to a global room.

## 6. Other stores

- Redis keys always include the org: `org:{orgId}:vehicle:{vehicleId}:state`. Device-level keys (written by ingestion before tenant resolution) live under `device:{deviceId}:…` and are never served directly to clients.
- BullMQ job payloads carry `organizationId`; handlers re-establish tenant context and re-load data — do not trust snapshot data in the payload for authorization.
- Export files (PDF/XLSX/CSV) stored under `exports/{orgId}/…`, served through short-lived signed URLs after a permission check.
- Logs and error reports carry org IDs, not other tenants' data.

## 7. Mandatory tests

A shared fixture creates **Org A** and **Org B** (plus Reseller R1 with child C1, and Reseller R2 with child C2), each with users, vehicles, devices and positions.

For every endpoint that touches tenant data:

- Org B user requesting Org A resource by ID → **404**.
- List endpoints for Org B return none of Org A's records.
- Forged `X-Organization-Id` for a non-member org → rejected.
- Body containing another org's ID is ignored or rejected.

Additionally:

- RLS test: with `app.current_org_id` = A, a raw `SELECT` on `vehicles` returns no B rows; with it unset, returns zero rows.
- Socket test: B's client never receives A's position events.
- Reassignment test: device moved A→B; A's history ends at the unassignment time, B's starts at assignment.
- Reseller test: R1 sees C1, not C2; C1 cannot see R1's other children.
- Job test: a notification job for org A never resolves recipients in org B.

## 8. Checklist for a new tenant-owned table

- [ ] `organization_id NOT NULL` + FK + leading index
- [ ] Tenant-scoped unique constraints
- [ ] Composite FKs for references to other tenant tables
- [ ] RLS enabled + forced + policy (migration SQL)
- [ ] Model added to the tenant-model list of the Prisma extension
- [ ] Isolation tests added for every endpoint using it
