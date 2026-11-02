# Database design

Phase 0 deliverable — 2026-11-01 — **proposed**. Covers spec §10.1 entities plus the extension-brief entities. Column lists show the important fields, not every column; exact types are settled in each milestone's migration. Tenancy rules: ADR-0003. Storage of GPS data: ADR-0004.

## 1. Conventions

- PostgreSQL; Prisma schema in `apps/api/prisma/schema.prisma`; RLS/composite FKs/partial indexes/REVOKEs as raw SQL in migrations (OQ-014).
- `id uuid` PK (`@db.Uuid`), `created_at`/`updated_at timestamptz`; money as integer minor units + ISO currency; enums as Postgres enums or CHECKed text (decide per table in M1; Prisma enums by default).
- Tenant-owned table = has `organization_id uuid NOT NULL` + FK + RLS + leading index + composite parent keys. Marked **[T]** below.
- Soft delete (`deleted_at`) only for vehicles, drivers, geofences, vehicle categories. **Append-only [A]:** audit, security, assignment, status and financial history — UPDATE/DELETE revoked from the app role.
- Timestamps UTC. Coordinates `double precision` lat/lon (PostGIS not planned: geometry operations happen in Traccar or in app code; revisit if server-side spatial queries become necessary — note in ROADMAP M6).
- Global (non-tenant) identifiers: IMEI/uniqueId, email, country codes.

## 2. Domains and tables

### 2.1 Identity and access (M1)

| Table | Key columns / constraints | Notes |
|---|---|---|
| `users` | email (unique, citext), password_hash (argon2id), full_name, phone_e164, locale, email_verified_at, totp_secret_enc, status, last_login_at | Global identity; no org column. |
| `sessions` | user_id, family_id, refresh_token_hash, user_agent, ip, created_at, last_used_at, step_up_at, revoked_at | Rotation + reuse detection by `family_id`. |
| `email_tokens` | user_id, purpose (VERIFY/RESET/INVITE), token_hash, expires_at, used_at | Single-use, hashed. |
| `totp_recovery_codes` | user_id, code_hash, used_at | |
| `organizations` | type (PLATFORM/RESELLER/CUSTOMER), parent_organization_id (reseller→child), name, legal_name, country_code, timezone, currency_code, locale, status (ACTIVE/SUSPENDED), is_sandbox, branding_json (future white-label), created_by | `UNIQUE (id)`; reseller child relation limited to one level initially (CHECK/trigger). |
| `organization_members` **[T]** | organization_id, user_id, status, UNIQUE (organization_id, user_id) | |
| `roles` | scope (PLATFORM/ORGANIZATION/RESELLER), organization_id NULL for system roles, key, name, is_system | Custom roles per org later. |
| `permissions` | key (unique, e.g. `vehicles.update`), description | Seeded from `packages/shared`. |
| `role_permissions` | role_id, permission_id | |
| `member_roles` **[T]** | organization_id, member_id, role_id | Exactly one Owner per org enforced by partial unique index. |
| `invitations` **[T]** | organization_id, email, role_id, token_hash, expires_at, accepted_at | |
| `audit_logs` **[A]** | organization_id NULL (platform events), actor_user_id, actor_type, action, target_type, target_id, before_json, after_json, ip, user_agent, request_id, at | Cursor-paginated; redacted. |
| `consent_records` **[T]** | organization_id, subject_type (ORG_ADMIN/DRIVER/…), subject_id, notice_version, accepted_at | Placeholder for OQ-020; schema finalised in M5. |

### 2.2 Reference and configuration (M1; used from M9)

`countries` (iso2, name, dial_code, default_currency, default_timezone, enabled), `currencies` (iso4217, minor_unit_exponent, symbol), `country_settings` (country_code, tax_rules_json, date/number formats, enabled_providers), `provider_configs` (kind: PAYMENT/EMAIL/SMS/WHATSAPP/MAP, country_code, provider_key, enabled, non-secret config_json — secrets only in env), `platform_settings` (key/value for thresholds such as `maxFixAgeSeconds`).

