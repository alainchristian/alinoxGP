# catalogue

**Purpose:** the device catalogue (spec Module 6, ADR-0009): manufacturer → model → variant (hardware revision + firmware range) → per-capability rows → append-only verification log. **Global data** (no organization): written only by platform staff, read by customers through a listing of *listed* models.
**Tables:** `gps_manufacturers`, `gps_device_models`, `gps_device_variants`, `variant_capabilities`, `variant_verifications` (append-only: UPDATE/DELETE revoked).
**Endpoints:** `GET /catalogue/models` (`devices.read`; listed models only; testers' names are not included) · `/admin/catalogue/...` (`platform.catalogue.manage`): manufacturers, models, variants, `PUT/DELETE variants/:id/capabilities/:key`, `POST variants/:id/verifications`.
**Rules (enforced in the database, mapped to stable API errors):**
- A variant is `VERIFIED` only if a verification record exists (`VERIFICATION_REQUIRED`), and a simulator profile can never be verified (`SIMULATOR_PROFILE_NOT_VERIFIABLE`).
- `remote_immobilization` can only be marked supported on a verified variant (`IMMOBILIZATION_NEEDS_VERIFIED_VARIANT`). The customer-facing result is still never "enabled" (see devices).
- A capability with no row is UNKNOWN, never "not supported". Capability keys are a closed list (CHECK).
**Seed:** one entry only — the platform simulator profile (`prisma/seed/catalogue.ts`), "Supported but not physically verified", three capabilities. No physical device has been bench-tested, so no real model is catalogued (DEVICE_COMPATIBILITY.md §5).
