import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { expiryOf, type VehicleDocumentDto } from '@gps/shared';
import { AppException, notFound } from '../../common/errors';
import { dateOnly, OrgClockService, toDateColumn } from '../../common/org-clock.service';
import { TenantPrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

type DocInput = {
  type?: VehicleDocumentDto['type'];
  title?: string;
  referenceNumber?: string | null;
  issuedOn?: string | null;
  expiresOn?: string | null;
  notes?: string | null;
};

const toDto = (d: Prisma.VehicleDocumentGetPayload<object>, today: string): VehicleDocumentDto => ({
  id: d.id,
  vehicleId: d.vehicleId,
  type: d.type,
  title: d.title,
  referenceNumber: d.referenceNumber,
  issuedOn: dateOnly(d.issuedOn),
  expiresOn: dateOnly(d.expiresOn),
  expiry: expiryOf(dateOnly(d.expiresOn), today),
  notes: d.notes,
  createdAt: d.createdAt.toISOString(),
});

/**
 * Records of the papers kept for a vehicle (insurance, inspection, registration, permit). The RECORD only —
 * no file is stored (OQ-035). Soft-deleted rows stay in the table.
 */
@Injectable()
export class VehicleDocumentsService {
  constructor(
    private readonly tenant: TenantPrismaService,
    private readonly audit: AuditService,
    private readonly clock: OrgClockService,
  ) {}

  private async requireVehicle(tx: Prisma.TransactionClient, vehicleId: string) {
    const v = await tx.vehicle.findFirst({ where: { id: vehicleId, deletedAt: null }, select: { id: true } });
    if (!v) throw notFound('VEHICLE_NOT_FOUND');
  }

  async list(vehicleId: string): Promise<VehicleDocumentDto[]> {
    const [today, rows] = await Promise.all([
      this.clock.today(),
      this.tenant.run(async (tx) => {
        await this.requireVehicle(tx, vehicleId);
        return tx.vehicleDocument.findMany({ where: { vehicleId, deletedAt: null }, orderBy: [{ expiresOn: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }], take: 200 });
      }),
    ]);
    return rows.map((r) => toDto(r, today));
  }

  async create(organizationId: string, vehicleId: string, input: DocInput & { type: NonNullable<DocInput['type']>; title: string }): Promise<VehicleDocumentDto> {
    const row = await this.tenant.run(async (tx) => {
      await this.requireVehicle(tx, vehicleId);
      return tx.vehicleDocument.create({
        data: {
          organizationId,
          vehicleId,
          type: input.type,
          title: input.title,
          referenceNumber: input.referenceNumber ?? null,
          issuedOn: toDateColumn(input.issuedOn) ?? null,
          expiresOn: toDateColumn(input.expiresOn) ?? null,
          notes: input.notes ?? null,
        },
      });
    });
    await this.audit.record({ action: 'vehicle_document.create', targetType: 'vehicle_document', targetId: row.id, after: { vehicleId, type: row.type, title: row.title, expiresOn: dateOnly(row.expiresOn) } });
    return toDto(row, await this.clock.today());
  }

  async update(vehicleId: string, id: string, input: DocInput): Promise<VehicleDocumentDto> {
    const row = await this.tenant.run(async (tx) => {
      const current = await tx.vehicleDocument.findFirst({ where: { id, vehicleId, deletedAt: null } });
      if (!current) throw notFound('VEHICLE_DOCUMENT_NOT_FOUND');
      // The date-order rule must hold for the RESULT, not just for the fields in this request.
      const issued = input.issuedOn === undefined ? dateOnly(current.issuedOn) : input.issuedOn;
      const expires = input.expiresOn === undefined ? dateOnly(current.expiresOn) : input.expiresOn;
      if (issued && expires && expires < issued) {
        throw new AppException('VALIDATION_FAILED', 422, 'Invalid document dates', undefined, [{ path: 'expiresOn', message: 'The expiry date is before the issue date' }]);
      }
      return tx.vehicleDocument.update({
        where: { id },
        data: {
          type: input.type,
          title: input.title,
          referenceNumber: input.referenceNumber,
          issuedOn: toDateColumn(input.issuedOn),
          expiresOn: toDateColumn(input.expiresOn),
          notes: input.notes,
        },
      });
    });
    await this.audit.record({ action: 'vehicle_document.update', targetType: 'vehicle_document', targetId: id, after: { vehicleId, changed: Object.keys(input) } });
    return toDto(row, await this.clock.today());
  }

  async remove(vehicleId: string, id: string): Promise<void> {
    await this.tenant.run(async (tx) => {
      const current = await tx.vehicleDocument.findFirst({ where: { id, vehicleId, deletedAt: null } });
      if (!current) throw notFound('VEHICLE_DOCUMENT_NOT_FOUND');
      await tx.vehicleDocument.update({ where: { id }, data: { deletedAt: new Date() } });
    });
    await this.audit.record({ action: 'vehicle_document.delete', targetType: 'vehicle_document', targetId: id, before: { vehicleId } });
  }
}
