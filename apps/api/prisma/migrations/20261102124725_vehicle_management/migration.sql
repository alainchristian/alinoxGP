-- CreateEnum
CREATE TYPE "VehicleType" AS ENUM ('CAR', 'MOTORCYCLE', 'TRUCK', 'VAN', 'BUS', 'PICKUP', 'TRACTOR', 'OTHER');

-- CreateEnum
CREATE TYPE "FuelType" AS ENUM ('PETROL', 'DIESEL', 'ELECTRIC', 'HYBRID', 'LPG', 'OTHER');

-- CreateEnum
CREATE TYPE "DriverStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "VehicleDocumentType" AS ENUM ('INSURANCE', 'INSPECTION', 'REGISTRATION', 'PERMIT', 'OTHER');

-- AlterTable
ALTER TABLE "vehicles" ADD COLUMN     "category_id" UUID,
ADD COLUMN     "color" TEXT,
ADD COLUMN     "fuel_type" "FuelType",
ADD COLUMN     "inspection_expiry" DATE,
ADD COLUMN     "insurance_expiry" DATE,
ADD COLUMN     "make" TEXT,
ADD COLUMN     "model" TEXT,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "vehicle_type" "VehicleType",
ADD COLUMN     "vin" TEXT,
ADD COLUMN     "year" SMALLINT;

-- CreateTable
CREATE TABLE "vehicle_categories" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "vehicle_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drivers" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "full_name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "license_number" TEXT,
    "license_class" TEXT,
    "license_expiry" DATE,
    "status" "DriverStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "drivers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_assignments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "driver_id" UUID NOT NULL,
    "assigned_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unassigned_at" TIMESTAMPTZ,
    "reason" TEXT,
    "assigned_by" UUID,
    "unassigned_by" UUID,

    CONSTRAINT "driver_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_documents" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "type" "VehicleDocumentType" NOT NULL,
    "title" TEXT NOT NULL,
    "reference_number" TEXT,
    "issued_on" DATE,
    "expires_on" DATE,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "vehicle_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_categories_organization_id_id_key" ON "vehicle_categories"("organization_id", "id");

