import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  canTransition,
  deviceConnectivity,
  deviceDisplayStatus,
  FIRST_SIGNAL_STUCK_AFTER_HOURS,
  type AdminDeviceRowDto,
  type DeviceDiagnosticsDto,
  type DeviceLifecycleStatus,
} from '@gps/shared';
import { AppException, notFound } from '../../common/errors';
import { PagedResult } from '../../common/response';
import type { AppClsStore } from '../../common/request-context';
import { SystemPrismaService } from '../../infrastructure/prisma/prisma.service';
import { GPS_ENGINE, type GpsEnginePort } from '../../integrations/gps-engine/port';
import { AuditService } from '../audit/audit.service';
import { DeviceCapabilitiesService } from '../devices/device-capabilities.service';
import { DeviceEngineSyncService } from '../devices/device-engine-sync.service';
import { LifecycleError, transitionDevice } from '../devices/device-lifecycle';
import { assertVariantFits, labelOf, variantInclude } from '../devices/device-variant';
import { LiveStateStore } from '../live-state/live-state.store';
import { StatusConfigService } from '../live-state/status-config.service';
import { ClsService } from 'nestjs-cls';

const include = {
  variant: { include: variantInclude },
  owner: { select: { id: true, name: true } },
  current: { select: { id: true, name: true } },
} satisfies Prisma.GpsDeviceInclude;
type Row = Prisma.GpsDeviceGetPayload<{ include: typeof include }>;

/**
 * Platform-staff device tools (spec Module 7: "tools for diagnosing device communication problems").
 * Cross-tenant BY NATURE, so it uses the system role — a reviewed use (see SystemPrismaService). It is READ-ONLY except
 * for three audited actions: change the lifecycle status, identify the model, re-sync with the engine.
 * It exposes device identifiers and organization names to staff holding `platform.devices.diagnose`; no coordinates.
 */
@Injectable()
export class DeviceAdminService {
  constructor(
    private readonly system: SystemPrismaService,
    private readonly store: LiveStateStore,
    private readonly statusConfig: StatusConfigService,
    private readonly capabilities: DeviceCapabilitiesService,
    private readonly sync: DeviceEngineSyncService,
    private readonly audit: AuditService,
    private readonly cls: ClsService<AppClsStore>,
    @Inject(GPS_ENGINE) private readonly engine: GpsEnginePort,
  ) {}

  /** When the device entered AWAITING_FIRST_SIGNAL (from its history); null if it is not waiting. */
  private async waitingSince(row: Row): Promise<Date | null> {
    if (row.lifecycleStatus !== 'AWAITING_FIRST_SIGNAL' || row.firstSignalAt) return null;
    const h = await this.system.deviceStatusHistory.findFirst({ where: { deviceId: row.id, toStatus: 'AWAITING_FIRST_SIGNAL' }, orderBy: { at: 'desc' }, select: { at: true } });
    return h?.at ?? row.createdAt;
  }
  private tooLong(since: Date | null, now: Date) {
    return !!since && (now.getTime() - since.getTime()) / 3_600_000 > FIRST_SIGNAL_STUCK_AFTER_HOURS;
  }

  private rowDto(row: Row, now: Date, stuck: boolean): AdminDeviceRowDto {
    const connectivity = deviceConnectivity(row.lastSeenAt, now, this.statusConfig.thresholds.offlineAfterSec);
    return {
      id: row.id,
      uniqueId: row.uniqueId,
      organizationName: (row.current ?? row.owner)?.name ?? null,
      lifecycleStatus: row.lifecycleStatus,
      displayStatus: deviceDisplayStatus(row.lifecycleStatus, connectivity),
      isSimulated: row.isSimulated,
      variantLabel: row.variant ? labelOf(row.variant) : null,
      lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      awaitingFirstSignalTooLong: stuck,
    };
  }

