# ADR-0003: Tenant isolation — shared schema with application scoping and PostgreSQL RLS

- **Status:** Accepted for implementation (M1: enforced and tested) — **performance consequences pending M3b** (RLS + per-request transaction overhead benchmark on a separate Linux host, run before M10; moved there by the owner on 2026-11-02). The decision stands unless that benchmark shows an unacceptable cost.
- **Spec refs:** §6 (critical), §13, §10.1; skill `gps-tenant-isolation`

## Context

Many independent organizations share one deployment. A leak means one company watching another's vehicles. The spec requires isolation at **both** database and backend level, forbids trusting client-provided tenant IDs, and asks to consider PostgreSQL Row-Level Security. Resellers manage child customers; users may belong to several organizations; devices can be owned by one party and operated by another and can be reassigned between organizations over time.

## Options

1. **Application-level scoping only** (`WHERE organization_id = ?` injected by a Prisma extension). Cheapest; one missed query or raw SQL leaks everything.
2. **Shared schema + app-level scoping + PostgreSQL RLS + composite foreign keys** (defence in depth).
3. **Schema-per-tenant.** Strong separation; migrations multiply by tenant count (thousands), Prisma handles multiple schemas poorly, connection/search_path management is complex.
4. **Database-per-tenant.** Strongest isolation, highest operational cost; unrealistic at thousands of tenants, many with 1–2 vehicles.

## Decision

**Option 2.**

Database:
- Every tenant-owned table has `organization_id uuid NOT NULL` + FK, leading-column indexes, tenant-scoped unique constraints (global only for truly global identifiers, e.g. IMEI).
- Parent tables carry `UNIQUE (organization_id, id)`; children reference `(organization_id, parent_id)` via **composite FKs** so cross-tenant references are impossible even with application bugs.
- **RLS enabled and FORCED** on all tenant tables from M1, policy `organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid` for both `USING` and `WITH CHECK`. `NULLIF` is required because a pooled connection returns `''` (not NULL) for a previously-set custom setting.
- Three database roles: **owner** (runs migrations only), **app** (non-owner, no `BYPASSRLS`, used by the API), **system** (explicitly named, separate Prisma client `systemPrisma`, used only by reviewed cross-tenant jobs and platform-admin operations; every use is audited).
- Tenant is set per transaction: first statement `SELECT set_config('app.current_org_id', $1, true)` inside an interactive Prisma transaction. **Never** session-level `SET` with a pool.
- Reseller access to a child customer sets `app.current_org_id` to that specific child. No "parent can see all" policies.

Application:
- `TenantContextGuard` resolves the active organization from the authenticated user + `X-Organization-Id`, verifying membership (or direct-child relation for resellers) in the DB; context stored in AsyncLocalStorage (`nestjs-cls`).
- A Prisma client extension (`tenantPrisma`) opens the transaction, sets the org, injects `organizationId` into `where`/`data`, and **throws** when a tenant model is queried without context. A test fails if a model with `organizationId` is missing from the tenant-model list.
- Lookups use `(organizationId, id)`; other tenants' resources return **404**, never 403.

Non-standard tables (explicit policy design is part of M1):
- `users` (global identity): visible via membership join, not a simple org policy.
- `organizations`: visible if current org, or reseller→direct child.
- `gps_devices`: has `owner_organization_id` (who owns the hardware; NULL/platform = stock) **and** `current_organization_id` (denormalised, maintained in the same transaction as assignments; who is operating it). Policy allows a row if either equals the current org. History visibility is further limited by assignment windows (see DATABASE_DESIGN §device_assignments, skill §5).
- Platform-global reference data (countries, permissions catalogue, device catalogue) has no RLS; written only via platform routes.
- Append-only tables (`audit_logs`, `security_events`, `device_assignments`) additionally have UPDATE/DELETE revoked from the app role.

Other stores follow the same rule: Redis keys carry the org, Socket.IO rooms are `org:<id>`, BullMQ payloads carry `organizationId` and handlers re-establish context, exports live under `exports/<orgId>/`.

## Implementation notes (added in M1, 2026-11-01)

- Policies call `app_current_org_id()` (SQL function wrapping `NULLIF(current_setting('app.current_org_id', true), '')::uuid`). RLS is `ENABLE`d **and** `FORCE`d on `organizations`, `organization_members`, `member_roles`, `invitations`, `audit_logs`. A test fails if any table with an `organization_id` column lacks forced RLS.
- Roles: `gps_owner` (migrations only), `gps_app` (runtime, no BYPASSRLS), `gps_system` (BYPASSRLS). Created by `infra/postgres/init/01-roles.sh`.
- Instead of a Prisma query-extension that injects `organizationId`, M1 uses `TenantPrismaService.run(fn)` — an interactive transaction whose first statement sets the tenant — plus explicit `(organizationId, id)` lookups. RLS is the enforcement; the service throws without tenant context. (The extension remains an option; it adds nothing the DB policy does not already enforce.)
- `SystemPrismaService` is used only for: membership/identity resolution before a tenant exists, organization creation, invitation acceptance (token is the capability), audit writes, seeding/CLI. The list is documented on the class.
- Reseller-parent access is **read-only** in M1 (permissions filtered to `*.read` / `*.view`); write access for resellers is designed with the reseller module in M9.
- Spike result for OQ-014: Prisma 6.19.3 shows no migration drift with the raw SQL in this repo; see OPEN_QUESTIONS.md for what remains untested (partial indexes, `migrate dev` generation).
- Observed (not a benchmark): 40 concurrent tenant transactions with a 0–15 ms body completed in ~2.1 s while another test suite was hammering argon2 on the same machine. The formal RLS/pool benchmark remains an M3 task.

## Consequences

- (+) A forgotten filter returns zero rows rather than another tenant's data; composite FKs stop cross-tenant links; independent layers.
- (+) One schema, one migration run, scales to thousands of small tenants.
- (−) Every tenant query must run inside a transaction that sets the org → extra round trip(s) and pool pressure. **Benchmark in M3** (spec/skill requirement) and record the result; keep RLS unless measurements show a real problem.
- (−) Policies and composite FKs are raw SQL in migrations that Prisma does not model. **Verify in an M1 spike** that `prisma migrate dev` does not drop or fight partial indexes / composite FKs / policies (OQ-014).
- (−) Cross-tenant aggregate views (reseller dashboard across all children; platform-wide reports) cannot be a single RLS query. Initial approach: iterate child orgs with per-org context, or use reviewed `systemPrisma` queries with explicit authorisation and audit. Revisit with a `current_org_ids` array setting if a reseller aggregate becomes a hot path.
- (−) Developers and tests must always supply context; a mandatory shared Org A / Org B / Reseller fixture is part of M1's exit criteria.
- Revisit if: RLS overhead is demonstrated to be unacceptable at target load, or a large enterprise customer demands physical isolation (then offer a dedicated deployment, not a redesign).
