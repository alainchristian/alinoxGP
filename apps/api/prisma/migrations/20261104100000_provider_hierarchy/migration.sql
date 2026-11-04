-- =====================================================================================
-- M1b — Provider hierarchy retrofit (ADR-0010, spec rev. 1.1/1.2 §6).
-- platform -> PROVIDER -> CUSTOMER; every tenant row carries organization_id (owner) AND provider_id
-- (provider at the top of the branch). The database fills and checks provider_id; RLS allows a row to a
-- customer-level request (app.current_org_id) or a provider-level request (app.current_provider_id).
-- Existing development customers without a provider are attached to ONE "migrated" provider.
-- =====================================================================================

-- ---- 1. Vocabulary: RESELLER -> PROVIDER ---------------------------------------------------------------
ALTER TYPE "OrganizationType" RENAME VALUE 'RESELLER' TO 'PROVIDER';
ALTER TYPE "RoleScope" RENAME VALUE 'RESELLER' TO 'PROVIDER';

CREATE TYPE "ProviderStatus" AS ENUM
  ('PENDING_VERIFICATION', 'PENDING_APPROVAL', 'TRIAL', 'ACTIVE', 'GRACE', 'SUSPENDED', 'CLOSED', 'REJECTED');

-- ---- 2. Provider-level setting (same NULLIF rule as app_current_org_id) -----------------------------------
CREATE FUNCTION app_current_provider_id() RETURNS uuid
LANGUAGE sql STABLE
AS $$ SELECT NULLIF(current_setting('app.current_provider_id', true), '')::uuid $$;

-- ---- 3. Tables that carry provider_id ----------------------------------------------------------------------
-- Migrations run as the table owner, and FORCE ROW LEVEL SECURITY applies to the owner too: lift it for the
-- backfill only (restored in section 8) and let the append-only guards step aside for the same statements.
ALTER TABLE organizations NO FORCE ROW LEVEL SECURITY;
ALTER TABLE organizations ADD COLUMN provider_id uuid;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'organization_members','member_roles','invitations','audit_logs','vehicles','device_assignments','vehicle_live_state',
    'gps_devices','alert_rules','alerts','vehicle_categories','drivers','driver_assignments','vehicle_documents',
    'device_status_history','consent_records','device_support_requests'
  ] LOOP
    EXECUTE format('ALTER TABLE %I NO FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN provider_id uuid', t);
  END LOOP;
END $$;

-- ---- 4. Hierarchy rules and the organizations backfill --------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_org_hierarchy() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_parent organizations%ROWTYPE;
BEGIN
  IF NEW.type = 'PLATFORM' THEN
    NEW.provider_id := NULL;
    IF NEW.parent_organization_id IS NOT NULL THEN
      RAISE EXCEPTION 'invalid organization hierarchy: the platform has no parent' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.type = 'PROVIDER' THEN
    IF NEW.parent_organization_id IS NOT NULL THEN
      RAISE EXCEPTION 'invalid organization hierarchy: a PROVIDER has no parent' USING ERRCODE = '23514';
    END IF;
    NEW.provider_id := NEW.id;
  ELSE
    SELECT * INTO v_parent FROM organizations WHERE id = NEW.parent_organization_id;
    IF NEW.parent_organization_id IS NULL OR NOT FOUND OR v_parent.type <> 'PROVIDER' THEN
      RAISE EXCEPTION 'invalid organization hierarchy: a CUSTOMER belongs to exactly one PROVIDER' USING ERRCODE = '23514';
    END IF;
    NEW.provider_id := v_parent.id;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER organizations_hierarchy ON organizations;

DO $$
DECLARE v_provider uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM organizations WHERE type = 'CUSTOMER' AND parent_organization_id IS NULL) THEN
    v_provider := gen_random_uuid();
    INSERT INTO organizations (id, type, name, country_code, timezone, currency_code, locale, status, is_sandbox, created_at, updated_at)
    VALUES (v_provider, 'PROVIDER', 'Migrated development provider', 'RW', 'Africa/Kigali', 'RWF', 'en', 'ACTIVE', false, now(), now());
    UPDATE organizations SET parent_organization_id = v_provider WHERE type = 'CUSTOMER' AND parent_organization_id IS NULL;
  END IF;
  UPDATE organizations SET provider_id = id WHERE type = 'PROVIDER';
  UPDATE organizations c SET provider_id = c.parent_organization_id WHERE c.type = 'CUSTOMER';
END $$;

CREATE TRIGGER organizations_hierarchy BEFORE INSERT OR UPDATE OF parent_organization_id, type ON organizations
  FOR EACH ROW EXECUTE FUNCTION enforce_org_hierarchy();
