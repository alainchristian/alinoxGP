-- Follow-up to 20261104100000_provider_hierarchy (never edit an applied migration).
-- 1. PostgreSQL drops "DEFAULT NULL::uuid" (a NULL constant is the same as no default), so Prisma could not see it. The
--    provider_id columns need a real default expression so Prisma treats them as optional on create while the trigger
--    fills them: an immutable function that returns NULL.
-- 2. Foreign keys created by hand need ON UPDATE CASCADE to match what Prisma expects.
CREATE FUNCTION app_null_uuid() RETURNS uuid
LANGUAGE sql IMMUTABLE
AS $$ SELECT NULL::uuid $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'organization_members','member_roles','invitations','audit_logs','vehicles','device_assignments','vehicle_live_state',
    'gps_devices','alert_rules','alerts','vehicle_categories','drivers','driver_assignments','vehicle_documents',
    'device_status_history','consent_records','device_support_requests','customer_entitlements','member_customer_scopes'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ALTER COLUMN provider_id SET DEFAULT app_null_uuid()', t);
  END LOOP;
END $$;

ALTER TABLE provider_profiles DROP CONSTRAINT provider_profiles_organization_id_fkey;
ALTER TABLE provider_profiles ADD CONSTRAINT provider_profiles_organization_id_fkey
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE customer_entitlements DROP CONSTRAINT customer_entitlements_organization_id_fkey;
ALTER TABLE customer_entitlements ADD CONSTRAINT customer_entitlements_organization_id_fkey
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE member_customer_scopes DROP CONSTRAINT member_customer_scopes_customer_organization_id_fkey;
ALTER TABLE member_customer_scopes ADD CONSTRAINT member_customer_scopes_customer_organization_id_fkey
  FOREIGN KEY (customer_organization_id) REFERENCES organizations(id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE member_customer_scopes DROP CONSTRAINT member_customer_scopes_member_fkey;
ALTER TABLE member_customer_scopes ADD CONSTRAINT member_customer_scopes_member_fkey
  FOREIGN KEY (organization_id, member_id) REFERENCES organization_members (organization_id, id) ON DELETE CASCADE ON UPDATE CASCADE;