### 2.3 Plans and entitlements (M1 skeleton → M9)

`subscription_plans` (code, name, billing_interval, price_minor, currency, is_public, grace_days, expiry_behaviour), `plan_entitlements` (plan_id, key, enabled, limit_int), `subscriptions` **[T]** (organization_id, payer_organization_id, plan_id, status TRIAL/ACTIVE/GRACE/EXPIRED/CANCELLED, period_start/end, trial_end, cancel_at), `subscription_changes` **[T][A]**. No prices or limits hardcoded in code.

### 2.4 Device catalogue (M5; global platform data, no RLS, written by platform routes only)

`gps_manufacturers`, `gps_device_models` (manufacturer_id, name, protocol, network_technologies[], identifier_type, default_reporting_intervals, installation_requirements, known_limitations, docs_url), `gps_device_variants` (model_id, hardware_revision, firmware_min/max, compatibility_status, last_tested_at, tested_by), `variant_capabilities` (variant_id, capability_key, support, evidence_attribute, verified_at, verified_by), `variant_commands` (variant_id, intent, engine_command_type, attributes_template, output_index, confirmation_attribute, verified_at), `variant_io_map`, `variant_verifications` [A] (test evidence records: who, when, procedure, results).

### 2.5 Devices and vehicles (M2 minimal → M5 full)

| Table | Key columns / constraints | Notes |
|---|---|---|
| `vehicle_categories` **[T]** | organization_id, name | |
| `vehicles` **[T]** | organization_id, registration_number, make, model, year, color, vehicle_type, vin, fuel_type, category_id, insurance_expiry, inspection_expiry, notes, deleted_at; `UNIQUE (organization_id, id)`, `UNIQUE (organization_id, registration_number) WHERE deleted_at IS NULL` | M2 creates it with registration number + org only. |
| `vehicle_documents` **[T]** | organization_id, vehicle_id (composite FK), kind, file_ref, expires_at | |
| `drivers` **[T]** | organization_id, name, phone_e164, license_no, license_expiry, user_id NULL, deleted_at | Linking a driver user enables the Driver role policy. |
| `driver_assignments` **[T][A]** | organization_id, driver_id, vehicle_id, from, to | Assigned ≠ currently driving (spec Module 13). |
| `gps_devices` | imei/unique_id (**globally unique**), traccar_device_id, variant_id (nullable until identified), serial_number, sim_iccid, sim_msisdn, **owner_organization_id**, **current_organization_id** (denormalised operating org), lifecycle_status, replaced_by_device_id, is_simulated, firmware_reported, created_at | RLS: visible if owner or current org = context (ADR-0003). `is_simulated` ⇒ owner must be a sandbox org (CHECK via trigger). |
| `device_assignments` **[T][A]** | organization_id, device_id, vehicle_id (composite FK to vehicles), assigned_at, unassigned_at, reason, assigned_by, unassigned_by; partial unique: one open row per device, one open row per vehicle; exclusion constraint against overlapping windows per device | Source of truth for tenant routing and history visibility windows. |
| `device_status_history` **[A]** | device_id, from_status, to_status, actor, reason, at | Lifecycle changes only (ADR-0005). |
| `device_effective_capabilities` **[T]** | organization_id, device_id, capability_key, state, reasons_json, computed_at | Cache of §3 of device-catalogue skill. |

### 2.6 Live state and aggregates (M2–M3, M5)

`vehicle_live_state` **[T]** (organization_id, vehicle_id PK, device_id, lat, lon, speed_kmh, heading, ignition tri-state, status, last_fix_at, last_seen_at, last_fix_invalid, delayed, alert_active, simulated, updated_at) — throttled upsert. `vehicle_daily_stats` **[T]** (organization_id, vehicle_id, date_local, distance_km, drive_seconds, idle_seconds, engine_hours, max_speed, avg_speed, overspeed_count, first_move_at, last_move_at, source_version) — recomputable from Traccar. `trips` **[T]** (optional cache; created only if M6 measurements require it). **No `positions` table** (ADR-0004; trigger list defined there).

