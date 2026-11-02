-- CreateEnum
CREATE TYPE "OrganizationType" AS ENUM ('PLATFORM', 'RESELLER', 'CUSTOMER');

-- CreateEnum
CREATE TYPE "OrganizationStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "MemberStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "RoleScope" AS ENUM ('PLATFORM', 'ORGANIZATION', 'RESELLER');

-- CreateEnum
CREATE TYPE "EmailTokenPurpose" AS ENUM ('VERIFY_EMAIL', 'RESET_PASSWORD');

-- CreateTable
CREATE TABLE "countries" (
    "code" CHAR(2) NOT NULL,
    "name" TEXT NOT NULL,
    "dial_code" TEXT NOT NULL,
    "default_currency" CHAR(3) NOT NULL,
    "default_timezone" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "countries_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "currencies" (
    "code" CHAR(3) NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "minor_unit_exp" INTEGER NOT NULL,

    CONSTRAINT "currencies_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "phone_e164" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "email_verified_at" TIMESTAMPTZ,
    "totp_secret_enc" TEXT,
    "totp_enabled_at" TIMESTAMPTZ,
    "last_login_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "user_agent" TEXT,
    "ip" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "step_up_at" TIMESTAMPTZ,
    "revoked_at" TIMESTAMPTZ,
    "revoked_reason" TEXT,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "used_at" TIMESTAMPTZ,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "purpose" "EmailTokenPurpose" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "used_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "totp_recovery_codes" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "used_at" TIMESTAMPTZ,

    CONSTRAINT "totp_recovery_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "type" "OrganizationType" NOT NULL DEFAULT 'CUSTOMER',
    "parent_organization_id" UUID,
    "name" TEXT NOT NULL,
    "legal_name" TEXT,
    "country_code" CHAR(2) NOT NULL,
    "timezone" TEXT NOT NULL,
    "currency_code" CHAR(3) NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "status" "OrganizationStatus" NOT NULL DEFAULT 'ACTIVE',
    "is_sandbox" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_members" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "MemberStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "scope" "RoleScope" NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_system" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_id")
);

-- CreateTable
CREATE TABLE "member_roles" (
    "organization_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "member_roles_pkey" PRIMARY KEY ("member_id","role_id")
);

-- CreateTable
CREATE TABLE "invitations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "role_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "invited_by_user_id" UUID,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "accepted_at" TIMESTAMPTZ,
    "revoked_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "organization_id" UUID,
    "actor_user_id" UUID,
    "actor_type" TEXT NOT NULL DEFAULT 'USER',
    "action" TEXT NOT NULL,
    "target_type" TEXT,
    "target_id" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "user_agent" TEXT,
    "request_id" TEXT,
    "at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "sessions_user_id_revoked_at_idx" ON "sessions"("user_id", "revoked_at");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_session_id_idx" ON "refresh_tokens"("session_id");

-- CreateIndex
CREATE UNIQUE INDEX "email_tokens_token_hash_key" ON "email_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "email_tokens_user_id_purpose_idx" ON "email_tokens"("user_id", "purpose");

-- CreateIndex
CREATE INDEX "totp_recovery_codes_user_id_idx" ON "totp_recovery_codes"("user_id");

-- CreateIndex
CREATE INDEX "organizations_parent_organization_id_idx" ON "organizations"("parent_organization_id");

-- CreateIndex
CREATE INDEX "organization_members_user_id_idx" ON "organization_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "organization_members_organization_id_user_id_key" ON "organization_members"("organization_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "organization_members_organization_id_id_key" ON "organization_members"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "roles_scope_key_key" ON "roles"("scope", "key");

-- CreateIndex
CREATE UNIQUE INDEX "roles_key_key" ON "roles"("key");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_key_key" ON "permissions"("key");

-- CreateIndex
CREATE INDEX "member_roles_organization_id_idx" ON "member_roles"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "invitations_token_hash_key" ON "invitations"("token_hash");

-- CreateIndex
CREATE INDEX "invitations_organization_id_email_idx" ON "invitations"("organization_id", "email");

