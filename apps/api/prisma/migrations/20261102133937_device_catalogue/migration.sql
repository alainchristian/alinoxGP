-- CreateEnum
CREATE TYPE "CompatibilityStatus" AS ENUM ('VERIFIED', 'SUPPORTED_UNVERIFIED', 'PARTIAL', 'UNSUPPORTED', 'REQUIRES_CONFIGURATION');

-- CreateEnum
CREATE TYPE "CapabilitySupport" AS ENUM ('SUPPORTED', 'PARTIAL', 'NOT_SUPPORTED', 'REQUIRES_CONFIGURATION');

-- CreateEnum
CREATE TYPE "IdentifierType" AS ENUM ('IMEI', 'SERIAL', 'OTHER');

-- CreateEnum
CREATE TYPE "ConsentKind" AS ENUM ('TRACKING_NOTICE');

-- CreateEnum
CREATE TYPE "ConsentNoticeStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'RETIRED');

-- CreateEnum
CREATE TYPE "SupportRequestStatus" AS ENUM ('OPEN', 'RESOLVED', 'DECLINED');

-- AlterTable
ALTER TABLE "gps_devices" ADD COLUMN     "firmware_version" TEXT,
ADD COLUMN     "serial_number" TEXT,
ADD COLUMN     "sim_iccid" TEXT,
ADD COLUMN     "variant_id" UUID;

-- CreateTable
CREATE TABLE "gps_manufacturers" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "website" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gps_manufacturers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gps_device_models" (
    "id" UUID NOT NULL,
    "manufacturer_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "protocol" TEXT NOT NULL,
    "engine_port" INTEGER,
    "network_technologies" TEXT[],
    "identifier_type" "IdentifierType" NOT NULL DEFAULT 'IMEI',
    "reporting_notes" TEXT,
    "configuration_notes" TEXT,
    "installation_requirements" TEXT,
    "known_limitations" TEXT,
    "docs_url" TEXT,
    "is_listed" BOOLEAN NOT NULL DEFAULT false,
    "is_simulator_profile" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "gps_device_models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gps_device_variants" (
    "id" UUID NOT NULL,
    "model_id" UUID NOT NULL,
    "hardware_revision" TEXT,
    "firmware_min" TEXT,
    "firmware_max" TEXT,
    "compatibility_status" "CompatibilityStatus" NOT NULL DEFAULT 'SUPPORTED_UNVERIFIED',
    "last_tested_at" TIMESTAMPTZ,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "gps_device_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "variant_capabilities" (
    "variant_id" UUID NOT NULL,
    "capability_key" TEXT NOT NULL,
    "support" "CapabilitySupport" NOT NULL,
    "evidence_attribute" TEXT,
    "evidence_notes" TEXT,
    "verified_at" TIMESTAMPTZ,

    CONSTRAINT "variant_capabilities_pkey" PRIMARY KEY ("variant_id","capability_key")
);