### 2.7 Geofences, alerts, notifications (M6–M8)

`geofences` **[T]** (organization_id, name, kind CIRCLE/POLYGON, geojson, radius_m, category, traccar_geofence_id, deleted_at), `geofence_vehicles` **[T]** (link), `alert_rules` **[T]** (organization_id, type, params_json, severity, cooldown_s, schedule_json, enabled, geofence_id NULL), `alert_rule_recipients`, `alerts` **[T]** (organization_id, vehicle_id, rule_id, type, severity, started_at, ended_at, position_snapshot_json, simulated, delayed, acknowledged_by/at), `notification_preferences` **[T]** (per member: channel × alert type), `notifications` **[T]** (organization_id, recipient_user_id, alert_id, channel, status, provider_message_id, attempts, sent_at, read_at).

### 2.8 Vehicle security (M7)

`immobilization_commands` **[T]** (organization_id, vehicle_id, device_id, intent STARTER_INHIBIT_ON/OFF, requested_by, reason_code, reason_text, idempotency_key, precondition_snapshot_json, engine_command_ref, state, timestamps; partial unique index on `vehicle_id` WHERE state IN (PENDING, SENT, ACKNOWLEDGED)), `immobilization_command_events` **[T][A]** (command_id, state, at, source, evidence_json), `security_events` **[T][A]** (requests, rejections with failures, transitions, restorations, emergency restorations), `vehicle_security_status` **[T]** (vehicle_id, status NORMAL/STARTER_INHIBITED/UNKNOWN, evidence_ref, since).

### 2.9 Inventory and installations (M9)

`suppliers`, `device_inventory` (serial, imei, variant_id, supplier_id, purchase_date, purchase_ref, warranty_end, sim_iccid, status IN_STOCK/RESERVED/INSTALLED/RMA/RETIRED, location; platform- or reseller-owned → owner_organization_id), `device_maintenance_records`, `technicians` (user_id, organization_id, active), `installations` **[T]** (organization_id for the customer, vehicle_id, device_id, technician_id, scheduled_at, status, failure_reason), `installation_status_history` **[A]**, `installation_records` (wiring_map_json, relay_info, photos[], firmware_read, notes), `installation_test_results` (check key, result, evidence, tested_at).

### 2.10 Billing (M9)

`invoices` **[T][A-after-issue]**, `invoice_lines`, `payments` **[T]**, `payment_transactions` **[T][A]** (provider, provider_ref, amount_minor, currency, status, raw_event_ref), `webhook_events` (provider, event_id unique, signature_ok, payload_hash, processed_at — idempotency), `payment_reminders`. Never deleted.

### 2.11 Platform support (M9)

`support_tickets` **[T]** (organization_id, subject, status, requester, assignee), `support_ticket_messages`, `support_access_grants` **[T][A]** (time-boxed platform access to a customer org: actor, reason, expires_at).

### 2.12 Cross-cutting

`idempotency_keys` (scope: user+route, key, request_hash, response_ref, expires_at 24 h), `exports` **[T]** (organization_id, kind, params, status, file_ref, expires_at), `jobs_audit` not needed (BullMQ in Redis).

## 3. Key constraints and indexes (non-exhaustive)

- Composite FK pattern: `vehicles UNIQUE (organization_id, id)`; `device_assignments (organization_id, vehicle_id) → vehicles (organization_id, id)`; same for drivers, geofences, alerts.
- `gps_devices.imei` UNIQUE (global); `gps_devices.traccar_device_id` UNIQUE.
- Partial unique indexes: one open device assignment per device and per vehicle; one non-terminal command per vehicle; one Owner per organization; `vehicles` registration number unique among non-deleted.
- Hot-path indexes (all lead with `organization_id` where tenant-owned): `vehicles (organization_id, status…)`, `vehicle_live_state (organization_id, status)`, `alerts (organization_id, started_at desc)`, `device_assignments (device_id, assigned_at)` for tenant routing, `audit_logs (organization_id, at desc)`, `notifications (organization_id, recipient_user_id, read_at)`.
- Append-only enforcement: `REVOKE UPDATE, DELETE` from the app role on [A] tables, plus reject-trigger as a second layer; tested.

