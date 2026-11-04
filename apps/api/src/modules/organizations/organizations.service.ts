import { Injectable } from '@nestjs/common';
import type { OrganizationDto, UpdateOrganizationInput } from '@gps/shared';
import { badRequest, notFound } from '../../common/errors';
import { toOrganizationDto } from '../../common/mappers';
import { SystemPrismaService, TenantPrismaService } from '../../infrastructure/prisma/prisma.service';
import { AccessService } from '../access-control/access.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly system: SystemPrismaService,
    private readonly tenant: TenantPrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  listForUser(userId: string) {
    return this.access.listMemberships(userId);
  }

  /** RLS exposes the current organization and its direct children; the id selects the one requested. */
  async getById(id: string): Promise<OrganizationDto> {
    const org = await this.tenant.run((tx) => tx.organization.findUnique({ where: { id } }));
    if (!org) throw notFound('ORGANIZATION_NOT_FOUND');
    return toOrganizationDto(org);
  }

  async update(id: string, input: UpdateOrganizationInput): Promise<OrganizationDto> {
    const before = await this.tenant.run((tx) => tx.organization.findUnique({ where: { id } }));
    if (!before) throw notFound('ORGANIZATION_NOT_FOUND');
    if (input.countryCode) {
      const country = await this.system.country.findUnique({ where: { code: input.countryCode } });
      if (!country || !country.enabled) throw badRequest('COUNTRY_NOT_SUPPORTED', 'This country is not available yet');
    }
    const updated = await this.tenant.run((tx) => tx.organization.update({ where: { id }, data: input }));
    await this.audit.record({
      action: 'organization.update',
      targetType: 'organization',
      targetId: id,
      before: { name: before.name, timezone: before.timezone, currencyCode: before.currencyCode },
      after: { name: updated.name, timezone: updated.timezone, currencyCode: updated.currencyCode },
    });
    return toOrganizationDto(updated);
  }
}
