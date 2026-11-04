# ADR-0010 — Provider hierarchy and dual-key tenancy

Status: accepted (owner decision "retrofit first", 2026-11-04) · Amends ADR-0003 · Spec rev. 1.1/1.2 §6

## Context
ADR-0003 built tenancy for a platform → reseller → customer shape: one RLS key (`app.current_org_id`), a reseller reading one child customer at a time, read-only. The spec now says the platform is sold to GPS tracking **providers** who serve their own end customers. A provider must see all of its customers' vehicles, devices and alerts at once (all-customers map, dashboards, onboarding queue) and act for them, but never see another provider's tree. Provider staff may be scoped to a subset of customers.

## Options
1. **One key, provider acts per customer** (keep ADR-0003). Every provider-wide screen becomes N queries or a system-client bypass. Rejected: slow, and pushes cross-tenant reads onto the unrestricted client.
2. **Recursive RLS** (`organization_id IN (SELECT id FROM organizations WHERE parent = …)`). No new columns, but a sub-select on every row of every query, and the planner cannot use customer indexes well.
3. **Dual key (chosen).** Every tenant row carries `organization_id` (owner) and `provider_id` (provider at the top of the branch). RLS allows a row when `organization_id = app.current_org_id` (customer request) **or** `provider_id = app.current_provider_id` (provider request).

## Decision
- `organization_type`: `PLATFORM | PROVIDER | CUSTOMER` (`RESELLER` renamed; `REGULATOR` is added in M9). Role scopes: `PLATFORM | PROVIDER | ORGANIZATION`.
- `organizations.provider_id`: the provider of a customer, the provider itself for a provider. It changes only through the audited transfer operation (M10).
- **The database fills and checks `provider_id`.** A `BEFORE INSERT` trigger sets `provider_id` from `organization_id` when it is NULL and rejects a mismatch, so application code never supplies it and cannot forge it. (In Prisma the column is declared with a database default so it is optional on create.)
- RLS on every tenant table: `organization_id = app_current_org_id() OR provider_id = app_current_provider_id()`; `WITH CHECK` the same. `app_current_provider_id()` uses the same `NULLIF('')` rule.
- A request sets exactly one of the two settings, from the verified `TenantContext`: a customer member → `app.current_org_id`; a provider staff member working at provider level → `app.current_provider_id`. A provider staff member acting on one customer sets `app.current_org_id` to that customer (customer-level reads and writes, same code paths as customer users). Both are never set from client input.
- **Staff scopes** (a subset of customers) cannot be expressed in RLS cheaply: they are enforced by the guard (acting on a customer) and by a scope filter on provider-level queries, with tests.
- Provider staff are NOT members of customer organizations. Their access to a customer's data is written to an access log that the customer's owner can read.
- Platform staff keep the system client for admin routes (reviewed use list on `SystemPrismaService`).

## Consequences
- One migration touches every tenant table (add column, trigger, policy). Existing development data is attached to a "migrated" provider; there is no production data.
- Provider-wide queries use the `(provider_id, …)` indexes and one RLS comparison.
- Customer transfer between providers (M10) must update `provider_id` on all rows of the customer in one transaction.
- A table added later must follow the checklist in `gps-tenant-isolation` §8 (a test fails otherwise).
