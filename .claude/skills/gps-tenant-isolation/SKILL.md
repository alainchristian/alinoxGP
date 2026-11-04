---
name: gps-tenant-isolation
description: Multi-tenant isolation rules for the GPS fleet platform's three-level hierarchy (platform → GPS provider → end customer) — how tenant context is resolved, how every tenant-owned table, query, Prisma call, PostgreSQL RLS policy, Redis key, Socket.IO room, BullMQ job, export file and Traccar device mapping is scoped, provider staff scopes, and the mandatory isolation tests. Use whenever code reads or writes vehicles, devices, positions, trips, geofences, alerts, drivers, users, reports or billing, or adds a table, endpoint, cache, socket event or background job — tenant leaks are the most damaging bug this product can have.
---

# Tenant isolation

A leak here means one company watching another company's vehicles in real time — or one GPS provider seeing a competitor's whole customer list. Isolation is therefore enforced in several independent layers, so a mistake in one layer is caught by another. Do not remove a layer because another one "already covers it". Business rules of the provider model are in `gps-provider-model`.

## 1. Tenant model

```
PLATFORM
└── PROVIDER (pays us)                 organizations.type = PROVIDER
    ├── CUSTOMER (end customer)        organizations.type = CUSTOMER, parentOrganizationId = provider
    └── CUSTOMER …
```

- `organizations.type`: `PLATFORM` | `PROVIDER` | `CUSTOMER` (individuals are customer organizations with one member).
- `organizations.parentOrganizationId`: the provider, for every customer.
- **Every tenant-owned row carries two columns: `organization_id` (owner: the customer, or the provider itself for provider-owned rows such as unassigned stock, installations, staff) and `provider_id` (the provider at the top of that branch).** `provider_id` is denormalized deliberately: it makes provider-wide queries (all-customers map, provider dashboards) fast and lets RLS enforce the provider boundary without recursive lookups. It changes only through the audited customer-transfer operation.
- Users belong to organizations through `organization_members` (with role assignments). One person may belong to several organizations (even customers of different providers).
- Access rules:
  - A customer member sees only their own customer organization.
  - A provider member sees the provider's own rows and **all its customers' rows** (or a subset if a staff scope is set) — never another provider's tree.
  - Platform staff access provider or customer data only through admin routes, with permission checks and audit entries.
  - A fourth level (sub-provider/agent) may come later; keep the logic in one `TenantAccessService` so it can be extended.
  - **Regulator** (`organizations.type = REGULATOR`, rev. 1.2) sits outside the provider tree. It reads only governed-vehicle compliance data of providers with an active `regulator_access_grants` row, through `/regulator/*` routes and a dedicated read-only repository. That repository filters by grant **and** by governed status. Never give the regulator `app.current_provider_id`, because that would expose the provider's whole tree, including private vehicles. Every regulator query is audit-logged and visible to the provider.

## 2. Resolving the tenant context

- The client may *request* an active org (header `X-Organization-Id` after an org switch). The `TenantContextGuard` verifies, from the database (cached briefly in Redis, invalidated on membership change), that the user is a member of that org.
- Resolved context, in request scope (AsyncLocalStorage, e.g. `nestjs-cls`):

```ts
type TenantContext =
  | { level: 'CUSTOMER'; organizationId: string; providerId: string; userId: string; membershipId: string }
  | { level: 'PROVIDER'; providerId: string; organizationId: string /* = providerId */; userId: string;
      membershipId: string; customerScope: 'ALL' | string[]; actingOnCustomerId?: string }
  | { level: 'PLATFORM'; userId: string; membershipId: string; actingOnOrganizationId?: string };
```

- Provider staff acting on one customer pass `X-Customer-Id`; the guard checks the customer belongs to that provider **and** is within the staff member's scope.
- If no valid membership/scope: 404 and nothing else. Never fall back to "the org in the body".

## 3. Database layer

Every tenant-owned table:

- Has `organization_id uuid NOT NULL` and `provider_id uuid NOT NULL`, both FKs to `organizations`, plus a CHECK/trigger ensuring `provider_id` is the provider of `organization_id`.
- Has indexes that **start** with `organization_id` for customer queries (`(organization_id, created_at desc)`, `(organization_id, status)`) and with `provider_id` where provider-wide queries need them (`(provider_id, status)`).
- Uses tenant-scoped uniqueness: `UNIQUE (organization_id, registration_number)` — not global — except identifiers that are truly global (a device IMEI is globally unique).
- Prevents cross-tenant references with composite foreign keys: give parent tables `UNIQUE (organization_id, id)` and reference `(organization_id, vehicle_id)`, so a vehicle in org A can never point to a driver in org B, even through a bug. Add these in migration SQL.

Row-Level Security (defence in depth, enabled from M1 on core tables):

```sql
ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicles FORCE ROW LEVEL SECURITY;
-- Customer level: exactly one organization. Provider level: anything under that provider.
CREATE POLICY tenant_isolation ON vehicles
  USING (
    organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid
    OR provider_id  = NULLIF(current_setting('app.current_provider_id', true), '')::uuid
  )
  WITH CHECK (
    organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid
    OR provider_id  = NULLIF(current_setting('app.current_provider_id', true), '')::uuid
  );
```

- For a **customer** request set only `app.current_org_id`. For a **provider** request set only `app.current_provider_id` (and, when acting on one customer, also narrow in the query). Never set both from untrusted input; the tenant-scoped Prisma client sets them from the resolved `TenantContext`.
- RLS enforces the provider boundary; **staff scopes** (subset of customers) are enforced in the application layer with tests.