## 4. Seeds

`reference` (idempotent): countries (RW first), currencies (RWF), permissions, system roles + bundles, base entitlement keys, default platform thresholds. `demo` (development only): sandbox org, `SIM-` devices, demo users — every demo record visibly labelled simulated. No default production passwords; Super Administrator created by CLI.

## 5. Tables not yet decided

Whether to include PostGIS; exact enum vs lookup choice per table; custom per-org roles (schema allows, UI later); fuel/driver-ID/telemetry tables (spec mentions fuel capability and driver identification — only capability flags and the `driverUniqueId` attribute are planned until hardware supports them); white-label domains table (future phase).

## 6. M1 as built (2026-11-01)

Implemented in `apps/api/prisma/schema.prisma` and two migrations (`20261101000000_init`, `20261101001000_owner_trigger_errcode`):

- **Tables:** `countries`, `currencies`, `users`, `sessions`, `refresh_tokens`, `email_tokens`, `totp_recovery_codes`, `organizations`, `organization_members`, `roles`, `permissions`, `role_permissions`, `member_roles`, `invitations`, `audit_logs`.
- **Differences from the plan above:** refresh tokens are their own table (`sessions` = one login family, see ADR-0002); `roles` has no `organization_id` yet (system roles only; custom roles add the column and RLS later); `consent_records`, plan/entitlement/subscription tables and `idempotency_keys` are **not** created yet (see roadmap deviations).
- **RLS (enabled + forced):** `organizations` (own row or direct child), `organization_members`, `member_roles`, `invitations`, `audit_logs`. Helper `app_current_org_id()`.
- **Constraints beyond Prisma:** composite FK `member_roles (organization_id, member_id) → organization_members (organization_id, id)`; trigger enforcing role scope ↔ organization type and exactly one `ORG_OWNER` per organization (advisory-lock serialised); trigger allowing only `RESELLER → CUSTOMER`, one level; append-only `audit_logs` (UPDATE/DELETE revoked from `gps_app` and `gps_system`, plus reject triggers incl. TRUNCATE).
- **Roles:** `gps_owner` (migrations), `gps_app` (runtime, RLS applies), `gps_system` (BYPASSRLS, reviewed uses only).

## 7. M2 as built (2026-11-01)

Migrations `20261101002000_fleet_core_and_gps_routing` and `20261101003000_sandbox_flag_guard`. New tables: `vehicles` [T], `gps_devices`, `device_assignments` [T], `vehicle_live_state` [T] (RLS enabled **and** forced on all four).

- **`gps_devices`** carries `owner_organization_id` and `current_organization_id` (ADR-0003); policy = visible to either. `unique_id` is globally unique; `traccar_device_id` unique; `engine_sync_status` PENDING/SYNCED/FAILED; `lifecycle_status` uses the ADR-0005 enum but M2 does not transition it (that, and `device_status_history`, are M5). CHECKs: identifier length 3–64; **`(unique_id LIKE 'SIM-%') = is_simulated`**. Trigger: a simulated device may only be owned by a sandbox organization; a second trigger forbids clearing `is_sandbox` on an organization that owns simulated devices.
- **`device_assignments`**: composite FK `(organization_id, vehicle_id) → vehicles`; **partial unique indexes** one open row per device and per vehicle; CHECK `unassigned_at >= assigned_at`; trigger validates the device is owned/operated by the assigning organization on insert, makes closed rows immutable, allows only unassignment fields to change, and rejects DELETE (also revoked from the app and system roles).
- **`vehicles`**: expression + partial unique index `(organization_id, upper(btrim(registration_number))) WHERE deleted_at IS NULL`; CHECK length 1–20.
- **`vehicle_live_state`**: one row per vehicle, composite FK to `vehicles`; `latitude/longitude/last_fix_at` nullable (a device whose first message had no usable fix has a state without coordinates); `ignition` tri-state.
- **Not built (still planned):** `device_status_history`, catalogue tables, `vehicle_daily_stats`, `trips`, inventory — their milestones.
- Prisma and the hand-written SQL coexist: `prisma migrate diff --from-migrations … --exit-code` reports **no drift** with partial/expression indexes, CHECKs, triggers and forced RLS (closes the open part of OQ-014).