ALTER TABLE organizations ADD CONSTRAINT organizations_provider_shape CHECK (
  (type = 'PLATFORM' AND provider_id IS NULL) OR (type = 'PROVIDER' AND provider_id = id) OR (type = 'CUSTOMER' AND provider_id = parent_organization_id)
);
CREATE INDEX "organizations_provider_id_idx" ON organizations (provider_id);

-- ---- 5. Backfill provider_id on tenant tables, then enforce NOT NULL -------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'organization_members','member_roles','invitations','audit_logs','vehicles','device_assignments','vehicle_live_state',
    'alert_rules','alerts','vehicle_categories','drivers','driver_assignments','vehicle_documents',
    'device_status_history','consent_records','device_support_requests'
  ] LOOP
    EXECUTE format('ALTER TABLE %I DISABLE TRIGGER USER', t);
    EXECUTE format('UPDATE %I x SET provider_id = o.provider_id FROM organizations o WHERE o.id = x.organization_id', t);
    EXECUTE format('ALTER TABLE %I ENABLE TRIGGER USER', t);
    -- Identity tables also hold the PLATFORM organization's rows (staff, roles, invitations, audit): no provider there.
    IF t NOT IN ('audit_logs', 'organization_members', 'member_roles', 'invitations') THEN
      EXECUTE format('ALTER TABLE %I ALTER COLUMN provider_id SET NOT NULL', t);
    END IF;
    -- A database default of NULL lets Prisma treat the column as optional on create; the trigger below fills it
    -- before the NOT NULL check runs.
    EXECUTE format('ALTER TABLE %I ALTER COLUMN provider_id SET DEFAULT NULL::uuid', t);
    EXECUTE format('CREATE INDEX %I ON %I (provider_id)', t || '_provider_id_idx', t);
  END LOOP;
END $$;

-- gps_devices: the provider is the owner organization's provider (stock belongs to the provider; BYOD to its customer).
ALTER TABLE gps_devices DISABLE TRIGGER USER;
UPDATE gps_devices d SET provider_id = o.provider_id FROM organizations o WHERE o.id = d.owner_organization_id;
ALTER TABLE gps_devices ENABLE TRIGGER USER;
ALTER TABLE gps_devices ALTER COLUMN provider_id SET NOT NULL;
ALTER TABLE gps_devices ALTER COLUMN provider_id SET DEFAULT NULL::uuid;
CREATE INDEX "gps_devices_provider_id_idx" ON gps_devices (provider_id);

-- ---- 6. The database fills and checks provider_id ------------------------------------------------------------
CREATE FUNCTION set_provider_from_organization() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_provider uuid;
BEGIN
  IF NEW.organization_id IS NULL THEN
    RETURN NEW; -- audit_logs of platform-level events carry no organization
  END IF;
  SELECT provider_id INTO v_provider FROM organizations WHERE id = NEW.organization_id;
  IF NEW.provider_id IS NULL THEN
    NEW.provider_id := v_provider;
  ELSIF NEW.provider_id IS DISTINCT FROM v_provider THEN
    RAISE EXCEPTION 'provider_id does not match the provider of organization %', NEW.organization_id USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION set_provider_from_device_owner() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_provider uuid;
  v_current uuid;
BEGIN
  SELECT provider_id INTO v_provider FROM organizations WHERE id = NEW.owner_organization_id;
  IF NEW.provider_id IS NULL THEN
    NEW.provider_id := v_provider;
  ELSIF NEW.provider_id IS DISTINCT FROM v_provider THEN
    RAISE EXCEPTION 'provider_id does not match the provider of the owner organization' USING ERRCODE = '23514';
  END IF;
  -- A device is operated only inside its own provider's tree.
  IF NEW.current_organization_id IS NOT NULL THEN
    SELECT provider_id INTO v_current FROM organizations WHERE id = NEW.current_organization_id;
    IF v_current IS DISTINCT FROM NEW.provider_id THEN
      RAISE EXCEPTION 'a device can only be operated by an organization of its own provider' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'organization_members','member_roles','invitations','audit_logs','vehicles','device_assignments','vehicle_live_state',
    'alert_rules','alerts','vehicle_categories','drivers','driver_assignments','vehicle_documents',
    'device_status_history','consent_records','device_support_requests'
  ] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE OF organization_id, provider_id ON %I FOR EACH ROW EXECUTE FUNCTION set_provider_from_organization()', '00_' || t || '_provider', t);
  END LOOP;
END $$;
CREATE TRIGGER "00_gps_devices_provider" BEFORE INSERT OR UPDATE OF owner_organization_id, current_organization_id, provider_id ON gps_devices
  FOR EACH ROW EXECUTE FUNCTION set_provider_from_device_owner();

