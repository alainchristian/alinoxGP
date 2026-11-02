-- CreateEnum
CREATE TYPE "DeviceLifecycleStatus" AS ENUM ('REGISTERED', 'AWAITING_CONFIGURATION', 'AWAITING_FIRST_SIGNAL', 'ACTIVE', 'CONFIGURATION_ERROR', 'SUSPENDED', 'RETIRED');

-- CreateEnum
CREATE TYPE "EngineSyncStatus" AS ENUM ('PENDING', 'SYNCED', 'FAILED');

-- CreateTable
CREATE TABLE "vehicles" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "registration_number" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gps_devices" (
    "id" UUID NOT NULL,
    "unique_id" TEXT NOT NULL,
    "name" TEXT,
    "owner_organization_id" UUID NOT NULL,
    "current_organization_id" UUID,
    "traccar_device_id" INTEGER,
    "engine_sync_status" "EngineSyncStatus" NOT NULL DEFAULT 'PENDING',
    "engine_sync_error" TEXT,
    "lifecycle_status" "DeviceLifecycleStatus" NOT NULL DEFAULT 'REGISTERED',
    "is_simulated" BOOLEAN NOT NULL DEFAULT false,
    "first_signal_at" TIMESTAMPTZ,
    "last_seen_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "gps_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_assignments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "assigned_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unassigned_at" TIMESTAMPTZ,
    "reason" TEXT,
    "assigned_by" UUID,
    "unassigned_by" UUID,

    CONSTRAINT "device_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_live_state" (
    "vehicle_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "speed_kmh" DOUBLE PRECISION,
    "heading" DOUBLE PRECISION,
    "ignition" BOOLEAN,
    "last_fix_at" TIMESTAMPTZ,
    "last_seen_at" TIMESTAMPTZ NOT NULL,
    "last_fix_invalid" BOOLEAN NOT NULL DEFAULT false,
    "simulated" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "vehicle_live_state_pkey" PRIMARY KEY ("vehicle_id")
);

