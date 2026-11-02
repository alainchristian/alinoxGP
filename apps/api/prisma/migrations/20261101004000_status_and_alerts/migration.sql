-- CreateEnum
CREATE TYPE "VehicleStatus" AS ENUM ('NO_DATA', 'OFFLINE', 'MOVING', 'IDLING', 'PARKED', 'STATIONARY');

-- CreateEnum
CREATE TYPE "AlertType" AS ENUM ('OVERSPEED', 'IGNITION_ON', 'IGNITION_OFF', 'DEVICE_OFFLINE');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- AlterTable
ALTER TABLE "vehicle_live_state" ADD COLUMN     "last_fix_delayed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "motion" BOOLEAN,
ADD COLUMN     "stationary_since" TIMESTAMPTZ,
ADD COLUMN     "status" "VehicleStatus" NOT NULL DEFAULT 'NO_DATA',
ADD COLUMN     "status_changed_at" TIMESTAMPTZ;

-- CreateTable
CREATE TABLE "alert_rules" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "type" "AlertType" NOT NULL,
    "params" JSONB NOT NULL DEFAULT '{}',
    "severity" "AlertSeverity" NOT NULL DEFAULT 'WARNING',
    "cooldown_seconds" INTEGER NOT NULL DEFAULT 300,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "alert_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alerts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "rule_id" UUID,
    "type" "AlertType" NOT NULL,
    "severity" "AlertSeverity" NOT NULL,
    "started_at" TIMESTAMPTZ NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "simulated" BOOLEAN NOT NULL DEFAULT false,
    "delayed" BOOLEAN NOT NULL DEFAULT false,
    "acknowledged_by" UUID,
    "acknowledged_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "alert_rules_organization_id_type_enabled_idx" ON "alert_rules"("organization_id", "type", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "alert_rules_organization_id_id_key" ON "alert_rules"("organization_id", "id");

-- CreateIndex
CREATE INDEX "alerts_organization_id_started_at_idx" ON "alerts"("organization_id", "started_at" DESC);

-- CreateIndex
CREATE INDEX "alerts_organization_id_vehicle_id_type_started_at_idx" ON "alerts"("organization_id", "vehicle_id", "type", "started_at" DESC);

-- AddForeignKey
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_organization_id_vehicle_id_fkey" FOREIGN KEY ("organization_id", "vehicle_id") REFERENCES "vehicles"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "alert_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- =====================================================================================
-- Hand-written section (see docs/adr/0003, skill gps-tenant-isolation §3).
-- =====================================================================================
ALTER TABLE alert_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_rules FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON alert_rules
  USING (organization_id = app_current_org_id()) WITH CHECK (organization_id = app_current_org_id());

ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON alerts
  USING (organization_id = app_current_org_id()) WITH CHECK (organization_id = app_current_org_id());

ALTER TABLE alert_rules ADD CONSTRAINT alert_rules_cooldown_range CHECK (cooldown_seconds BETWEEN 0 AND 86400);
-- An alert is either unacknowledged or acknowledged by someone at some time — never half of each.
ALTER TABLE alerts ADD CONSTRAINT alerts_ack_consistent CHECK ((acknowledged_at IS NULL) = (acknowledged_by IS NULL));
-- An overspeed rule must carry a limit (the API validates the full shape; this is the backstop).
ALTER TABLE alert_rules ADD CONSTRAINT alert_rules_overspeed_has_limit
  CHECK (type <> 'OVERSPEED' OR (params ? 'speedLimitKmh' AND (params->>'speedLimitKmh')::numeric > 0));