-- ---- 7. Role rules: PROVIDER scope, one owner per organization ---------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_member_role_rules() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_role_key text;
  v_role_scope "RoleScope";
  v_org_type "OrganizationType";
BEGIN
  SELECT key, scope INTO v_role_key, v_role_scope FROM roles WHERE id = NEW.role_id;
  SELECT type INTO v_org_type FROM organizations WHERE id = NEW.organization_id;

  IF NOT ((v_org_type = 'PLATFORM' AND v_role_scope = 'PLATFORM')
       OR (v_org_type = 'PROVIDER' AND v_role_scope = 'PROVIDER')
       OR (v_org_type = 'CUSTOMER' AND v_role_scope = 'ORGANIZATION')) THEN
    RAISE EXCEPTION 'role % (scope %) cannot be granted in a % organization', v_role_key, v_role_scope, v_org_type
      USING ERRCODE = '23514';
  END IF;

  IF v_role_key IN ('ORG_OWNER', 'PROVIDER_OWNER') THEN
    PERFORM pg_advisory_xact_lock(hashtext('org-owner:' || NEW.organization_id::text));
    IF EXISTS (
      SELECT 1 FROM member_roles mr JOIN roles r ON r.id = mr.role_id
      WHERE mr.organization_id = NEW.organization_id AND r.key IN ('ORG_OWNER', 'PROVIDER_OWNER') AND mr.member_id <> NEW.member_id
    ) THEN
      RAISE EXCEPTION 'organization % already has an owner', NEW.organization_id USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- The old reseller roles and permissions are replaced by the provider ones (seeded). Remove them when unused.
DELETE FROM roles WHERE key IN ('RESELLER_ADMIN', 'RESELLER_STAFF')
  AND NOT EXISTS (SELECT 1 FROM member_roles mr WHERE mr.role_id = roles.id)
  AND NOT EXISTS (SELECT 1 FROM invitations i WHERE i.role_id = roles.id);
DELETE FROM permissions WHERE key LIKE 'reseller.%' OR key IN ('billing.read', 'billing.manage');

-- ---- 8. Provider profile, customer limits, staff scopes (new tables) ------------------------------------------------
CREATE TABLE provider_profiles (
  organization_id     uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  status              "ProviderStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
  company_name        text NOT NULL,
  registration_number text,
  tin                 text,
  contact_name        text NOT NULL,
  contact_email       text NOT NULL,
  contact_phone       text,
  expected_devices    integer,
  licence_number      text,
  approved_by_user_id uuid,
  approved_at         timestamptz,
  rejected_at         timestamptz,
  rejection_reason    text,
  suspended_at        timestamptz,
  suspension_reason   text,
  terms_version       text,
  terms_accepted_at   timestamptz,
  slug                text,
  display_name        text,
  primary_color       char(7),
  accent_color        char(7),
  logo_url            text,
  support_phone       text,
  support_email       text,
  support_whatsapp    text,
  website_url         text,
  terms_url           text,
  privacy_url         text,
  show_powered_by     boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT provider_profiles_slug_format CHECK (slug IS NULL OR slug ~ '^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$'),
  CONSTRAINT provider_profiles_colors CHECK (
    (primary_color IS NULL OR primary_color ~ '^#[0-9a-fA-F]{6}$') AND (accent_color IS NULL OR accent_color ~ '^#[0-9a-fA-F]{6}$')),
  CONSTRAINT provider_profiles_expected_devices CHECK (expected_devices IS NULL OR expected_devices >= 0)
);
CREATE UNIQUE INDEX "provider_profiles_slug_key" ON provider_profiles (slug);
CREATE INDEX "provider_profiles_status_idx" ON provider_profiles (status);

CREATE FUNCTION enforce_provider_profile_org() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = NEW.organization_id AND type = 'PROVIDER') THEN
    RAISE EXCEPTION 'a provider profile belongs to a PROVIDER organization' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER provider_profiles_org BEFORE INSERT OR UPDATE OF organization_id ON provider_profiles
  FOR EACH ROW EXECUTE FUNCTION enforce_provider_profile_org();