-- CreateIndex
CREATE INDEX "drivers_organization_id_created_at_idx" ON "drivers"("organization_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "drivers_organization_id_id_key" ON "drivers"("organization_id", "id");

-- CreateIndex
CREATE INDEX "driver_assignments_organization_id_vehicle_id_assigned_at_idx" ON "driver_assignments"("organization_id", "vehicle_id", "assigned_at" DESC);

-- CreateIndex
CREATE INDEX "driver_assignments_organization_id_driver_id_assigned_at_idx" ON "driver_assignments"("organization_id", "driver_id", "assigned_at" DESC);

-- CreateIndex
CREATE INDEX "vehicle_documents_organization_id_vehicle_id_created_at_idx" ON "vehicle_documents"("organization_id", "vehicle_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "vehicle_documents_organization_id_expires_on_idx" ON "vehicle_documents"("organization_id", "expires_on");

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_organization_id_category_id_fkey" FOREIGN KEY ("organization_id", "category_id") REFERENCES "vehicle_categories"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_categories" ADD CONSTRAINT "vehicle_categories_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_assignments" ADD CONSTRAINT "driver_assignments_organization_id_vehicle_id_fkey" FOREIGN KEY ("organization_id", "vehicle_id") REFERENCES "vehicles"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_assignments" ADD CONSTRAINT "driver_assignments_organization_id_driver_id_fkey" FOREIGN KEY ("organization_id", "driver_id") REFERENCES "drivers"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_documents" ADD CONSTRAINT "vehicle_documents_organization_id_vehicle_id_fkey" FOREIGN KEY ("organization_id", "vehicle_id") REFERENCES "vehicles"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =====================================================================================
-- Hand-written part (Prisma cannot express these): uniqueness rules, CHECKs, RLS, history protection.
-- =====================================================================================

-- ---- Partial / expression unique indexes ----
-- Category names are unique per organization, ignoring case and surrounding spaces.
CREATE UNIQUE INDEX vehicle_categories_name_unique ON vehicle_categories (organization_id, lower(btrim(name)));
-- A VIN identifies one vehicle: unique per organization among non-deleted vehicles (stored upper-case).
CREATE UNIQUE INDEX vehicles_vin_unique_active ON vehicles (organization_id, vin) WHERE vin IS NOT NULL AND deleted_at IS NULL;
-- A licence number identifies one driver per organization among non-deleted drivers.
CREATE UNIQUE INDEX drivers_license_unique_active ON drivers (organization_id, upper(btrim(license_number))) WHERE license_number IS NOT NULL AND deleted_at IS NULL;
-- A vehicle has at most one ASSIGNED driver at a time, and a driver is assigned to at most one vehicle at a time.
CREATE UNIQUE INDEX driver_assignments_one_open_per_vehicle ON driver_assignments (vehicle_id) WHERE unassigned_at IS NULL;
CREATE UNIQUE INDEX driver_assignments_one_open_per_driver ON driver_assignments (driver_id) WHERE unassigned_at IS NULL;

-- ---- CHECK constraints (the API validates too; the database is the last line) ----
ALTER TABLE vehicles ADD CONSTRAINT vehicles_year_range CHECK (year IS NULL OR year BETWEEN 1900 AND 2100);
ALTER TABLE vehicles ADD CONSTRAINT vehicles_vin_format CHECK (vin IS NULL OR vin ~ '^[A-Z0-9]{5,30}$');
ALTER TABLE vehicles ADD CONSTRAINT vehicles_text_lengths CHECK (
  (make IS NULL OR length(make) <= 60) AND (model IS NULL OR length(model) <= 60) AND (color IS NULL OR length(color) <= 40)
  AND (notes IS NULL OR length(notes) <= 2000)
);
ALTER TABLE vehicle_categories ADD CONSTRAINT vehicle_categories_name_length CHECK (length(btrim(name)) BETWEEN 1 AND 60);
ALTER TABLE vehicle_categories ADD CONSTRAINT vehicle_categories_color_format CHECK (color IS NULL OR color ~ '^#[0-9a-fA-F]{6}$');
ALTER TABLE drivers ADD CONSTRAINT drivers_name_length CHECK (length(btrim(full_name)) BETWEEN 1 AND 120);
ALTER TABLE drivers ADD CONSTRAINT drivers_phone_e164 CHECK (phone IS NULL OR phone ~ '^\+[1-9][0-9]{6,14}$');
ALTER TABLE drivers ADD CONSTRAINT drivers_email_shape CHECK (email IS NULL OR (length(email) <= 254 AND email ~ '^[^@\s]+@[^@\s]+$'));
ALTER TABLE drivers ADD CONSTRAINT drivers_text_lengths CHECK (
  (license_number IS NULL OR length(btrim(license_number)) BETWEEN 1 AND 40) AND (license_class IS NULL OR length(license_class) <= 20)
  AND (notes IS NULL OR length(notes) <= 2000)
);
ALTER TABLE driver_assignments ADD CONSTRAINT driver_assignments_window_valid CHECK (unassigned_at IS NULL OR unassigned_at >= assigned_at);
ALTER TABLE vehicle_documents ADD CONSTRAINT vehicle_documents_title_length CHECK (length(btrim(title)) BETWEEN 1 AND 120);
ALTER TABLE vehicle_documents ADD CONSTRAINT vehicle_documents_text_lengths CHECK (
  (reference_number IS NULL OR length(reference_number) <= 60) AND (notes IS NULL OR length(notes) <= 2000)
);
ALTER TABLE vehicle_documents ADD CONSTRAINT vehicle_documents_dates_ordered CHECK (issued_on IS NULL OR expires_on IS NULL OR expires_on >= issued_on);

-- ---- Row-Level Security (enabled AND forced), like every tenant table (ADR-0003) ----
ALTER TABLE vehicle_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_categories FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON vehicle_categories
  USING (organization_id = app_current_org_id()) WITH CHECK (organization_id = app_current_org_id());

ALTER TABLE drivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE drivers FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON drivers
  USING (organization_id = app_current_org_id()) WITH CHECK (organization_id = app_current_org_id());

ALTER TABLE driver_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE driver_assignments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON driver_assignments
  USING (organization_id = app_current_org_id()) WITH CHECK (organization_id = app_current_org_id());

ALTER TABLE vehicle_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_documents FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON vehicle_documents
  USING (organization_id = app_current_org_id()) WITH CHECK (organization_id = app_current_org_id());

-- ---- Driver assignment history: closed rows are immutable, nothing is ever deleted ----
CREATE FUNCTION enforce_driver_assignment_rules() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'driver_assignments rows are never deleted (history)' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;
  -- UPDATE: only an open row may be closed; nothing else may change.
  IF OLD.unassigned_at IS NOT NULL THEN
    RAISE EXCEPTION 'closed driver assignment is immutable' USING ERRCODE = '42501';
  END IF;
  IF NEW.organization_id <> OLD.organization_id OR NEW.driver_id <> OLD.driver_id OR NEW.vehicle_id <> OLD.vehicle_id
     OR NEW.assigned_at <> OLD.assigned_at OR NEW.assigned_by IS DISTINCT FROM OLD.assigned_by THEN
    RAISE EXCEPTION 'only unassignment fields of a driver assignment may change' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER driver_assignments_rules BEFORE INSERT OR UPDATE OR DELETE ON driver_assignments
  FOR EACH ROW EXECUTE FUNCTION enforce_driver_assignment_rules();
REVOKE DELETE ON driver_assignments FROM gps_app, gps_system;
