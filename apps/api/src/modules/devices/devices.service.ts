import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import { deviceConnectivity, deviceDisplayStatus, type DeviceConfigurationDto, type DeviceDto, type DeviceStatusHistoryDto } from '@gps/shared';
import { AppException, conflict, notFound } from '../../common/errors';
import { isUniqueViolation } from '../../common/prisma-errors';
import { PagedResult } from '../../common/response';
import type { AppClsStore } from '../../common/request-context';
import { ENV, type Env } from '../../infrastructure/config/env';
import { PrismaService, TenantPrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ConsentService } from '../consent/consent.service';
import { LiveStateStore } from '../live-state/live-state.store';
import { StatusConfigService } from '../live-state/status-config.service';
import { LifecycleError, recordRegistration, transitionDevice } from './device-lifecycle';
import { assertVariantFits, labelOf, variantInclude } from './device-variant';
import { DeviceEngineSyncService } from './device-engine-sync.service';
import { DeviceRoutingService } from './device-routing.service';

const include = {
  assignments: { where: { unassignedAt: null }, include: { vehicle: { select: { registrationNumber: true } } }, take: 1 },
  variant: { include: variantInclude },
} satisfies Prisma.GpsDeviceInclude;
type DeviceRow = Prisma.GpsDeviceGetPayload<{ include: typeof include }>;

export const toDeviceDto = (d: DeviceRow, offlineAfterSec: number, now: Date = new Date()): DeviceDto => {
  const open = d.assignments[0];
  const connectivity = deviceConnectivity(d.lastSeenAt, now, offlineAfterSec);
  return {
    id: d.id,
    uniqueId: d.uniqueId,
    name: d.name,
    lifecycleStatus: d.lifecycleStatus,
    engineSyncStatus: d.engineSyncStatus,
    isSimulated: d.isSimulated,
    firstSignalAt: d.firstSignalAt?.toISOString() ?? null,
    lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
    createdAt: d.createdAt.toISOString(),
    assignment: open ? { vehicleId: open.vehicleId, registrationNumber: open.vehicle.registrationNumber, since: open.assignedAt.toISOString() } : null,
    variant: d.variant ? { id: d.variant.id, label: labelOf(d.variant), isSimulatorProfile: d.variant.model.isSimulatorProfile } : null,
    firmwareVersion: d.firmwareVersion,
    serialNumber: d.serialNumber,
    simIccid: d.simIccid,
    connectivity,
    displayStatus: deviceDisplayStatus(d.lifecycleStatus, connectivity),
  };
};

