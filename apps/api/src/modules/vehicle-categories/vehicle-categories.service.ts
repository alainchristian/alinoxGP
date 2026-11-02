import { Injectable } from '@nestjs/common';
import type { VehicleCategoryDto } from '@gps/shared';
import { AppException, conflict, notFound } from '../../common/errors';
import { isUniqueViolation } from '../../common/prisma-errors';
import { TenantPrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

/** A customer's own grouping of vehicles. Names are unique per organization, ignoring case and surrounding spaces. */
@Injectable()
export class VehicleCategoriesService {
  constructor(
    private readonly tenant: TenantPrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<VehicleCategoryDto[]> {
    const rows = await this.tenant.run((tx) =>
      tx.vehicleCategory.findMany({
        orderBy: { name: 'asc' },
        include: { _count: { select: { vehicles: { where: { deletedAt: null } } } } },
        take: 500,
      }),
    );
    return rows.map((r) => ({ id: r.id, name: r.name, color: r.color, vehicleCount: r._count.vehicles }));
  }

  async create(organizationId: string, input: { name: string; color?: string | null }): Promise<VehicleCategoryDto> {
    try {
      const row = await this.tenant.run((tx) => tx.vehicleCategory.create({ data: { organizationId, name: input.name, color: input.color ?? null } }));
      await this.audit.record({ action: 'vehicle_category.create', targetType: 'vehicle_category', targetId: row.id, after: { name: row.name } });
      return { id: row.id, name: row.name, color: row.color, vehicleCount: 0 };
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict('CATEGORY_NAME_TAKEN', 'A category with this name already exists');
      throw err;
    }
  }

  async update(id: string, input: { name?: string; color?: string | null }): Promise<VehicleCategoryDto> {
    try {
      const row = await this.tenant.run(async (tx) => {
        const current = await tx.vehicleCategory.findUnique({ where: { id } });
        if (!current) throw notFound('CATEGORY_NOT_FOUND');
        return tx.vehicleCategory.update({
          where: { id },
          data: { name: input.name, color: input.color },
          include: { _count: { select: { vehicles: { where: { deletedAt: null } } } } },
        });
      });
      await this.audit.record({ action: 'vehicle_category.update', targetType: 'vehicle_category', targetId: id, after: { changed: Object.keys(input) } });
      return { id: row.id, name: row.name, color: row.color, vehicleCount: row._count.vehicles };
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict('CATEGORY_NAME_TAKEN', 'A category with this name already exists');
      throw err;
    }
  }

  /** Refused while a live vehicle uses it. Deleted vehicles keep no reference (their column is cleared first). */
  async remove(id: string): Promise<void> {
    const name = await this.tenant.run(async (tx) => {
      const current = await tx.vehicleCategory.findUnique({ where: { id } });
      if (!current) throw notFound('CATEGORY_NOT_FOUND');
      const inUse = await tx.vehicle.count({ where: { categoryId: id, deletedAt: null } });
      if (inUse > 0) throw new AppException('CATEGORY_IN_USE', 409, 'Move or remove the vehicles in this category first', `${inUse} vehicle(s) still use it`);
      await tx.vehicle.updateMany({ where: { categoryId: id }, data: { categoryId: null } });
      await tx.vehicleCategory.delete({ where: { id } });
      return current.name;
    });
    await this.audit.record({ action: 'vehicle_category.delete', targetType: 'vehicle_category', targetId: id, before: { name } });
  }
}
