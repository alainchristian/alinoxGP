import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ClsService } from 'nestjs-cls';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  NEUTRAL_BRANDING,
  P,
  PROVIDER_STATUSES,
  brandingUpdateSchema,
  createCustomerSchema,
  customerLimitsSchema,
  pageQuerySchema,
  providerApproveSchema,
  providerDecisionSchema,
  providerRegistrationSchema,
  staffScopeSchema,
  type BrandingDto,
} from '@gps/shared';
import { Public, RequirePermissions, RequireStepUp } from '../../common/decorators';
import { notFound } from '../../common/errors';
import { PagedResult } from '../../common/response';
import type { AppClsStore } from '../../common/request-context';
import { SystemPrismaService, TenantPrismaService } from '../../infrastructure/prisma/prisma.service';
import { AUTH_THROTTLE } from '../../common/throttle';
import { CustomersService } from './customers.service';
import { ProviderFleetService } from './provider-fleet.service';
import { ProvidersService, toBrandingDto } from './providers.service';
import { CUSTOMERS_SERVED } from './provider-lifecycle';

class RegisterProviderDto extends createZodDto(providerRegistrationSchema) {}
class BrandingUpdateDto extends createZodDto(brandingUpdateSchema) {}
class CreateCustomerDto extends createZodDto(createCustomerSchema) {}
class UpdateCustomerDto extends createZodDto(z.object({ name: z.string().trim().min(2).max(120).optional(), legalName: z.string().trim().max(200).nullable().optional() })) {}
class ReasonDto extends createZodDto(providerDecisionSchema) {}
class OptionalReasonDto extends createZodDto(z.object({ reason: z.string().trim().max(500).optional() })) {}
class ApproveDto extends createZodDto(providerApproveSchema) {}
class LimitsDto extends createZodDto(customerLimitsSchema) {}
class ScopeDto extends createZodDto(staffScopeSchema) {}
class CustomerListDto extends createZodDto(pageQuerySchema.extend({ search: z.string().trim().max(100).optional() })) {}
class AdminListDto extends createZodDto(pageQuerySchema.extend({ status: z.enum(PROVIDER_STATUSES).optional(), search: z.string().trim().max(100).optional() })) {}
class ResolveBrandingDto extends createZodDto(z.object({ slug: z.string().trim().toLowerCase().max(40).optional() })) {}

/** Public: a GPS tracking business applies to use the platform. End customers never sign up themselves (spec Module 1). */
@ApiTags('Providers')
@Controller('providers')
export class ProvidersPublicController {
  constructor(private readonly providers: ProvidersService) {}

  @Post('register')
  @Public()
  @HttpCode(202)
  @Throttle(AUTH_THROTTLE)
  async register(@Body() body: RegisterProviderDto) {
    await this.providers.register(body);
    return { accepted: true };
  }
}