  async list(page: number, pageSize: number, f: { q?: string; status?: DeviceLifecycleStatus; stuck?: boolean }): Promise<PagedResult<AdminDeviceRowDto>> {
    const now = new Date();
    const where: Prisma.GpsDeviceWhereInput = {
      ...(f.q ? { OR: [{ uniqueId: { contains: f.q, mode: 'insensitive' } }, { name: { contains: f.q, mode: 'insensitive' } }, { serialNumber: { contains: f.q, mode: 'insensitive' } }] } : {}),
      ...(f.status ? { lifecycleStatus: f.status } : {}),
      ...(f.stuck ? { lifecycleStatus: 'AWAITING_FIRST_SIGNAL', firstSignalAt: null } : {}),
    };
    if (f.stuck) {
      // "Waiting too long" is computed from the history, so filter in memory over the (small) set of waiting devices.
      const waiting = await this.system.gpsDevice.findMany({ where, include, orderBy: { createdAt: 'asc' }, take: 1000 });
      const flagged: Row[] = [];
      for (const r of waiting) if (this.tooLong(await this.waitingSince(r), now)) flagged.push(r);
      const slice = flagged.slice((page - 1) * pageSize, page * pageSize);
      return new PagedResult(slice.map((r) => this.rowDto(r, now, true)), { page, pageSize, total: flagged.length });
    }
    const [total, rows] = await Promise.all([
      this.system.gpsDevice.count({ where }),
      this.system.gpsDevice.findMany({ where, include, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
    ]);
    const dtos: AdminDeviceRowDto[] = [];
    for (const r of rows) dtos.push(this.rowDto(r, now, this.tooLong(await this.waitingSince(r), now)));
    return new PagedResult(dtos, { page, pageSize, total });
  }

  private async row(id: string): Promise<Row> {
    const r = await this.system.gpsDevice.findUnique({ where: { id }, include });
    if (!r) throw notFound('DEVICE_NOT_FOUND');
    return r;
  }

  async diagnostics(id: string): Promise<DeviceDiagnosticsDto> {
    const now = new Date();
    const r = await this.row(id);
    const connectivity = deviceConnectivity(r.lastSeenAt, now, this.statusConfig.thresholds.offlineAfterSec);
    const open = await this.system.deviceAssignment.findFirst({ where: { deviceId: id, unassignedAt: null }, select: { organizationId: true, vehicleId: true } });
    const state = open ? await this.store.get(open.organizationId, open.vehicleId) : null;
    const caps = this.capabilities.compute(id, r.variant, state, now);
    const history = await this.system.deviceStatusHistory.findMany({ where: { deviceId: id }, orderBy: { at: 'desc' }, take: 50 });

    // The engine is asked read-only; if it cannot be reached that is a finding, not an error.
    let engine: DeviceDiagnosticsDto['engine'] = { reachable: false, known: false, engineStatus: null, lastUpdate: null, syncStatus: r.engineSyncStatus, syncError: r.engineSyncError, protocol: r.variant?.model.protocol ?? null };
    try {
      const ed = await this.engine.findDeviceByUniqueId(r.uniqueId);
      engine = { ...engine, reachable: true, known: !!ed, engineStatus: ed?.engineStatus ?? null, lastUpdate: ed?.lastUpdate?.toISOString() ?? null };
    } catch {
      /* reachable stays false */
    }

    const since = await this.waitingSince(r);
    const notes: string[] = [];
    if (!r.variant) notes.push('The device model has not been identified, so no capability can be confirmed.');
    if (r.engineSyncStatus !== 'SYNCED') notes.push(`The device is not synchronised with the GPS engine (${r.engineSyncStatus.toLowerCase()}).`);
    else if (engine.reachable && !engine.known) notes.push('The platform believes the device is synchronised, but the GPS engine does not know this identifier.');
    if (!r.lastSeenAt) notes.push('The platform has never received data from this device.');
    if (this.tooLong(since, now)) notes.push(`Waiting for the first GPS signal for more than ${FIRST_SIGNAL_STUCK_AFTER_HOURS} hours.`);
    if (r.lastSeenAt && !r.firstSignalAt) notes.push('The device has contacted the platform but never sent a usable position (invalid fixes only?).');
    if (!open) notes.push('The device is not installed on a vehicle, so no live state exists to observe capabilities.');
    const unseen = caps.capabilities.filter((c) => c.observed === 'NOT_SEEN').map((c) => c.key);
    if (unseen.length) notes.push(`Reporting, but the data for ${unseen.join(', ')} has not been seen.`);
    if (r.variant && !r.variant.model.enginePort) notes.push('The catalogue does not record the port this model connects to.');

    return {
      device: {
        id: r.id,
        uniqueId: r.uniqueId,
        name: r.name,
        organization: (r.current ?? r.owner) ? { id: (r.current ?? r.owner)!.id, name: (r.current ?? r.owner)!.name } : null,
        lifecycleStatus: r.lifecycleStatus,
        connectivity,
        displayStatus: deviceDisplayStatus(r.lifecycleStatus, connectivity),
        isSimulated: r.isSimulated,
        firmwareVersion: r.firmwareVersion,
        serialNumber: r.serialNumber,
        simIccid: r.simIccid,
        variantLabel: r.variant ? labelOf(r.variant) : null,
        firstSignalAt: r.firstSignalAt?.toISOString() ?? null,
        lastSeenAt: r.lastSeenAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
        awaitingFirstSignalTooLong: this.tooLong(since, now),
      },
      engine,
      history: history.map((h) => ({ id: h.id, fromStatus: h.fromStatus, toStatus: h.toStatus, reason: h.reason, byUser: h.actorUserId !== null, at: h.at.toISOString() })),
      capabilities: caps.capabilities,
      notes,
    };
  }

  // ---------------------------------------------------------------- audited actions

  async setLifecycle(id: string, to: DeviceLifecycleStatus, reason: string): Promise<DeviceDiagnosticsDto> {
    const r = await this.row(id);
    if (!canTransition(r.lifecycleStatus, to)) throw new AppException('INVALID_TRANSITION', 409, `A device that is "${r.lifecycleStatus}" cannot be moved to "${to}"`);
    try {
      await this.system.$transaction((tx) =>
        transitionDevice(tx, { deviceId: id, organizationId: (r.currentOrganizationId ?? r.ownerOrganizationId), to, actorUserId: this.cls.get('tenant')?.userId ?? null, reason }),
      );
    } catch (err) {
      if (err instanceof LifecycleError) throw new AppException(err.code, 409, 'The device status changed at the same time. Reload and try again.');
      throw err;
    }
    await this.audit.record({ action: 'platform.device_lifecycle', targetType: 'device', targetId: id, organizationId: r.currentOrganizationId ?? r.ownerOrganizationId, before: { status: r.lifecycleStatus }, after: { status: to, reason } });
    return this.diagnostics(id);
  }

  /** Staff may identify a device as ANY variant (listed or not), subject to the same identifier rules. */
  async setVariant(id: string, variantId: string | null, firmwareVersion?: string | null): Promise<DeviceDiagnosticsDto> {
    const r = await this.row(id);
    if (variantId) {
      const v = await this.system.gpsDeviceVariant.findUnique({ where: { id: variantId }, include: variantInclude });
      if (!v) throw new AppException('VARIANT_NOT_FOUND', 422, 'That catalogue variant does not exist');
      assertVariantFits(r.uniqueId, v);
    }
    await this.system.gpsDevice.update({ where: { id }, data: { variantId, ...(firmwareVersion !== undefined ? { firmwareVersion } : {}) } });
    await this.audit.record({ action: 'platform.device_set_variant', targetType: 'device', targetId: id, organizationId: r.currentOrganizationId ?? r.ownerOrganizationId, after: { variantId } });
    return this.diagnostics(id);
  }

  async resync(id: string): Promise<DeviceDiagnosticsDto> {
    const r = await this.row(id);
    await this.sync.sync({ id: r.id, uniqueId: r.uniqueId, ownerOrganizationId: r.ownerOrganizationId });
    await this.audit.record({ action: 'platform.device_resync', targetType: 'device', targetId: id, organizationId: r.currentOrganizationId ?? r.ownerOrganizationId });
    return this.diagnostics(id);
  }
}
