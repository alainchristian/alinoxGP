# organizations

**Purpose:** customer organizations, their members, invitations and role assignment.
**Owned tables:** `organizations`, `organization_members`, `member_roles`, `invitations` (RLS enforced + forced).
**Public service:** `OrganizationsService.createForUser` (used by registration), `getById`, `update`, `listForUser`; `MembersService` (tenant-scoped list/invite/update/remove); `InvitationsService` (token-based lookup and acceptance, system DB role — reviewed use).
**Rules enforced:** a role may only be granted if its scope matches the organization type and the granter already holds all its permissions; `ORG_OWNER` is never assignable via API (one owner, DB-enforced); the owner and yourself cannot be modified; role/status changes and removals need step-up; changes invalidate the permission cache; every mutation writes an audit row.
**Endpoints:** see `docs/API_DESIGN.md` §4. **Permissions:** `organization.read/update`, `users.read/invite/update/remove`.
**Failure scenarios covered:** cross-tenant ids (404), forged headers, body tenant ids ignored, expired/revoked/duplicate invitations, escalation, lock-out after suspend/remove.
**Not yet:** ownership transfer. Organizations are no longer created through a public endpoint: providers register (`providers`) and create their customers there.