The `NULLIF(…, '')` matters: once a custom setting has been used on a pooled connection, `current_setting(name, true)` returns an empty string (not NULL) after the transaction ends, and `''::uuid` raises an error. With `NULLIF`, "no tenant set" simply matches no rows.

- The app connects as a role that is **not** the table owner and does not have `BYPASSRLS`. Migrations run as a separate owner role.
- Set the org per transaction: `SELECT set_config('app.current_org_id', $1, true)` as the first statement inside an interactive Prisma transaction. The tenant-scoped Prisma client (below) does this for you.
- `set_config(..., true)` is transaction-local, which is what makes it safe with connection pooling. Never use session-level `SET` with a pool.
- Platform-admin and system jobs that legitimately cross providers (billing snapshots, Traccar ingestion before tenant resolution, reconciliation) use a separate, explicitly named client (`systemPrisma`) whose every use is reviewed and audited.
- Benchmark RLS overhead in M3; keep it unless measurements show a real problem, and record the decision in an ADR.

## 4. Application layer

- Repositories use a Prisma client extension (`tenantPrisma`) that, for tenant models, injects the tenant filter into every `where`/`data` — `organizationId` at customer level, `providerId` (plus the customer scope) at provider level — sets the matching RLS settings in the transaction, and throws if a query on a tenant model arrives without tenant context. Keep the list of tenant models in one place and add a test that fails when a new model has `organizationId` but is missing from the list.
- Look up resources by `(organizationId, id)` or `(providerId, id)`, never by `id` alone.
- Services never accept `organizationId` from DTOs for ordinary operations.

## 5. GPS-specific isolation

- **Traccar has no notion of our tenants that we trust.** Our DB maps `traccar_device_id → gps_device → provider (+ customer via the open assignment)`. Every position/event from Traccar is resolved through this mapping before it goes anywhere. Unmapped device IDs are dropped and counted (and surfaced to technical admins as possible onboarding issues).
- **Device reassignment changes who may see history.** History and trip queries must be bounded by `device_assignments` windows: org A may see positions from device D only for the time ranges when D was assigned to A's vehicle. A device moved to org B must not reveal B's later movements to A, and vice versa. A provider may see a device's history for the period the device belonged to that provider (all its customers' windows), and never for periods under another provider. This applies to every history, trip, report and export query.
- Live updates go to Socket.IO rooms `org:<customerId>` (end customer), `provider:<providerId>` (provider console, all customers) and optionally `org:<id>:vehicle:<vehicleId>`. Each delta is emitted to the customer room and its provider room. Scoped provider staff join per-customer rooms instead of the provider room. Authorize at handshake and on every room join; on org switch, scope change or membership revocation, leave rooms / disconnect. Never emit to a global room.

## 6. Other stores

- Redis keys always include the tenant: `org:{orgId}:vehicle:{vehicleId}:state`, `provider:{providerId}:…`. Device-level keys (written by ingestion before tenant resolution) live under `device:{deviceId}:…` and are never served directly to clients.
- BullMQ job payloads carry `organizationId`; handlers re-establish tenant context and re-load data — do not trust snapshot data in the payload for authorization.
- Export files (PDF/XLSX/CSV) stored under `exports/{orgId}/…`, served through short-lived signed URLs after a permission check.
- Logs and error reports carry org IDs, not other tenants' data.

## 7. Mandatory tests

A shared fixture creates **Provider P1 with customers C1 and C2** and **Provider P2 with customer C3**, each with users, vehicles, devices, positions and provider stock, plus a P1 staff member scoped to C1 only.

For every endpoint that touches tenant data:

- C2 user requesting a C1 resource by ID → **404** (same provider, different customer).
- C3 user (other provider) requesting a C1 resource → **404**.
- P2 staff requesting anything of P1, C1 or C2 → **404**.
- P1 staff scoped to C1 requesting C2 → **404**.
- List endpoints return none of the other tenants' records at every level.
- Forged `X-Organization-Id` / `X-Customer-Id` for a non-member or out-of-scope org → rejected.
- Body containing another org's ID is ignored or rejected.

Additionally:

- RLS test: with `app.current_org_id` = C1, a raw `SELECT` returns no C2/C3 rows; with `app.current_provider_id` = P1, returns C1 + C2 + P1 rows and no C3/P2 rows; with nothing set, returns zero rows.
- Trigger/CHECK test: inserting a row whose `provider_id` does not match its `organization_id`'s provider fails.
- Socket test: C2 never receives C1's events; P2 never receives P1's events; P1 provider room receives C1 and C2.
- Reassignment test: device moved from C1's vehicle to C2's; C1's history ends at the unassignment time, C2's starts at assignment.
- Transfer test: customer moved P1 → P2 updates `provider_id` on all its rows in one transaction; P1 loses access from that moment.
- Job test: a notification job for C1 never resolves recipients in C2 or another provider.
- Regulator test: with a grant for P1 only, the regulator sees P1's governed vehicles, gets 404 for P1's private vehicles and for everything of P2, and loses access as soon as the grant is revoked.

## 8. Checklist for a new tenant-owned table

- [ ] `organization_id NOT NULL` + `provider_id NOT NULL` + FKs + consistency CHECK/trigger + leading indexes
- [ ] Tenant-scoped unique constraints
- [ ] Composite FKs for references to other tenant tables
- [ ] RLS enabled + forced + policy (migration SQL)
- [ ] Model added to the tenant-model list of the Prisma extension
- [ ] Isolation tests added for every endpoint using it
