-- Re-create the member-role rules trigger function with ERRCODE 23514 (check_violation) for the
-- "single owner" rule. With 23505 (unique_violation) Prisma reports "Unique constraint failed on the
-- (not available)" and drops our message; 23514 keeps the diagnosable text. Behaviour is otherwise identical.
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
       OR (v_org_type = 'RESELLER' AND v_role_scope = 'RESELLER')
       OR (v_org_type = 'CUSTOMER' AND v_role_scope = 'ORGANIZATION')) THEN
    RAISE EXCEPTION 'role % (scope %) cannot be granted in a % organization', v_role_key, v_role_scope, v_org_type
      USING ERRCODE = '23514';
  END IF;

  IF v_role_key = 'ORG_OWNER' THEN
    PERFORM pg_advisory_xact_lock(hashtext('org-owner:' || NEW.organization_id::text));
    IF EXISTS (
      SELECT 1 FROM member_roles mr JOIN roles r ON r.id = mr.role_id
      WHERE mr.organization_id = NEW.organization_id AND r.key = 'ORG_OWNER' AND mr.member_id <> NEW.member_id
    ) THEN
      RAISE EXCEPTION 'organization % already has an owner', NEW.organization_id USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