-- CreateTable
CREATE TABLE "variant_verifications" (
    "id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "tested_at" TIMESTAMPTZ NOT NULL,
    "tested_by_user_id" UUID,
    "tested_by_name" TEXT NOT NULL,
    "firmware_version" TEXT NOT NULL,
    "procedure" TEXT NOT NULL,
    "evidence" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "variant_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_status_history" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "from_status" "DeviceLifecycleStatus",
    "to_status" "DeviceLifecycleStatus" NOT NULL,
    "actor_user_id" UUID,
    "reason" TEXT,
    "at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent_notices" (
    "id" UUID NOT NULL,
    "kind" "ConsentKind" NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "ConsentNoticeStatus" NOT NULL DEFAULT 'DRAFT',
    "is_draft_wording" BOOLEAN NOT NULL DEFAULT true,
    "published_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consent_notices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent_records" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "notice_id" UUID NOT NULL,
    "device_id" UUID,
    "accepted_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consent_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_support_requests" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "requested_by" UUID NOT NULL,
    "manufacturer_text" TEXT NOT NULL,
    "model_text" TEXT NOT NULL,
    "firmware_text" TEXT,
    "notes" TEXT,
    "status" "SupportRequestStatus" NOT NULL DEFAULT 'OPEN',
    "resolution_note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ,

    CONSTRAINT "device_support_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "gps_device_models_manufacturer_id_idx" ON "gps_device_models"("manufacturer_id");

-- CreateIndex
CREATE INDEX "gps_device_variants_model_id_idx" ON "gps_device_variants"("model_id");

-- CreateIndex
CREATE INDEX "variant_verifications_variant_id_tested_at_idx" ON "variant_verifications"("variant_id", "tested_at" DESC);

-- CreateIndex
CREATE INDEX "device_status_history_organization_id_device_id_at_idx" ON "device_status_history"("organization_id", "device_id", "at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "consent_notices_kind_version_key" ON "consent_notices"("kind", "version");

-- CreateIndex
CREATE INDEX "consent_records_organization_id_accepted_at_idx" ON "consent_records"("organization_id", "accepted_at" DESC);

-- CreateIndex
CREATE INDEX "device_support_requests_organization_id_created_at_idx" ON "device_support_requests"("organization_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "device_support_requests_status_created_at_idx" ON "device_support_requests"("status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "gps_devices_variant_id_idx" ON "gps_devices"("variant_id");

-- AddForeignKey
ALTER TABLE "gps_devices" ADD CONSTRAINT "gps_devices_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "gps_device_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gps_device_models" ADD CONSTRAINT "gps_device_models_manufacturer_id_fkey" FOREIGN KEY ("manufacturer_id") REFERENCES "gps_manufacturers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gps_device_variants" ADD CONSTRAINT "gps_device_variants_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "gps_device_models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variant_capabilities" ADD CONSTRAINT "variant_capabilities_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "gps_device_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variant_verifications" ADD CONSTRAINT "variant_verifications_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "gps_device_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_status_history" ADD CONSTRAINT "device_status_history_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "gps_devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_notice_id_fkey" FOREIGN KEY ("notice_id") REFERENCES "consent_notices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =====================================================================================
-- Hand-written part (Prisma cannot express these): uniqueness, CHECKs, evidence rules, RLS, append-only history.
-- ADR-0009. The catalogue is GLOBAL (no organization_id): written by platform staff only (enforced in the API).
-- =====================================================================================

-- ---- Uniqueness ----
CREATE UNIQUE INDEX gps_manufacturers_name_unique ON gps_manufacturers (lower(btrim(name)));
CREATE UNIQUE INDEX gps_device_models_name_unique ON gps_device_models (manufacturer_id, lower(btrim(name)));

-- ---- CHECK constraints ----
ALTER TABLE gps_manufacturers ADD CONSTRAINT gps_manufacturers_name_length CHECK (length(btrim(name)) BETWEEN 1 AND 80);
ALTER TABLE gps_device_models ADD CONSTRAINT gps_device_models_name_length CHECK (length(btrim(name)) BETWEEN 1 AND 80);
ALTER TABLE gps_device_models ADD CONSTRAINT gps_device_models_port_range CHECK (engine_port IS NULL OR engine_port BETWEEN 1 AND 65535);
-- A simulator profile is never a physical device that could be listed as hardware for sale/installation.
ALTER TABLE variant_capabilities ADD CONSTRAINT variant_capabilities_key_known CHECK (capability_key IN (
  'gps_tracking','trip_history','ignition_detection','speed_monitoring','motion_detection','external_power_monitoring',
  'battery_monitoring','fuel_monitoring','digital_inputs','digital_outputs','driver_identification','sos_button',
  'towing_detection','remote_configuration','remote_immobilization'));
ALTER TABLE variant_verifications ADD CONSTRAINT variant_verifications_text_present CHECK (
  length(btrim(tested_by_name)) > 0 AND length(btrim(firmware_version)) > 0 AND length(btrim(procedure)) > 0 AND length(btrim(evidence)) > 0);
ALTER TABLE gps_devices ADD CONSTRAINT gps_devices_text_lengths CHECK (
  (firmware_version IS NULL OR length(firmware_version) <= 60) AND (serial_number IS NULL OR length(serial_number) <= 60));
ALTER TABLE gps_devices ADD CONSTRAINT gps_devices_iccid_format CHECK (sim_iccid IS NULL OR sim_iccid ~ '^[0-9]{18,22}$');
ALTER TABLE device_support_requests ADD CONSTRAINT device_support_requests_text CHECK (
  length(btrim(manufacturer_text)) BETWEEN 1 AND 80 AND length(btrim(model_text)) BETWEEN 1 AND 80
  AND (firmware_text IS NULL OR length(firmware_text) <= 60) AND (notes IS NULL OR length(notes) <= 2000));

-- ---- A variant is VERIFIED only with a recorded test, and never a simulator profile ----
CREATE FUNCTION enforce_variant_evidence_rules() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.compatibility_status = 'VERIFIED' THEN
    IF NOT EXISTS (SELECT 1 FROM variant_verifications v WHERE v.variant_id = NEW.id) THEN
      RAISE EXCEPTION 'a variant cannot be VERIFIED without a recorded verification (who, when, firmware, procedure, evidence)' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (SELECT 1 FROM gps_device_models m WHERE m.id = NEW.model_id AND m.is_simulator_profile) THEN
      RAISE EXCEPTION 'a simulator profile is not a physical device and cannot be VERIFIED' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER gps_device_variants_evidence BEFORE INSERT OR UPDATE ON gps_device_variants
  FOR EACH ROW EXECUTE FUNCTION enforce_variant_evidence_rules();

-- ---- Remote immobilization may only be marked supported on a VERIFIED variant (safety rule; the command path is M7) ----
CREATE FUNCTION enforce_immobilization_capability_rules() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.capability_key = 'remote_immobilization' AND NEW.support IN ('SUPPORTED', 'PARTIAL') THEN
    IF NOT EXISTS (SELECT 1 FROM gps_device_variants v WHERE v.id = NEW.variant_id AND v.compatibility_status = 'VERIFIED') THEN
      RAISE EXCEPTION 'remote_immobilization can only be marked supported on a VERIFIED variant' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER variant_capabilities_immobilization BEFORE INSERT OR UPDATE ON variant_capabilities
  FOR EACH ROW EXECUTE FUNCTION enforce_immobilization_capability_rules();

-- ---- Consent notices: a published notice never changes; it can only be retired ----
CREATE FUNCTION enforce_consent_notice_rules() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'a published or retired consent notice is never deleted' USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'RETIRED' THEN
    RAISE EXCEPTION 'a retired consent notice is immutable' USING ERRCODE = '42501';
  END IF;
  IF OLD.status = 'PUBLISHED' THEN
    IF NEW.kind <> OLD.kind OR NEW.version <> OLD.version OR NEW.title <> OLD.title OR NEW.body <> OLD.body
       OR NEW.is_draft_wording <> OLD.is_draft_wording OR NEW.published_at IS DISTINCT FROM OLD.published_at OR NEW.status NOT IN ('PUBLISHED', 'RETIRED') THEN
      RAISE EXCEPTION 'a published consent notice can only be retired, never edited' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER consent_notices_rules BEFORE UPDATE OR DELETE ON consent_notices
  FOR EACH ROW EXECUTE FUNCTION enforce_consent_notice_rules();

-- ---- Row-Level Security on the tenant tables (enabled AND forced), like every tenant table (ADR-0003) ----
ALTER TABLE device_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_status_history FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON device_status_history
  USING (organization_id = app_current_org_id()) WITH CHECK (organization_id = app_current_org_id());

ALTER TABLE consent_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE consent_records FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON consent_records
  USING (organization_id = app_current_org_id()) WITH CHECK (organization_id = app_current_org_id());

ALTER TABLE device_support_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_support_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON device_support_requests
  USING (organization_id = app_current_org_id()) WITH CHECK (organization_id = app_current_org_id());

-- ---- Append-only history: no UPDATE and no DELETE, for the application and system roles ----
REVOKE UPDATE, DELETE ON device_status_history FROM gps_app, gps_system;
REVOKE UPDATE, DELETE ON consent_records FROM gps_app, gps_system;
REVOKE UPDATE, DELETE ON variant_verifications FROM gps_app, gps_system;