-- CreateIndex
CREATE INDEX "vehicles_organization_id_created_at_idx" ON "vehicles"("organization_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_organization_id_id_key" ON "vehicles"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "gps_devices_unique_id_key" ON "gps_devices"("unique_id");

-- CreateIndex
CREATE UNIQUE INDEX "gps_devices_traccar_device_id_key" ON "gps_devices"("traccar_device_id");

-- CreateIndex
CREATE INDEX "gps_devices_owner_organization_id_idx" ON "gps_devices"("owner_organization_id");

-- CreateIndex
CREATE INDEX "gps_devices_current_organization_id_idx" ON "gps_devices"("current_organization_id");

-- CreateIndex
CREATE INDEX "device_assignments_organization_id_vehicle_id_assigned_at_idx" ON "device_assignments"("organization_id", "vehicle_id", "assigned_at" DESC);

-- CreateIndex
CREATE INDEX "device_assignments_device_id_assigned_at_idx" ON "device_assignments"("device_id", "assigned_at" DESC);

-- CreateIndex
CREATE INDEX "vehicle_live_state_organization_id_last_seen_at_idx" ON "vehicle_live_state"("organization_id", "last_seen_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_live_state_organization_id_vehicle_id_key" ON "vehicle_live_state"("organization_id", "vehicle_id");

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gps_devices" ADD CONSTRAINT "gps_devices_owner_organization_id_fkey" FOREIGN KEY ("owner_organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gps_devices" ADD CONSTRAINT "gps_devices_current_organization_id_fkey" FOREIGN KEY ("current_organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_assignments" ADD CONSTRAINT "device_assignments_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "gps_devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_assignments" ADD CONSTRAINT "device_assignments_organization_id_vehicle_id_fkey" FOREIGN KEY ("organization_id", "vehicle_id") REFERENCES "vehicles"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_live_state" ADD CONSTRAINT "vehicle_live_state_organization_id_vehicle_id_fkey" FOREIGN KEY ("organization_id", "vehicle_id") REFERENCES "vehicles"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;


-- =====================================================================================
-- Hand-written section (not expressible in Prisma schema). See docs/adr/0003, 0005, skills
-- gps-tenant-isolation / gps-device-catalogue / gps-simulator.
-- =====================================================================================

-- ---- Partial / expression unique indexes ----
-- Registration numbers are unique per organization, case-insensitively, among non-deleted vehicles.
CREATE UNIQUE INDEX vehicles_registration_unique_active
  ON vehicles (organization_id, upper(btrim(registration_number))) WHERE deleted_at IS NULL;
-- A device is installed on at most one vehicle at a time, and a vehicle carries at most one device.
CREATE UNIQUE INDEX device_assignments_one_open_per_device ON device_assignments (device_id) WHERE unassigned_at IS NULL;
CREATE UNIQUE INDEX device_assignments_one_open_per_vehicle ON device_assignments (vehicle_id) WHERE unassigned_at IS NULL;

-- ---- CHECK constraints ----
ALTER TABLE vehicles ADD CONSTRAINT vehicles_registration_not_blank CHECK (length(btrim(registration_number)) BETWEEN 1 AND 20);
ALTER TABLE gps_devices ADD CONSTRAINT gps_devices_unique_id_length CHECK (length(btrim(unique_id)) BETWEEN 3 AND 64);
-- Simulated devices are recognisable by the SIM- prefix AND flagged; the two can never disagree (gps-simulator §2).
ALTER TABLE gps_devices ADD CONSTRAINT gps_devices_simulated_matches_prefix CHECK ((unique_id LIKE 'SIM-%') = is_simulated);
ALTER TABLE device_assignments ADD CONSTRAINT device_assignments_window_valid CHECK (unassigned_at IS NULL OR unassigned_at >= assigned_at);

-- ---- Row-Level Security (enabled AND forced) ----
ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicles FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON vehicles
  USING (organization_id = app_current_org_id()) WITH CHECK (organization_id = app_current_org_id());

ALTER TABLE device_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_assignments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON device_assignments
  USING (organization_id = app_current_org_id()) WITH CHECK (organization_id = app_current_org_id());

ALTER TABLE vehicle_live_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_live_state FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON vehicle_live_state
  USING (organization_id = app_current_org_id()) WITH CHECK (organization_id = app_current_org_id());

-- A device is visible to the organization that OWNS the hardware and to the one currently OPERATING it
-- (ownership and operation differ for hardware we sell or that a reseller supplies — ADR-0003).
ALTER TABLE gps_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE gps_devices FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON gps_devices
  USING (owner_organization_id = app_current_org_id() OR current_organization_id = app_current_org_id())
  WITH CHECK (owner_organization_id = app_current_org_id() OR current_organization_id = app_current_org_id());

-- ---- Simulated devices may only belong to sandbox organizations (production guard, gps-simulator §2) ----
CREATE FUNCTION enforce_simulated_device_rules() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE v_sandbox boolean;
BEGIN
  IF NEW.is_simulated THEN
    SELECT is_sandbox INTO v_sandbox FROM organizations WHERE id = NEW.owner_organization_id;
    IF v_sandbox IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'simulated device % may only be owned by a sandbox organization', NEW.unique_id USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER gps_devices_simulated_sandbox_only BEFORE INSERT OR UPDATE OF is_simulated, owner_organization_id, unique_id ON gps_devices
  FOR EACH ROW EXECUTE FUNCTION enforce_simulated_device_rules();

-- ---- Device assignment history: validated on insert, closed rows immutable, never deleted ----
CREATE FUNCTION enforce_device_assignment_rules() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE v_owner uuid; v_current uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'device_assignments rows are never deleted (history)' USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT owner_organization_id, current_organization_id INTO v_owner, v_current FROM gps_devices WHERE id = NEW.device_id;
    IF v_owner IS NULL OR (v_owner <> NEW.organization_id AND v_current IS DISTINCT FROM NEW.organization_id) THEN
      RAISE EXCEPTION 'device % is not owned or operated by organization %', NEW.device_id, NEW.organization_id USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: only an open row may be closed; nothing else may change.
  IF OLD.unassigned_at IS NOT NULL THEN
    RAISE EXCEPTION 'closed device assignment is immutable' USING ERRCODE = '42501';
  END IF;
  IF NEW.organization_id <> OLD.organization_id OR NEW.device_id <> OLD.device_id OR NEW.vehicle_id <> OLD.vehicle_id
     OR NEW.assigned_at <> OLD.assigned_at OR NEW.assigned_by IS DISTINCT FROM OLD.assigned_by THEN
    RAISE EXCEPTION 'only unassignment fields of a device assignment may change' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER device_assignments_rules BEFORE INSERT OR UPDATE OR DELETE ON device_assignments
  FOR EACH ROW EXECUTE FUNCTION enforce_device_assignment_rules();
REVOKE DELETE ON device_assignments FROM gps_app, gps_system;
