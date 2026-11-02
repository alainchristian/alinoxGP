# device-admin

**Purpose:** tools for technical administrators to diagnose device communication problems (spec Module 7). Cross-tenant by nature: uses the system role (reviewed use #4 on `SystemPrismaService`), `platform.devices.diagnose` only.
**Endpoints:** `GET /admin/devices` (search, lifecycle filter, "waiting over 24 h") · `GET /admin/devices/:id/diagnostics` · audited actions: `POST …/lifecycle` (reason required), `PUT …/variant`, `POST …/resync`.
**Diagnostics show:** device facts, what the GPS engine knows (read-only; unreachable is a finding, not an error), lifecycle history, effective capabilities, and plain-language findings (never received data; not synchronised; engine does not know the identifier; waiting too long; evidence missing; model not identified). **No coordinates** are returned.
