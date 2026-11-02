# vehicles

**Purpose:** the vehicles an organization tracks: identity, details, category, paper expiry dates, assigned driver, document records.
**Owned tables:** `vehicles` [T], `vehicle_documents` [T], `driver_assignments` [T] (written here; the driver itself lives in `drivers`). RLS forced on all; composite FKs `(organization_id, …)` so no cross-tenant link is possible even for the system role.
**Endpoints** (permission): `GET /vehicles` (`vehicles.read`; filters `q`, `categoryId`, `hasDevice`, `hasDriver`, whitelisted `sort`) · `POST` (`vehicles.create`) · `GET/PATCH /vehicles/:id` (`vehicles.read/update`) · `DELETE` (`vehicles.delete`) · `POST/DELETE /vehicles/:id/driver` (`drivers.manage`) · `GET /vehicles/:id/driver-history` (`vehicles.read` + `drivers.read`) · `GET/POST /vehicles/:id/documents`, `PATCH/DELETE …/:documentId` (`vehicles.read` / `vehicles.documents.manage`).
**Rules**
- Only the registration number is required; every other field is optional and unset means unknown (`null`), never a default.
- Registration numbers are unique per organization (case/space-insensitive) and VINs among live vehicles; conflicts are `VEHICLE_REGISTRATION_TAKEN` / `VEHICLE_VIN_TAKEN` (409). A category of another organization is `CATEGORY_NOT_FOUND` (422).
- Expiry status (`OK` / `EXPIRING_SOON` ≤ 30 days / `EXPIRED`) is computed by one shared function (`expiryOf`) against the organization's calendar day (its time zone), not the server's.
- One assigned driver per vehicle and one vehicle per driver at a time (partial unique indexes); history is append-only (a trigger forbids deleting or editing a closed row). "Assigned" never means "driving".
- Delete is soft; refused while a device (`VEHICLE_HAS_DEVICE`) or an assigned driver (`VEHICLE_HAS_DRIVER`) remains.
- Documents are records only (OQ-035). Installation date is derived from the open device assignment, never typed.
- Every mutation is audited; free-text notes and personal data are not copied into audit entries.
**Failure scenarios covered by tests:** duplicates, invalid input, other tenant (404), viewer cannot write (403), unauthenticated (401), inactive/foreign driver, double assignment, concurrent assignment (unique index), category in another organization.
