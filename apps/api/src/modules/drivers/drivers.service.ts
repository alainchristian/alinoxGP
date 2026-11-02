import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { expiryOf, type DriverDto, type DriverStatus } from '@gps/shared';
import { AppException, conflict, notFound } from '../../common/errors';
import { dateOnly, OrgClockService, toDateColumn } from '../../common/org-clock.service';
import { isUniqueViolation } from '../../common/prisma-errors';
import { PagedResult } from '../../common/response';
import { TenantPrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

const include = {
  assignments: { where: { unassignedAt: null }, include: { vehicle: { select: { id: true, registrationNumber: true } } } },
} satisfies Prisma.DriverInclude;
type DriverRow = Prisma.DriverGetPayload<{ include: typeof include }>;

const toDto = (d: DriverRow, today: string): DriverDto => {
  const open = d.assignments[0];
  return {
    id: d.id,
    fullName: d.fullName,
    phone: d.phone,
    email: d.email,
    licenseNumber: d.licenseNumber,
    licenseClass: d.licenseClass,
    license: expiryOf(dateOnly(d.licenseExpiry), today),
    status: d.status,
    notes: d.notes,
    vehicle: open ? { id: open.vehicle.id, registrationNumber: open.vehicle.registrationNumber, since: open.assignedAt.toISOString() } : null,
    createdAt: d.createdAt.toISOString(),
  };
};

type DriverInput = {
  fullName?: string;
  phone?: string | null;
  email?: string | null;
  licenseNumber?: string | null;
  licenseClass?: string | null;
  licenseExpiry?: string | null;
  status?: DriverStatus;
  notes?: string | null;
};

/**
 * Drivers: deliberately minimal personal data (name, phone, email, licence). No national id, photo or address.
 * A driver is "assigned" to a vehicle — the platform never claims the assigned person is the one at the wheel.
 */
@Injectable()
export class DriversService {
  constructor(
    private readonly tenant: TenantPrismaService,
    private readonly audit: AuditService,
    private readonly clock: OrgClockService,
  ) {}

  async list(page: number, pageSize: number, f: { q?: string; status?: DriverStatus; assigned?: boolean }): Promise<PagedResult<DriverDto>> {
    const and: Prisma.DriverWhereInput[] = [{ deletedAt: null }];
    if (f.q) and.push({ OR: [{ fullName: { contains: f.q, mode: 'insensitive' } }, { phone: { contains: f.q } }, { licenseNumber: { contains: f.q, mode: 'insensitive' } }] });
    if (f.status) and.push({ status: f.status });
    if (f.assigned !== undefined) and.push({ assignments: f.assigned ? { some: { unassignedAt: null } } : { none: { unassignedAt: null } } });
    const where: Prisma.DriverWhereInput = { AND: and };
    const [today, [total, rows]] = await Promise.all([
      this.clock.today(),
      this.tenant.run((tx) =>
        Promise.all([
          tx.driver.count({ where }),
          tx.driver.findMany({ where, include, orderBy: [{ fullName: 'asc' }, { id: 'asc' }], skip: (page - 1) * pageSize, take: pageSize }),
        ]),
      ),
    ]);
    return new PagedResult(rows.map((r) => toDto(r, today)), { page, pageSize, total });
  }

  async get(id: string): Promise<DriverDto> {
    const [today, row] = await Promise.all([this.clock.today(), this.tenant.run((tx) => tx.driver.findFirst({ where: { id, deletedAt: null }, include }))]);
    if (!row) throw notFound('DRIVER_NOT_FOUND');
    return toDto(row, today);
  }

  private data(input: DriverInput) {
    const { licenseExpiry, ...rest } = input;
    return { ...rest, licenseExpiry: toDateColumn(licenseExpiry) };
  }

  async create(organizationId: string, input: DriverInput & { fullName: string }): Promise<DriverDto> {
    try {
      const row = await this.tenant.run((tx) => tx.driver.create({ data: { ...this.data(input), organizationId, fullName: input.fullName }, include }));
      // The audit entry names the fields set, never the personal values themselves.
      await this.audit.record({ action: 'driver.create', targetType: 'driver', targetId: row.id, after: { fields: Object.keys(input) } });
      return toDto(row, await this.clock.today());
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict('DRIVER_LICENSE_TAKEN', 'A driver with this licence number already exists');
      throw err;
    }
  }

  async update(id: string, input: DriverInput): Promise<DriverDto> {
    const current = await this.get(id);
    if (input.status === 'INACTIVE' && current.vehicle) {
      throw new AppException('DRIVER_ASSIGNED', 409, 'Unassign the driver from their vehicle before deactivating them');
    }
    try {
      const row = await this.tenant.run((tx) => tx.driver.update({ where: { id }, data: this.data(input), include }));
      await this.audit.record({ action: 'driver.update', targetType: 'driver', targetId: id, after: { fields: Object.keys(input) } });
      return toDto(row, await this.clock.today());
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict('DRIVER_LICENSE_TAKEN', 'A driver with this licence number already exists');
      throw err;
    }
  }

  async remove(id: string): Promise<void> {
    const current = await this.get(id);
    if (current.vehicle) throw new AppException('DRIVER_ASSIGNED', 409, 'Unassign the driver from their vehicle before deleting them');
    await this.tenant.run((tx) => tx.driver.update({ where: { id }, data: { deletedAt: new Date() } }));
    await this.audit.record({ action: 'driver.delete', targetType: 'driver', targetId: id });
  }
}