@Injectable()
export class DevicesService {
  constructor(
    private readonly tenant: TenantPrismaService,
    private readonly sync: DeviceEngineSyncService,
    private readonly routing: DeviceRoutingService,
    private readonly audit: AuditService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly liveState: LiveStateStore,
    private readonly consent: ConsentService,
    private readonly statusConfig: StatusConfigService,
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private dto(d: DeviceRow): DeviceDto {
    return toDeviceDto(d, this.statusConfig.thresholds.offlineAfterSec);
  }

  private get ctx() {
    return this.cls.get('tenant')!;
  }

  async list(page: number, pageSize: number): Promise<PagedResult<DeviceDto>> {
    const [total, rows] = await this.tenant.run((tx) =>
      Promise.all([
        tx.gpsDevice.count(),
        tx.gpsDevice.findMany({ include, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      ]),
    );
    return new PagedResult(rows.map((r) => this.dto(r)), { page, pageSize, total });
  }

  private async load(id: string): Promise<DeviceRow> {
    const row = await this.tenant.run((tx) => tx.gpsDevice.findUnique({ where: { id }, include }));
    if (!row) throw notFound('DEVICE_NOT_FOUND');
    return row;
  }

  async get(id: string): Promise<DeviceDto> {
    return this.dto(await this.load(id));
  }

  /**
   * Registers a device for the active organization (bring-your-own-device path). The identifier is globally
   * unique; a clash is reported generically so one customer can never learn that another customer owns it.
   * Naming a catalogue model is optional: without it every capability stays Unknown (ADR-0009).
   */
  async register(input: { uniqueId: string; name?: string; variantId?: string; firmwareVersion?: string; serialNumber?: string; simIccid?: string; acknowledgedNoticeId?: string }): Promise<DeviceDto> {
    const orgId = this.ctx.organizationId;
    const isSimulated = input.uniqueId.startsWith('SIM-');
    if (isSimulated) {
      const org = await this.tenant.run((tx) => tx.organization.findUnique({ where: { id: orgId }, select: { isSandbox: true } }));
      if (!this.env.SIMULATOR_ENABLED || !org?.isSandbox) {
        throw new AppException('SIMULATED_DEVICE_NOT_ALLOWED', 422, 'Simulated devices can only be registered in a sandbox organization');
      }
    }
    // Customers may only pick listed models; the identifier must fit the model (IMEI check digit, simulator profile).
    const variant = input.variantId ? await this.prisma.gpsDeviceVariant.findFirst({ where: { id: input.variantId, model: { isListed: true } }, include: variantInclude }) : null;
    if (input.variantId && !variant) throw new AppException('VARIANT_NOT_FOUND', 422, 'Choose a device model from the list');
    if (variant) assertVariantFits(input.uniqueId, variant);
    const notice = await this.consent.requireAcknowledgement(input.acknowledgedNoticeId);
    const status = variant ? 'AWAITING_CONFIGURATION' : 'REGISTERED';

    let created;
    try {
      created = await this.tenant.run(async (tx) => {
        const d = await tx.gpsDevice.create({
          data: {
            uniqueId: input.uniqueId,
            name: input.name ?? null,
            ownerOrganizationId: orgId,
            currentOrganizationId: orgId,
            isSimulated,
            variantId: variant?.id ?? null,
            firmwareVersion: input.firmwareVersion ?? null,
            serialNumber: input.serialNumber ?? null,
            simIccid: input.simIccid ?? null,
            lifecycleStatus: status,
          },
          include,
        });
        await recordRegistration(tx, { deviceId: d.id, organizationId: orgId, status, actorUserId: this.ctx.userId });
        if (notice) await tx.consentRecord.create({ data: { organizationId: orgId, userId: this.ctx.userId, noticeId: notice.id, deviceId: d.id } });
        return d;
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        // Do NOT reveal who owns it. Administrators are alerted through the audit trail (platform scope).
        await this.audit.record({ action: 'device.register_conflict', targetType: 'device_identifier', after: { uniqueId: input.uniqueId } });
        throw conflict('DEVICE_IDENTIFIER_UNAVAILABLE', 'This device identifier cannot be registered. Check the identifier or contact support.');
      }
      throw err;
    }

    await this.audit.record({ action: 'device.register', targetType: 'device', targetId: created.id, after: { uniqueId: input.uniqueId, isSimulated, variantId: variant?.id ?? null, consentNotice: notice?.version ?? null } });
    await this.sync.sync({ id: created.id, uniqueId: created.uniqueId, ownerOrganizationId: orgId });
    return this.get(created.id);
  }

  /** The customer says the device is set up: from now on we wait for its first position. Idempotent. */
  async confirmConfigured(id: string): Promise<DeviceDto> {
    const d = await this.load(id);
    if (d.lifecycleStatus === 'AWAITING_FIRST_SIGNAL' || d.lifecycleStatus === 'ACTIVE') return this.dto(d);
    try {
      await this.tenant.run((tx) => transitionDevice(tx, { deviceId: id, organizationId: this.ctx.organizationId, to: 'AWAITING_FIRST_SIGNAL', actorUserId: this.ctx.userId, reason: 'Customer confirmed the device is configured' }));
    } catch (err) {
      if (err instanceof LifecycleError) throw new AppException('DEVICE_NOT_CONFIGURABLE', 409, 'This device cannot be moved to "awaiting first signal" from its current status');
      throw err;
    }
    await this.audit.record({ action: 'device.configured', targetType: 'device', targetId: id });
    return this.get(id);
  }

  /** Identify (or change) the model after registration. Same rules as at registration. */
  async setVariant(id: string, variantId: string | null, firmwareVersion?: string | null): Promise<DeviceDto> {
    const d = await this.load(id);
    let variant = null;
    if (variantId) {
      variant = await this.prisma.gpsDeviceVariant.findFirst({ where: { id: variantId, model: { isListed: true } }, include: variantInclude });
      if (!variant) throw new AppException('VARIANT_NOT_FOUND', 422, 'Choose a device model from the list');
      assertVariantFits(d.uniqueId, variant);
    }
    await this.tenant.run((tx) => tx.gpsDevice.update({ where: { id }, data: { variantId: variant?.id ?? null, ...(firmwareVersion !== undefined ? { firmwareVersion } : {}) } }));
    await this.audit.record({ action: 'device.set_variant', targetType: 'device', targetId: id, after: { variantId: variant?.id ?? null } });
    return this.get(id);
  }

  /**
   * What the device must be set to so it reaches the platform. Everything comes from the catalogue and configuration;
   * a value the platform does not know is listed under `missing` and is never guessed.
   */
  async configuration(id: string): Promise<DeviceConfigurationDto> {
    const d = await this.load(id);
    const model = d.variant?.model ?? null;
    const missing: string[] = [];
    const serverHost = this.env.GPS_SERVER_HOST || null;
    if (!serverHost) missing.push('The platform GPS server address is not configured on this deployment yet.');
    if (!model) missing.push('The device model has not been identified, so the protocol and port are not known.');
    else {
      if (model.enginePort == null) missing.push('The catalogue does not record the port this model connects to.');
      if (!model.configurationNotes) missing.push('The catalogue has no setup notes for this model.');
    }
    return { deviceId: d.id, identifier: d.uniqueId, identifierType: model?.identifierType ?? null, serverHost, port: model?.enginePort ?? null, protocol: model?.protocol ?? null, notes: model?.configurationNotes ?? null, missing };
  }

  /** Retry the engine registration (idempotent). */
  async resync(id: string): Promise<DeviceDto> {
    const d = await this.load(id);
    await this.sync.sync({ id: d.id, uniqueId: d.uniqueId, ownerOrganizationId: d.ownerOrganizationId });
    return this.get(id);
  }

  async rename(id: string, name: string): Promise<DeviceDto> {
    await this.load(id);
    await this.tenant.run((tx) => tx.gpsDevice.update({ where: { id }, data: { name } }));
    await this.audit.record({ action: 'device.rename', targetType: 'device', targetId: id });
    return this.get(id);
  }

  async assign(id: string, vehicleId: string, reason?: string): Promise<DeviceDto> {
    const orgId = this.ctx.organizationId;
    await this.load(id); // 404 if the device is not visible to this organization
    try {
      await this.tenant.run(async (tx) => {
        const vehicle = await tx.vehicle.findFirst({ where: { id: vehicleId, deletedAt: null } });
        if (!vehicle) throw notFound('VEHICLE_NOT_FOUND');
        if (await tx.deviceAssignment.findFirst({ where: { deviceId: id, unassignedAt: null } })) {
          throw conflict('DEVICE_ALREADY_ASSIGNED', 'This device is already installed on a vehicle. Unassign it first.');
        }
        if (await tx.deviceAssignment.findFirst({ where: { vehicleId, unassignedAt: null } })) {
          throw conflict('VEHICLE_ALREADY_HAS_DEVICE', 'This vehicle already has a device. Unassign it first.');
        }
        await tx.deviceAssignment.create({
          data: { organizationId: orgId, deviceId: id, vehicleId, assignedBy: this.ctx.userId, reason: reason ?? null },
        });
        await tx.gpsDevice.update({ where: { id }, data: { currentOrganizationId: orgId } });
      });
    } catch (err) {
      // Lost a race against another assignment: the partial unique indexes are the final arbiter.
      if (isUniqueViolation(err)) throw conflict('ASSIGNMENT_CONFLICT', 'The device or vehicle was assigned at the same time. Reload and try again.');
      throw err;
    }
    this.routing.invalidate(await this.engineIdOf(id));
    await this.audit.record({ action: 'device.assign', targetType: 'device', targetId: id, after: { vehicleId } });
    return this.get(id);
  }

  async unassign(id: string, reason?: string): Promise<DeviceDto> {
    await this.load(id);
    const vehicleId = await this.tenant.run(async (tx) => {
      const open = await tx.deviceAssignment.findFirst({ where: { deviceId: id, unassignedAt: null } });
      if (!open) throw new AppException('DEVICE_NOT_ASSIGNED', 409, 'This device is not installed on a vehicle');
      // `assigned_at` is stamped by the DATABASE clock; this server's clock may be a little behind it, and the window CHECK
      // (unassigned_at >= assigned_at) would then reject a quick unassign. Never record an end before the start.
      const unassignedAt = new Date(Math.max(Date.now(), open.assignedAt.getTime()));
      await tx.deviceAssignment.update({ where: { id: open.id }, data: { unassignedAt, unassignedBy: this.ctx.userId, reason: reason ?? null } });
      // The vehicle has no device any more: showing its old location as "current" would be misleading.
      await tx.vehicleLiveState.deleteMany({ where: { vehicleId: open.vehicleId } });
      return open.vehicleId;
    });
    await this.liveState.remove(this.ctx.organizationId, vehicleId); // Redis copy too, not only the database row
    this.routing.invalidate(await this.engineIdOf(id));
    await this.audit.record({ action: 'device.unassign', targetType: 'device', targetId: id, before: { vehicleId } });
    return this.get(id);
  }

  /** Lifecycle history of this device (append-only). */
  async statusHistory(id: string): Promise<DeviceStatusHistoryDto[]> {
    await this.load(id);
    const rows = await this.tenant.run((tx) => tx.deviceStatusHistory.findMany({ where: { deviceId: id }, orderBy: { at: 'desc' }, take: 100 }));
    return rows.map((r) => ({ id: r.id, fromStatus: r.fromStatus, toStatus: r.toStatus, reason: r.reason, byUser: r.actorUserId !== null, at: r.at.toISOString() }));
  }

  private async engineIdOf(id: string): Promise<number | null> {
    const d = await this.tenant.run((tx) => tx.gpsDevice.findUnique({ where: { id }, select: { traccarDeviceId: true } }));
    return d?.traccarDeviceId ?? null;
  }
}
