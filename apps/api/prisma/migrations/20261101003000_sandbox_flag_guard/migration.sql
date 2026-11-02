-- An organization that owns simulated devices must stay a sandbox. Without this rule, clearing is_sandbox would
-- silently turn existing simulated devices into "simulated data in a production organization", which the pipeline
-- must then refuse (gps-simulator §2). Enforced at the source instead of relying on the ingestion guard alone.
-- Note: the trigger runs as the invoking role; it is meant for platform (system-role) administration, which is the
-- only path that can change organizations.is_sandbox.
CREATE FUNCTION enforce_sandbox_flag_rules() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.is_sandbox AND NOT NEW.is_sandbox AND EXISTS (
    SELECT 1 FROM gps_devices WHERE owner_organization_id = NEW.id AND is_simulated
  ) THEN
    RAISE EXCEPTION 'organization % owns simulated devices and must remain a sandbox', NEW.id USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER organizations_sandbox_flag BEFORE UPDATE OF is_sandbox ON organizations
  FOR EACH ROW EXECUTE FUNCTION enforce_sandbox_flag_rules();
