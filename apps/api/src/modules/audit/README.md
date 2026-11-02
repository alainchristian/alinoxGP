# audit

**Purpose:** append-only audit trail (spec §13). `AuditService.record({ action, … })` captures actor, organization, target, before/after, IP, user agent and request id from the request context.
**Owned table:** `audit_logs` — UPDATE/DELETE/TRUNCATE revoked and rejected by trigger for every application role; tenant rows are visible only within their organization (RLS); platform-level rows (login, registration) have no organization and are readable only with the system role.
**Rules:** never put passwords, tokens, secrets or coordinates in before/after. Written with the system DB role (reviewed use #2).
**Not yet:** read endpoint / UI (`platform.audit.read`, M10).
