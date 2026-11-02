import type { Organization } from '@prisma/client';
import type { OrganizationDto } from '@gps/shared';

export const toOrganizationDto = (o: Organization): OrganizationDto => ({
  id: o.id,
  type: o.type,
  name: o.name,
  legalName: o.legalName,
  countryCode: o.countryCode,
  timezone: o.timezone,
  currencyCode: o.currencyCode,
  locale: o.locale,
  status: o.status,
  isSandbox: o.isSandbox,
  parentOrganizationId: o.parentOrganizationId,
});

export const isUuid = (v: unknown): v is string =>
  typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
