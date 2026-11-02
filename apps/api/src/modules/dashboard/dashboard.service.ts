import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { EXPIRY_SOON_DAYS, expiryOf, P, VEHICLE_STATUSES, type AttentionItemDto, type DashboardDto, type DeviceLifecycleStatus, type VehicleStatus } from '@gps/shared';
import { dateOnly, OrgClockService } from '../../common/org-clock.service';
import type { AppClsStore } from '../../common/request-context';
import { TenantPrismaService } from '../../infrastructure/prisma/prisma.service';
import { toAlertDto } from '../alerts/alert.service';
import { LiveStateStore } from '../live-state/live-state.store';
import { StatusConfigService } from '../live-state/status-config.service';

/** An installed device that has never reported anything is flagged only after this long, so a fresh installation is not a warning. */
export const NEVER_REPORTED_GRACE_MS = 60 * 60 * 1000;
const ATTENTION_LIMIT = 20;
const RECENT_ALERTS = 5;

const DOCUMENT_LABEL = { INSURANCE: 'Insurance', INSPECTION: 'Inspection', REGISTRATION: 'Registration', PERMIT: 'Permit', OTHER: 'Document' } as const;

/**
 * The dashboard shows only what the platform really knows today: counts of records and papers that need attention.
 * Distance, utilisation, trips and notifications are NOT here — they do not exist yet (M6 / M8) and are never invented.
 * Each section is returned only if the viewer holds the permission to read that data (null otherwise).
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly tenant: TenantPrismaService,
    private readonly clock: OrgClockService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly store: LiveStateStore,
    private readonly statusConfig: StatusConfigService,
  ) {}

  async get(now: Date = new Date()): Promise<DashboardDto> {
    const perms = this.cls.get('tenant')!.permissions;
    const canDrivers = perms.has(P.DRIVERS_READ);
    const canDevices = perms.has(P.DEVICES_READ);
    const canAlerts = perms.has(P.ALERTS_READ);
    const canLive = perms.has(P.TRACKING_LIVE_VIEW);
    const today = await this.clock.today(now);
    // Papers that expire on or before this date are "attention" (already expired, or expiring within the window).
    const horizon = new Date(`${today}T00:00:00Z`);
    horizon.setUTCDate(horizon.getUTCDate() + EXPIRY_SOON_DAYS);

    return this.tenant.run(async (tx) => {
      const openDevice = { unassignedAt: null } as const;
      const live = { deletedAt: null } as const;

      const [vehicleTotal, withDevice, withDriver, categories, categoryNames] = await Promise.all([
        tx.vehicle.count({ where: live }),
        tx.vehicle.count({ where: { ...live, assignments: { some: openDevice } } }),
        tx.vehicle.count({ where: { ...live, driverAssignments: { some: { unassignedAt: null } } } }),
        tx.vehicle.groupBy({ by: ['categoryId'], where: live, _count: { _all: true } }),
        tx.vehicleCategory.findMany({ select: { id: true, name: true } }),
      ]);
      const names = new Map(categoryNames.map((c) => [c.id, c.name]));
      const byCategory = categories
        .map((c) => ({ id: c.categoryId, name: c.categoryId ? (names.get(c.categoryId) ?? 'Unknown') : 'No category', count: c._count._all }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

      const attention: AttentionItemDto[] = [];
      const addPaper = (kind: AttentionItemDto['kind'], subject: AttentionItemDto['subject'], title: string, date: string | null) => {
        const e = expiryOf(date, today);
        if (e && e.status !== 'OK') attention.push({ kind, severity: e.status, subject, title, date: e.date, daysLeft: e.daysLeft });
      };

      const vehicles = await tx.vehicle.findMany({
        where: { ...live, OR: [{ insuranceExpiry: { lte: horizon } }, { inspectionExpiry: { lte: horizon } }] },
        select: { id: true, registrationNumber: true, insuranceExpiry: true, inspectionExpiry: true },
        take: 500,
      });
      for (const v of vehicles) {
        const subject = { type: 'vehicle', id: v.id, label: v.registrationNumber } as const;
        addPaper('VEHICLE_INSURANCE', subject, 'Insurance', dateOnly(v.insuranceExpiry));
        addPaper('VEHICLE_INSPECTION', subject, 'Inspection', dateOnly(v.inspectionExpiry));
      }
      const documents = await tx.vehicleDocument.findMany({
        where: { deletedAt: null, expiresOn: { lte: horizon }, vehicle: { deletedAt: null } },
        select: { id: true, type: true, title: true, expiresOn: true, vehicle: { select: { id: true, registrationNumber: true } } },
        take: 500,
      });
      for (const d of documents) {
        addPaper('VEHICLE_DOCUMENT', { type: 'vehicle', id: d.vehicle.id, label: d.vehicle.registrationNumber }, `${DOCUMENT_LABEL[d.type]}: ${d.title}`, dateOnly(d.expiresOn));
      }

      let drivers: DashboardDto['drivers'] = null;
      if (canDrivers) {
        const [total, active, assigned, expiring] = await Promise.all([
          tx.driver.count({ where: live }),
          tx.driver.count({ where: { ...live, status: 'ACTIVE' } }),
          tx.driver.count({ where: { ...live, assignments: { some: { unassignedAt: null } } } }),
          tx.driver.findMany({ where: { ...live, licenseExpiry: { lte: horizon } }, select: { id: true, fullName: true, licenseExpiry: true }, take: 500 }),
        ]);
        drivers = { total, active, assigned, unassigned: total - assigned };
        for (const d of expiring) addPaper('DRIVER_LICENSE', { type: 'driver', id: d.id, label: d.fullName }, 'Driving licence', dateOnly(d.licenseExpiry));
      }

      let devices: DashboardDto['devices'] = null;
      if (canDevices) {
        const cutoff = new Date(now.getTime() - NEVER_REPORTED_GRACE_MS);
        const [total, lifecycle, installed, silent] = await Promise.all([
          tx.gpsDevice.count(),
          tx.gpsDevice.groupBy({ by: ['lifecycleStatus'], _count: { _all: true } }),
          tx.deviceAssignment.count({ where: openDevice }),
          tx.deviceAssignment.findMany({
            where: { ...openDevice, assignedAt: { lte: cutoff }, device: { lastSeenAt: null }, vehicle: { deletedAt: null } },
            select: { device: { select: { id: true, uniqueId: true } }, vehicle: { select: { registrationNumber: true } } },
            take: 500,
          }),
        ]);
        const byLifecycle: Partial<Record<DeviceLifecycleStatus, number>> = {};
        for (const l of lifecycle) byLifecycle[l.lifecycleStatus] = l._count._all;
        devices = { total, byLifecycle, installed, notInstalled: Math.max(0, total - installed), installedNeverReported: silent.length };
        for (const s of silent) {
          attention.push({
            kind: 'DEVICE_NO_SIGNAL',
            severity: 'WARNING',
            subject: { type: 'device', id: s.device.id, label: s.device.uniqueId },
            title: `Installed on ${s.vehicle.registrationNumber}, no signal received yet`,
            date: null,
            daysLeft: null,
          });
        }
      }

      let alerts: DashboardDto['alerts'] = null;
      if (canAlerts) {
        const [unacknowledged, recent] = await Promise.all([
          tx.alert.count({ where: { acknowledgedAt: null } }),
          tx.alert.findMany({ include: { vehicle: { select: { registrationNumber: true } } }, orderBy: { startedAt: 'desc' }, take: RECENT_ALERTS }),
        ]);
        alerts = { unacknowledged, recent: recent.map(toAlertDto) };
      }

      // Status of vehicles with a tracker, from the live-state store and the one shared rule (same as the map and /tracking/summary).
      let status: DashboardDto['status'] = null;
      if (canLive) {
        const byStatus = Object.fromEntries(VEHICLE_STATUSES.map((s) => [s, 0])) as Record<VehicleStatus, number>;
        const states = await this.store.list(this.cls.get('tenant')!.organizationId);
        const known = states.length === 0 ? [] : await tx.vehicle.findMany({ where: { id: { in: states.map((s) => s.vehicleId) }, deletedAt: null }, select: { id: true } });
        const alive = new Set(known.map((v) => v.id));
        let counted = 0;
        for (const s of states) {
          if (!alive.has(s.vehicleId)) continue;
          byStatus[this.statusConfig.derive(s, now)]++;
          counted++;
        }
        // A vehicle with a tracker that has not reported yet is NO_DATA, as on the map.
        const withTracker = await tx.deviceAssignment.count({ where: { unassignedAt: null, vehicle: { deletedAt: null } } });
        byStatus.NO_DATA += Math.max(0, withTracker - counted);
        status = { total: Object.values(byStatus).reduce((a, b) => a + b, 0), byStatus };
      }

      // Expired first, then the soonest to expire, then warnings; ties keep a stable order.
      const rank = { EXPIRED: 0, EXPIRING_SOON: 1, WARNING: 2 } as const;
      attention.sort((a, b) => rank[a.severity] - rank[b.severity] || (a.daysLeft ?? 0) - (b.daysLeft ?? 0) || a.subject.label.localeCompare(b.subject.label));

      return {
        generatedAt: now.toISOString(),
        vehicles: { total: vehicleTotal, withDevice, withoutDevice: vehicleTotal - withDevice, withDriver, withoutDriver: vehicleTotal - withDriver, byCategory },
        drivers,
        devices,
        status,
        alerts,
        attention: attention.slice(0, ATTENTION_LIMIT),
        attentionTotal: attention.length,
      };
    });
  }
}