/** Platform administrators: review registrations, approve, reject, suspend, reactivate. */
@ApiTags('Platform admin')
@Controller('admin/providers')
export class AdminProvidersController {
  constructor(
    private readonly providers: ProvidersService,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  private get userId() {
    return this.cls.get('auth')!.userId;
  }

  @Get()
  @RequirePermissions(P.PLATFORM_PROVIDERS_READ)
  list(@Query() q: AdminListDto) {
    return this.providers.adminList(q.page, q.pageSize, q.status, q.search);
  }

  @Get(':providerId')
  @RequirePermissions(P.PLATFORM_PROVIDERS_READ)
  get(@Param('providerId', ParseUUIDPipe) id: string) {
    return this.providers.adminGet(id);
  }

  @Post(':providerId/approve')
  @HttpCode(200)
  @RequirePermissions(P.PLATFORM_PROVIDERS_APPROVE)
  @RequireStepUp()
  approve(@Param('providerId', ParseUUIDPipe) id: string, @Body() body: ApproveDto) {
    return this.providers.approve(id, this.userId, body);
  }

  @Post(':providerId/reject')
  @HttpCode(200)
  @RequirePermissions(P.PLATFORM_PROVIDERS_APPROVE)
  @RequireStepUp()
  reject(@Param('providerId', ParseUUIDPipe) id: string, @Body() body: ReasonDto) {
    return this.providers.reject(id, this.userId, body.reason);
  }

  @Post(':providerId/suspend')
  @HttpCode(200)
  @RequirePermissions(P.PLATFORM_PROVIDERS_SUSPEND)
  @RequireStepUp()
  suspend(@Param('providerId', ParseUUIDPipe) id: string, @Body() body: ReasonDto) {
    return this.providers.suspend(id, this.userId, body.reason);
  }

  @Post(':providerId/reactivate')
  @HttpCode(200)
  @RequirePermissions(P.PLATFORM_PROVIDERS_SUSPEND)
  @RequireStepUp()
  reactivate(@Param('providerId', ParseUUIDPipe) id: string) {
    return this.providers.reactivate(id, this.userId);
  }
}

/** The provider console: the provider's own profile, branding, customers, limits and staff scopes. */
@ApiTags('Provider console')
@Controller('organizations/:organizationId/provider')
export class ProviderConsoleController {
  constructor(
    private readonly providers: ProvidersService,
    private readonly customers: CustomersService,
    private readonly fleet: ProviderFleetService,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  private providerLevel() {
    const t = this.cls.get('tenant')!;
    if (t.organizationType !== 'PROVIDER' || t.actingAs !== 'MEMBER') throw notFound('ORGANIZATION_NOT_FOUND');
    return t;
  }

  @Get('profile')
  @RequirePermissions(P.ORGANIZATION_READ)
  profile() {
    this.providerLevel();
    return this.providers.myProfile();
  }

  @Patch('branding')
  @RequirePermissions(P.PROVIDER_BRANDING_MANAGE)
  branding(@Body() body: BrandingUpdateDto) {
    return this.providers.updateBranding(body, this.providerLevel().userId);
  }

  /** Latest state of every vehicle of every customer in the staff member's scope (the provider-wide live map). */
  @Get('fleet/snapshot')
  @RequirePermissions(P.PROVIDER_CUSTOMERS_VIEW_DATA)
  fleetSnapshot() {
    return this.fleet.snapshot();
  }

  @Get('customers')
  @RequirePermissions(P.PROVIDER_CUSTOMERS_READ)
  customerList(@Query() q: CustomerListDto) {
    return this.customers.list(q.page, q.pageSize, q.search);
  }

  @Post('customers')
  @RequirePermissions(P.PROVIDER_CUSTOMERS_MANAGE)
  customerCreate(@Body() body: CreateCustomerDto) {
    return this.customers.create(body);
  }

  @Get('customers/:customerId')
  @RequirePermissions(P.PROVIDER_CUSTOMERS_READ)
  customerGet(@Param('customerId', ParseUUIDPipe) id: string) {
    return this.customers.get(id);
  }

  @Patch('customers/:customerId')
  @RequirePermissions(P.PROVIDER_CUSTOMERS_MANAGE)
  customerUpdate(@Param('customerId', ParseUUIDPipe) id: string, @Body() body: UpdateCustomerDto) {
    return this.customers.update(id, body);
  }

  @Post('customers/:customerId/suspend')
  @HttpCode(200)
  @RequirePermissions(P.PROVIDER_CUSTOMERS_SUSPEND)
  @RequireStepUp()
  customerSuspend(@Param('customerId', ParseUUIDPipe) id: string, @Body() body: OptionalReasonDto) {
    return this.customers.setSuspended(id, true, body.reason);
  }

  @Post('customers/:customerId/reactivate')
  @HttpCode(200)
  @RequirePermissions(P.PROVIDER_CUSTOMERS_SUSPEND)
  customerReactivate(@Param('customerId', ParseUUIDPipe) id: string) {
    return this.customers.setSuspended(id, false);
  }

  @Get('customers/:customerId/limits')
  @RequirePermissions(P.PROVIDER_CUSTOMERS_READ)
  limits(@Param('customerId', ParseUUIDPipe) id: string) {
    return this.customers.getLimits(id);
  }

  @Put('customers/:customerId/limits')
  @RequirePermissions(P.PROVIDER_CUSTOMERS_LIMITS_MANAGE)
  setLimits(@Param('customerId', ParseUUIDPipe) id: string, @Body() body: LimitsDto) {
    return this.customers.setLimits(id, body);
  }

  @Put('staff/:memberId/scope')
  @RequirePermissions(P.PROVIDER_STAFF_MANAGE)
  @RequireStepUp()
  staffScope(@Param('memberId', ParseUUIDPipe) memberId: string, @Body() body: ScopeDto) {
    return this.customers.setStaffScope(memberId, body.customerIds);
  }
}

/** Public and in-app branding. Display data only; an unknown address gets the neutral branding, never an error. */
@ApiTags('Branding')
@Controller()
export class BrandingController {
  constructor(
    private readonly system: SystemPrismaService,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  @Get('branding/resolve')
  @Public()
  async resolve(@Query() q: ResolveBrandingDto): Promise<BrandingDto> {
    if (!q.slug) return NEUTRAL_BRANDING;
    const p = await this.system.providerProfile.findUnique({ where: { slug: q.slug } });
    if (!p || ![...CUSTOMERS_SERVED, 'SUSPENDED'].includes(p.status)) return NEUTRAL_BRANDING;
    return toBrandingDto(p);
  }

  /** Branding of the provider that serves the active organization (customer, or the provider itself). */
  @Get('organizations/:organizationId/branding')
  @RequirePermissions(P.ORGANIZATION_READ)
  async mine(): Promise<BrandingDto> {
    const providerId = this.cls.get('tenant')!.providerId;
    if (!providerId) return NEUTRAL_BRANDING;
    const p = await this.system.providerProfile.findUnique({ where: { organizationId: providerId } });
    return p ? toBrandingDto(p) : NEUTRAL_BRANDING;
  }
}

/** The customer's owner sees who at the provider or the platform looked at their data (spec §6). */
@ApiTags('Organizations')
@Controller('organizations/:organizationId/access-log')
export class AccessLogController {
  constructor(private readonly tenant: TenantPrismaService, private readonly system: SystemPrismaService) {}

  @Get()
  @RequirePermissions(P.ORGANIZATION_ACCESS_LOG_READ)
  async list(@Query() q: z.infer<typeof pageQuerySchema>) {
    const page = Number(q.page ?? 1);
    const pageSize = Math.min(Number(q.pageSize ?? 25), 100);
    const where = { action: { startsWith: 'access.' } };
    const [total, rows] = await this.tenant.run((tx) =>
      Promise.all([
        tx.auditLog.count({ where }),
        tx.auditLog.findMany({ where, orderBy: { at: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      ]),
    );
    const users = await this.system.user.findMany({ where: { id: { in: rows.map((r) => r.actorUserId).filter((x): x is string => !!x) } }, select: { id: true, fullName: true } });
    const items = rows.map((r) => ({
      at: r.at.toISOString(),
      action: r.action,
      area: r.targetId,
      actorName: users.find((u) => u.id === r.actorUserId)?.fullName ?? null,
      actorOrganization: (r.after as { providerOrganizationId?: string } | null)?.providerOrganizationId ? 'Your provider' : 'Platform',
    }));
    return new PagedResult(items, { page, pageSize, total });
  }
}