## 8. M3a as built (2026-11-02)

- **`vehicle_live_state`** gained `motion`, `last_fix_delayed`, `stationary_since`, `status` (enum `VehicleStatus`) and `status_changed_at` (migration `…004000_status_and_alerts`). It is a *saved copy* of the leader's in-memory state: written as one multi-row upsert (`jsonb_to_recordset`, ≤ 1,000 vehicles per statement) every `STATE_PERSIST_INTERVAL_SEC` (30 s) and at once on a status change or first position. The statement ends with `WHERE existing.last_seen_at <= new.last_seen_at`, so a stale or late writer can never move a row backwards. Vehicles deleted/unassigned meanwhile are skipped (the statement joins `vehicles`).
- **`alert_rules`** (organization, type `OVERSPEED | IGNITION_ON | IGNITION_OFF | DEVICE_OFFLINE`, JSON params validated by CHECK — an overspeed rule needs a limit —, severity, cooldown, enabled) and **`alerts`** (organization, vehicle, rule, type, severity, started/acknowledged by/at, position snapshot, `simulated`, delayed flag). Both: `organization_id`, composite FKs, **forced RLS**, isolation tests.
- **Redis (not a table, but part of the data design):** `org:{orgId}:live` hash (vehicleId → state JSON), `org:{orgId}:vehicle:{vehicleId}:recent` ring buffer (20), `gps:live:orgs` set, `gps:live:deadlines` sorted set (member `orgId|vehicleId`, score = next instant the derived status could change; identifiers only), `gps:ingestion:leader` lease, `alert:cd:{rule}:{vehicle}` cooldown. All carry the environment's `REDIS_KEY_PREFIX` (empty in production, one per suite in tests). See ADR-0007.
- Application time versus database time: `device_assignments.assigned_at` is stamped by the database; the host and the container clock can differ by under a second, so application code that closes an assignment never records an end before the start (`DevicesService.unassign`).

## 10. M5b as built (2026-11-02)

Migration `20261102133937_device_catalogue`. Global tables: `gps_manufacturers`, `gps_device_models`, `gps_device_variants`, `variant_capabilities`, `variant_verifications`, `consent_notices`. Tenant tables (forced RLS): `device_status_history`, `consent_records`, `device_support_requests`. `gps_devices` gains `variant_id`, `firmware_version`, `serial_number`, `sim_iccid`. Database-enforced rules: VERIFIED needs a verification row and cannot be a simulator profile; immobilization capability only on a VERIFIED variant; published consent notices are immutable; `device_status_history`, `consent_records`, `variant_verifications` are append-only (UPDATE and DELETE revoked); capability keys are a closed list; ICCID and port formats are checked.

## 9. M5a as built (2026-11-02)

Migration `20261102124725_vehicle_management`: `vehicles` gains optional details (make, model, year, colour, type, VIN, fuel, insurance/inspection expiry as `date`, notes, category); new tenant tables `vehicle_categories`, `drivers`, `driver_assignments` (append-only history: trigger + `REVOKE DELETE`), `vehicle_documents`. All have `organization_id`, composite FKs, forced RLS with the standard policy, CHECK constraints (formats and lengths) and hand-written partial/expression unique indexes (category name, VIN, licence number, one open assignment per vehicle and per driver). Verified by the isolation, RLS and constraint tests in `fleet-management.e2e-spec.ts`.