-- Per-customer limits the provider sets within its own plan (effective = provider plan ∩ customer limit; enforced from M10).
-- enabled NULL = inherit the provider's plan; limit_value NULL = no limit set at this level.
CREATE TABLE customer_entitlements (
  id              uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider_id     uuid NOT NULL DEFAULT NULL::uuid,
  key             text NOT NULL,
  enabled         boolean,
  limit_value     integer,
  updated_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_entitlements_key_format CHECK (key ~ '^[a-z][a-z0-9_]{1,63}$'),
  CONSTRAINT customer_entitlements_limit CHECK (limit_value IS NULL OR limit_value >= 0)
);
CREATE UNIQUE INDEX "customer_entitlements_organization_id_key_key" ON customer_entitlements (organization_id, key);
CREATE INDEX "customer_entitlements_provider_id_idx" ON customer_entitlements (provider_id);

-- Provider staff scope: a member with scoped_to_customers = true sees ONLY the listed customers.
ALTER TABLE organization_members ADD COLUMN scoped_to_customers boolean NOT NULL DEFAULT false;
CREATE TABLE member_customer_scopes (
  id                       uuid PRIMARY KEY,
  organization_id          uuid NOT NULL,
  provider_id              uuid NOT NULL DEFAULT NULL::uuid,
  member_id                uuid NOT NULL,
  customer_organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT member_customer_scopes_member_fkey FOREIGN KEY (organization_id, member_id)
    REFERENCES organization_members (organization_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX "member_customer_scopes_member_id_customer_organization_id_key"
  ON member_customer_scopes (member_id, customer_organization_id);
CREATE INDEX "member_customer_scopes_provider_id_idx" ON member_customer_scopes (provider_id);
CREATE INDEX "member_customer_scopes_organization_id_idx" ON member_customer_scopes (organization_id);

CREATE FUNCTION enforce_scope_customer() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = NEW.customer_organization_id AND type = 'CUSTOMER' AND provider_id = NEW.provider_id) THEN
    RAISE EXCEPTION 'a staff scope can only list customers of the same provider' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
-- Order matters: fill provider_id first (name sorts before), then check the customer.
CREATE TRIGGER "00_customer_entitlements_provider" BEFORE INSERT OR UPDATE OF organization_id, provider_id ON customer_entitlements
  FOR EACH ROW EXECUTE FUNCTION set_provider_from_organization();
CREATE TRIGGER "00_member_customer_scopes_provider" BEFORE INSERT OR UPDATE OF organization_id, provider_id ON member_customer_scopes
  FOR EACH ROW EXECUTE FUNCTION set_provider_from_organization();
CREATE TRIGGER "10_member_customer_scopes_customer" BEFORE INSERT OR UPDATE ON member_customer_scopes
  FOR EACH ROW EXECUTE FUNCTION enforce_scope_customer();

-- ---- 9. Row-Level Security: customer key OR provider key; forced again ------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'organization_members','member_roles','invitations','audit_logs','vehicles','device_assignments','vehicle_live_state',
    'alert_rules','alerts','vehicle_categories','drivers','driver_assignments','vehicle_documents',
    'device_status_history','consent_records','device_support_requests'
  ] LOOP
    EXECUTE format('DROP POLICY tenant_isolation ON %I', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (organization_id = app_current_org_id() OR provider_id = app_current_provider_id())
      WITH CHECK (organization_id = app_current_org_id() OR provider_id = app_current_provider_id())$p$, t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['customer_entitlements','member_customer_scopes'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (organization_id = app_current_org_id() OR provider_id = app_current_provider_id())
      WITH CHECK (organization_id = app_current_org_id() OR provider_id = app_current_provider_id())$p$, t);
  END LOOP;
END $$;

-- A device is visible to the organization that owns the hardware, the one operating it, and the provider of both.
DROP POLICY tenant_isolation ON gps_devices;
CREATE POLICY tenant_isolation ON gps_devices
  USING (owner_organization_id = app_current_org_id() OR current_organization_id = app_current_org_id() OR provider_id = app_current_provider_id())
  WITH CHECK (owner_organization_id = app_current_org_id() OR current_organization_id = app_current_org_id() OR provider_id = app_current_provider_id());
ALTER TABLE gps_devices FORCE ROW LEVEL SECURITY;

-- An organization is visible to itself, to its provider's staff (all of the provider's tree) and, as before, to its parent.
DROP POLICY tenant_isolation ON organizations;
CREATE POLICY tenant_isolation ON organizations
  USING (id = app_current_org_id() OR parent_organization_id = app_current_org_id() OR provider_id = app_current_provider_id())
  WITH CHECK (id = app_current_org_id() OR provider_id = app_current_provider_id());
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;

-- The provider's registration data is visible to the provider's own organization only (customers read the public branding instead).
ALTER TABLE provider_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_profiles FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON provider_profiles
  USING (organization_id = app_current_org_id() OR organization_id = app_current_provider_id())
  WITH CHECK (organization_id = app_current_org_id() OR organization_id = app_current_provider_id());
