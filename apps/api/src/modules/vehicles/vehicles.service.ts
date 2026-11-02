import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { expiryOf, type DriverAssignmentDto, type VehicleDto, type VEHICLE_SORTS } from '@gps/shared';
import { AppException, conflict, notFound } from '../../common/errors';
import { dateOnly, OrgClockService, toDateColumn } from '../../common/org-clock.service';
import { isUniqueViolation } from '../../common/prisma-errors';
import { PagedResult } from '../../common/response';
import { TenantPrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

const include = {
  category: { select: { id: true, name: true, color: true } },
  assignments: { where: { unassignedAt: null }, include: { device: { select: { id: true, uniqueId: true } } } },
  driverAssignments: { where: { unassignedAt: null }, include: { driver: { select: { id: true, fullName: true } } } },
  _count: { select: { documents: { where: { deletedAt: null } } } },
} satisfies Prisma.VehicleInclude;
type VehicleRow = Prisma.VehicleGetPayload<{ include: typeof include }>;

const toDto = (v: VehicleRow, today: string): VehicleDto => {
  const device = v.assignments[0];
  const driver = v.driverAssignments[0];
  return {
    id: v.id,
    registrationNumber: v.registrationNumber,
    make: v.make,
    model: v.model,
    year: v.year,
    color: v.color,
    vehicleType: v.vehicleType,
    vin: v.vin,
    fuelType: v.fuelType,
    notes: v.notes,
    insurance: expiryOf(dateOnly(v.insuranceExpiry), today),
    inspection: expiryOf(dateOnly(v.inspectionExpiry), today),
    category: v.category,
    driver: driver ? { id: driver.driver.id, fullName: driver.driver.fullName, since: driver.assignedAt.toISOString() } : null,
    device: device ? { id: device.device.id, uniqueId: device.device.uniqueId, since: device.assignedAt.toISOString() } : null,
    documentsCount: v._count.documents,
    createdAt: v.createdAt.toISOString(),
    updatedAt: v.updatedAt.toISOString(),
  };
};

const ORDER: Record<(typeof VEHICLE_SORTS)[number], Prisma.VehicleOrderByWithRelationInput[]> = {
  'registration:asc': [{ registrationNumber: 'asc' }],
  'registration:desc': [{ registrationNumber: 'desc' }],
  'created:desc': [{ createdAt: 'desc' }],
  'created:asc': [{ createdAt: 'asc' }],
  'year:desc': [{ year: { sort: 'desc', nulls: 'last' } }, { registrationNumber: 'asc' }],
  'year:asc': [{ year: { sort: 'asc', nulls: 'last' } }, { registrationNumber: 'asc' }],
};

export interface VehicleListFilter {
  q?: string;
  categoryId?: string;
  hasDevice?: boolean;
  hasDriver?: boolean;
  sort: (typeof VEHICLE_SORTS)[number];
}

type VehicleInput = {
  registrationNumber?: string;
  make?: string | null;
  model?: string | null;
  year?: number | null;
  color?: string | null;
  vehicleType?: VehicleDto['vehicleType'];
  vin?: string | null;
  fuelType?: VehicleDto['fuelType'];
  insuranceExpiry?: string | null;
  inspectionExpiry?: string | null;
  notes?: string | null;
  categoryId?: string | null;
};

/** Columns that appear in audit entries (never free-text notes: they may hold personal remarks). */
const AUDITED = ['registrationNumber', 'make', 'model', 'year', 'color', 'vehicleType', 'vin', 'fuelType', 'insuranceExpiry', 'inspectionExpiry', 'categoryId'] as const;

/** Vehicles: identity, details, category, expiry dates. Devices are attached in the devices module, drivers in the drivers module. */
@Injectable()
export class VehiclesService {
  constructor(
    private readonly tenant: TenantPrismaService,
    private readonly audit: AuditService,
    private readonly clock: OrgClockService,
  ) {}

  async list(page: number, pageSize: number, f: VehicleListFilter): Promise<PagedResult<VehicleDto>> {
    const and: Prisma.VehicleWhereInput[] = [{ deletedAt: null }];
    if (f.q) {
      and.push({
        OR: [
          { registrationNumber: { contains: f.q, mode: 'insensitive' } },
          { make: { contains: f.q, mode: 'insensitive' } },
          { model: { contains: f.q, mode: 'insensitive' } },
          { vin: { contains: f.q.toUpperCase() } },
        ],
      });
    }
    if (f.categoryId) and.push({ categoryId: f.categoryId });
    if (f.hasDevice !== undefined) and.push({ assignments: f.hasDevice ? { some: { unassignedAt: null } } : { none: { unassignedAt: null } } });
    if (f.hasDriver !== undefined) and.push({ driverAssignments: f.hasDriver ? { some: { unassignedAt: null } } : { none: { unassignedAt: null } } });
    const where: Prisma.VehicleWhereInput = { AND: and };
    const [today, [total, rows]] = await Promise.all([
      this.clock.today(),
      this.tenant.run((tx) =>
        Promise.all([
          tx.vehicle.count({ where }),
          tx.vehicle.findMany({ where, include, orderBy: ORDER[f.sort], skip: (page - 1) * pageSize, take: pageSize }),
        ]),
      ),
    ]);
    return new PagedResult(rows.map((r) => toDto(r, today)), { page, pageSize, total });
  }

  async get(id: string): Promise<VehicleDto> {
    const [today, row] = await Promise.all([this.clock.today(), this.tenant.run((tx) => tx.vehicle.findFirst({ where: { id, deletedAt: null }, include }))]);
    if (!row) throw notFound('VEHICLE_NOT_FOUND');
    return toDto(row, today);
  }

  private data(input: VehicleInput): Prisma.VehicleUncheckedUpdateInput {
    const { insuranceExpiry, inspectionExpiry, ...rest } = input;
    return { ...rest, insuranceExpiry: toDateColumn(insuranceExpiry), inspectionExpiry: toDateColumn(inspectionExpiry) };
  }

  /**
   * Inside an interactive transaction a violation of one of our hand-written unique indexes reaches us without the
   * index name (`target: null`), so the rule that was broken is found by looking: is this VIN already on a live vehicle?
   */
  private async mapError(err: unknown, input: VehicleInput, selfId?: string): Promise<never> {
    if (isUniqueViolation(err)) {
      const vin = input.vin;
      const vinTaken = vin ? await this.tenant.run((tx) => tx.vehicle.count({ where: { vin, deletedAt: null, ...(selfId ? { id: { not: selfId } } : {}) } })) : 0;
      if (vinTaken > 0) throw conflict('VEHICLE_VIN_TAKEN', 'A vehicle with this VIN already exists');
      throw conflict('VEHICLE_REGISTRATION_TAKEN', 'A vehicle with this registration number already exists');
    }
    // Composite foreign key: a category id that is not this organization's (or does not exist) is a validation problem, not a leak.
    if ((err as { code?: string }).code === 'P2003') throw new AppException('CATEGORY_NOT_FOUND', 422, 'That category does not exist');
    throw err;
  }

  async create(organizationId: string, input: VehicleInput & { registrationNumber: string }): Promise<VehicleDto> {
    try {
      const row = await this.tenant.run((tx) =>
        tx.vehicle.create({ data: { ...(this.data(input) as Prisma.VehicleUncheckedCreateInput), organizationId, registrationNumber: input.registrationNumber }, include }),
      );
      await this.audit.record({ action: 'vehicle.create', targetType: 'vehicle', targetId: row.id, after: pick(input) });
      return toDto(row, await this.clock.today());
    } catch (err) {
      return await this.mapError(err, input);
    }
  }

  async update(id: string, input: VehicleInput): Promise<VehicleDto> {
    const before = await this.get(id);
    try {
      const row = await this.tenant.run((tx) => tx.vehicle.update({ where: { id }, data: this.data(input), include }));
      await this.audit.record({
        action: 'vehicle.update',
        targetType: 'vehicle',
        targetId: id,
        before: pick(flatten(before), Object.keys(input)),
        after: pick(input),
      });
      return toDto(row, await this.clock.today());
    } catch (err) {
      return await this.mapError(err, input, id);
    }
  }

  /** Soft delete. A vehicle that still carries a device or an assigned driver must be released first so history stays coherent. */
  async remove(id: string): Promise<void> {
    const current = await this.get(id);
    if (current.device) throw new AppException('VEHICLE_HAS_DEVICE', 409, 'Unassign the device before deleting this vehicle');
    if (current.driver) throw new AppException('VEHICLE_HAS_DRIVER', 409, 'Unassign the driver before deleting this vehicle');
    await this.tenant.run((tx) => tx.vehicle.update({ where: { id }, data: { deletedAt: new Date() } }));
    await this.audit.record({ action: 'vehicle.delete', targetType: 'vehicle', targetId: id, before: { registrationNumber: current.registrationNumber } });
  }

  // ---------------------------------------------------------------- the assigned driver

  async assignDriver(organizationId: string, userId: string | undefined, vehicleId: string, driverId: string, reason?: string): Promise<VehicleDto> {
    await this.get(vehicleId);
    try {
      await this.tenant.run(async (tx) => {
        const driver = await tx.driver.findFirst({ where: { id: driverId, deletedAt: null } });
        if (!driver) throw notFound('DRIVER_NOT_FOUND');
        if (driver.status !== 'ACTIVE') throw new AppException('DRIVER_INACTIVE', 409, 'An inactive driver cannot be assigned to a vehicle');
        const vehicleOpen = await tx.driverAssignment.findFirst({ where: { vehicleId, unassignedAt: null } });
        if (vehicleOpen) throw new AppException('VEHICLE_HAS_DRIVER', 409, 'This vehicle already has an assigned driver; unassign them first');
        const driverOpen = await tx.driverAssignment.findFirst({ where: { driverId, unassignedAt: null } });
        if (driverOpen) throw new AppException('DRIVER_ALREADY_ASSIGNED', 409, 'This driver is already assigned to another vehicle');
        await tx.driverAssignment.create({ data: { organizationId, vehicleId, driverId, assignedBy: userId ?? null, reason: reason ?? null } });
      });
    } catch (err) {
      // Two concurrent requests can both pass the checks above; the partial unique indexes decide.
      if (isUniqueViolation(err)) throw new AppException('DRIVER_ASSIGNMENT_CONFLICT', 409, 'The driver or the vehicle was just assigned by someone else');
      throw err;
    }
    await this.audit.record({ action: 'vehicle.driver_assign', targetType: 'vehicle', targetId: vehicleId, after: { driverId, reason: reason ?? null } });
    return this.get(vehicleId);
  }

  async unassignDriver(userId: string | undefined, vehicleId: string, reason?: string): Promise<VehicleDto> {
    await this.get(vehicleId);
    const closed = await this.tenant.run(async (tx) => {
      const open = await tx.driverAssignment.findFirst({ where: { vehicleId, unassignedAt: null } });
      if (!open) return null;
      // Never earlier than the assignment itself: application and database clocks can differ by up to a second.
      const unassignedAt = new Date(Math.max(Date.now(), open.assignedAt.getTime()));
      await tx.driverAssignment.update({ where: { id: open.id }, data: { unassignedAt, unassignedBy: userId ?? null, reason: reason ?? open.reason } });
      return open;
    });
    if (!closed) throw new AppException('VEHICLE_HAS_NO_DRIVER', 409, 'This vehicle has no assigned driver');
    await this.audit.record({ action: 'vehicle.driver_unassign', targetType: 'vehicle', targetId: vehicleId, before: { driverId: closed.driverId }, after: { reason: reason ?? null } });
    return this.get(vehicleId);
  }

  async driverHistory(vehicleId: string): Promise<DriverAssignmentDto[]> {
    await this.get(vehicleId);
    const rows = await this.tenant.run((tx) =>
      tx.driverAssignment.findMany({
        where: { vehicleId },
        include: { driver: { select: { id: true, fullName: true } } },
        orderBy: { assignedAt: 'desc' },
        take: 200,
      }),
    );
    return rows.map((r) => ({
      id: r.id,
      driver: r.driver,
      assignedAt: r.assignedAt.toISOString(),
      unassignedAt: r.unassignedAt?.toISOString() ?? null,
      reason: r.reason,
    }));
  }
}

type Json = Record<string, string | number | boolean | null>;
const pick = (src: object, keys: readonly string[] = AUDITED): Json => {
  const row = src as Record<string, string | number | boolean | null | undefined>;
  return Object.fromEntries(keys.filter((k) => (AUDITED as readonly string[]).includes(k) && k in row).map((k) => [k, row[k] ?? null]));
};

/** The DTO nests expiry objects; the audit entry records the plain stored values. */
const flatten = (v: VehicleDto): Json => ({
  registrationNumber: v.registrationNumber,
  make: v.make,
  model: v.model,
  year: v.year,
  color: v.color,
  vehicleType: v.vehicleType,
  vin: v.vin,
  fuelType: v.fuelType,
  insuranceExpiry: v.insurance?.date ?? null,
  inspectionExpiry: v.inspection?.date ?? null,
  categoryId: v.category?.id ?? null,
});
