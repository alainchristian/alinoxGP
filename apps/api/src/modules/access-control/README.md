# access-control

**Purpose:** answers "may this user act in this organization, and with which permissions?" (ADR-0003, skill gps-rbac-permissions).
**Owned tables:** none (reads roles/permissions/memberships; seeded reference data lives in `prisma/seed`).
**Public API:** `AccessService.resolve(userId, orgId)` (a member, or staff of the customer's provider with permissions derived by `permissionsActingOnCustomer`, limited to their customer scope), `permissionsFor` (Redis-cached 300 s, invalidated on role/status change), `listMemberships`, `invalidate`; guards `TenantContextGuard` (sets the request tenant, 404 for non-members) and `PermissionsGuard` (fails closed when a route declares nothing).
**Endpoint:** `GET /organizations/:organizationId/roles` (`roles.read`).
**Uses the system DB role** (reviewed use #1): resolution happens before a tenant context exists.
**Permission catalogue and role bundles:** `packages/shared/src/permissions.ts`, `roles.ts`.
**Tests:** `test/permissions.e2e-spec.ts` (role matrix, escalation, cache invalidation, route inventory), `permissions.guard.spec.ts`.