-- CreateIndex
CREATE INDEX "audit_logs_organization_id_at_idx" ON "audit_logs"("organization_id", "at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_actor_user_id_at_idx" ON "audit_logs"("actor_user_id", "at" DESC);

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_tokens" ADD CONSTRAINT "email_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "totp_recovery_codes" ADD CONSTRAINT "totp_recovery_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_parent_organization_id_fkey" FOREIGN KEY ("parent_organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_roles" ADD CONSTRAINT "member_roles_organization_id_member_id_fkey" FOREIGN KEY ("organization_id", "member_id") REFERENCES "organization_members"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_roles" ADD CONSTRAINT "member_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- =====================================================================================
-- Hand-written section (not expressible in Prisma schema). See docs/adr/0003.
-- =====================================================================================

-- Current tenant, set per transaction by the API via set_config('app.current_org_id', <uuid>, true).
-- NULLIF is required: on a pooled connection a previously used custom setting reads back as '' (not NULL)
-- and ''::uuid would raise. "No tenant set" must simply match no rows.
CREATE FUNCTION app_current_org_id() RETURNS uuid
LANGUAGE sql STABLE
AS $$ SELECT NULLIF(current_setting('app.current_org_id', true), '')::uuid $$;

-- ---- Row-Level Security: enabled AND forced (applies even to the table owner) ----
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_members FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON organization_members
  USING (organization_id = app_current_org_id())
  WITH CHECK (organization_id = app_current_org_id());

ALTER TABLE member_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_roles FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON member_roles
  USING (organization_id = app_current_org_id())
  WITH CHECK (organization_id = app_current_org_id());

ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON invitations
  USING (organization_id = app_current_org_id())
  WITH CHECK (organization_id = app_current_org_id());

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON audit_logs
  USING (organization_id = app_current_org_id())
  WITH CHECK (organization_id = app_current_org_id());

-- organizations is its own tenant key: visible when it is the current org, or a direct child of it
-- (reseller -> customer). No "parent sees everything" policy for other tables (ADR-0003).
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON organizations
  USING (id = app_current_org_id() OR parent_organization_id = app_current_org_id())
  WITH CHECK (id = app_current_org_id());

-- ---- Append-only audit log: privileges revoked + trigger as a second layer ----
REVOKE UPDATE, DELETE ON audit_logs FROM gps_app, gps_system;
CREATE FUNCTION reject_mutation() RETURNS trigger
LANGUAGE plpgsql
AS $$ BEGIN RAISE EXCEPTION '% on % is not allowed (append-only table)', TG_OP, TG_TABLE_NAME USING ERRCODE = '42501'; END $$;
CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION reject_mutation();

-- ---- Exactly one Organization Owner per organization (serialised with an advisory lock) ----
CREATE FUNCTION enforce_member_role_rules() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_role_key text;
  v_role_scope "RoleScope";
  v_org_type "OrganizationType";
BEGIN
  SELECT key, scope INTO v_role_key, v_role_scope FROM roles WHERE id = NEW.role_id;
  SELECT type INTO v_org_type FROM organizations WHERE id = NEW.organization_id;

  -- A role may only be granted inside an organization of the matching type.
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
      RAISE EXCEPTION 'organization % already has an owner', NEW.organization_id USING ERRCODE = '23505';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER member_roles_rules BEFORE INSERT OR UPDATE ON member_roles
  FOR EACH ROW EXECUTE FUNCTION enforce_member_role_rules();

-- ---- Reseller hierarchy: only RESELLER -> CUSTOMER, one level deep ----
CREATE FUNCTION enforce_org_hierarchy() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_parent organizations%ROWTYPE;
BEGIN
  IF NEW.parent_organization_id IS NOT NULL THEN
    SELECT * INTO v_parent FROM organizations WHERE id = NEW.parent_organization_id;
    IF v_parent.type <> 'RESELLER' OR v_parent.parent_organization_id IS NOT NULL OR NEW.type <> 'CUSTOMER' THEN
      RAISE EXCEPTION 'invalid organization hierarchy: only a RESELLER (top level) may parent a CUSTOMER'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER organizations_hierarchy BEFORE INSERT OR UPDATE OF parent_organization_id, type ON organizations
  FOR EACH ROW EXECUTE FUNCTION enforce_org_hierarchy();
