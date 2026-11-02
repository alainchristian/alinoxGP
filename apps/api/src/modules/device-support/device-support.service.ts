import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { SupportRequestDto, SupportRequestStatus } from '@gps/shared';
import { AppException, notFound } from '../../common/errors';
import { PagedResult } from '../../common/response';
import { SystemPrismaService, TenantPrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

const toDto = (r: Prisma.DeviceSupportRequestGetPayload<object>, organization?: { id: string; name: string }): SupportRequestDto => ({
  id: r.id,
  ...(organization ? { organization } : {}),
  manufacturerText: r.manufacturerText,
  modelText: r.modelText,
  firmwareText: r.firmwareText,
  notes: r.notes,
  status: r.status,
  resolutionNote: r.resolutionNote,
  createdAt: r.createdAt.toISOString(),
  resolvedAt: r.resolvedAt?.toISOString() ?? null,
});

/**
 * "My device is not in the list." Onboarding stops honestly and the customer asks for support; nothing is guessed.
 * Customers see their own requests (RLS); platform staff read all of them with the system role (reviewed use).
 */
@Injectable()
export class DeviceSupportService {
  constructor(
    private readonly tenant: TenantPrismaService,
    private readonly system: SystemPrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(organizationId: string, userId: string, input: { manufacturerText: string; modelText: string; firmwareText?: string | null; notes?: string | null }): Promise<SupportRequestDto> {
    const row = await this.tenant.run((tx) =>
      tx.deviceSupportRequest.create({
        data: { organizationId, requestedBy: userId, manufacturerText: input.manufacturerText, modelText: input.modelText, firmwareText: input.firmwareText ?? null, notes: input.notes ?? null },
      }),
    );
    await this.audit.record({ action: 'device_support.request', targetType: 'device_support_request', targetId: row.id, after: { manufacturerText: row.manufacturerText, modelText: row.modelText } });
    return toDto(row);
  }

  async listMine(): Promise<SupportRequestDto[]> {
    const rows = await this.tenant.run((tx) => tx.deviceSupportRequest.findMany({ orderBy: { createdAt: 'desc' }, take: 100 }));
    return rows.map((r) => toDto(r));
  }

  // ---------------------------------------------------------------- platform staff

  async listAll(page: number, pageSize: number, status?: SupportRequestStatus): Promise<PagedResult<SupportRequestDto>> {
    const where: Prisma.DeviceSupportRequestWhereInput = status ? { status } : {};
    const [total, rows] = await Promise.all([
      this.system.deviceSupportRequest.count({ where }),
      this.system.deviceSupportRequest.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
    ]);
    const orgs = await this.system.organization.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.organizationId))] } }, select: { id: true, name: true } });
    const byId = new Map(orgs.map((o) => [o.id, o]));
    return new PagedResult(rows.map((r) => toDto(r, byId.get(r.organizationId))), { page, pageSize, total });
  }

  async resolve(id: string, status: 'RESOLVED' | 'DECLINED', resolutionNote: string | null | undefined): Promise<SupportRequestDto> {
    const current = await this.system.deviceSupportRequest.findUnique({ where: { id } });
    if (!current) throw notFound('SUPPORT_REQUEST_NOT_FOUND');
    if (current.status !== 'OPEN') throw new AppException('SUPPORT_REQUEST_CLOSED', 409, 'This request is already closed');
    const row = await this.system.deviceSupportRequest.update({ where: { id }, data: { status, resolutionNote: resolutionNote ?? null, resolvedAt: new Date() } });
    await this.audit.record({ action: 'device_support.resolve', targetType: 'device_support_request', targetId: id, organizationId: row.organizationId, after: { status } });
    return toDto(row);
  }
}
