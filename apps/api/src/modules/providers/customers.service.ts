import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import {
  CUSTOMER_LIMIT_KEYS,
  ROLE_KEYS,
  isOperatingProvider,
  type CreateCustomerInput,
  type CustomerDto,
  type CustomerLimitDto,
  type CustomerLimitsInput,
} from '@gps/shared';
import { AppException, conflict, notFound } from '../../common/errors';
import { PagedResult } from '../../common/response';
import type { AppClsStore, TenantContext } from '../../common/request-context';
import { ENV, type Env } from '../../infrastructure/config/env';
import { TenantPrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { customerOwnerInvitationTemplate } from '../messaging/email-templates';
import { EMAIL_PORT, type EmailPort } from '../messaging/email.port';
import { randomToken, sha256 } from '../users/crypto';

/**
 * The provider's customer management (spec Module 17). Everything runs at PROVIDER level through RLS
 * (`app.current_provider_id`): the database itself keeps a provider inside its own tree. Staff scoped to some customers
 * are additionally filtered here, because RLS cannot express a staff member's customer list.
 */
@Injectable()
export class CustomersService {
  constructor(
    private readonly tenant: TenantPrismaService,
    private readonly audit: AuditService,
    private readonly cls: ClsService<AppClsStore>,
    @Inject(EMAIL_PORT) private readonly email: EmailPort,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private get ctx(): TenantContext {
    return this.cls.get('tenant')!;
  }

  /** The provider console is only for staff of the provider itself, working at provider level. */
  private assertProviderLevel(): void {
    if (this.ctx.organizationType !== 'PROVIDER' || this.ctx.actingAs !== 'MEMBER') throw notFound('ORGANIZATION_NOT_FOUND');
  }

  /** Restriction to the staff member's customers; empty = all of the provider's customers. */
  private scopeWhere(): Prisma.OrganizationWhereInput {
    const scope = this.tenant.customerScope();
    // Under AND so it can never replace an `id` the caller already filters on (a spread would).
    return scope ? { AND: [{ id: { in: [...scope] } }] } : {};
  }

  private async toDtos(tx: Prisma.TransactionClient, orgs: { id: string; name: string; legalName: string | null; status: 'ACTIVE' | 'SUSPENDED'; isSandbox: boolean; countryCode: string; createdAt: Date }[]): Promise<CustomerDto[]> {
    const ids = orgs.map((o) => o.id);
    const [vehicles, members, invitations] = await Promise.all([
      tx.vehicle.groupBy({ by: ['organizationId'], where: { organizationId: { in: ids }, deletedAt: null }, _count: { _all: true } }),
      tx.organizationMember.groupBy({ by: ['organizationId'], where: { organizationId: { in: ids }, status: 'ACTIVE' }, _count: { _all: true } }),
      tx.invitation.groupBy({ by: ['organizationId'], where: { organizationId: { in: ids }, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } }, _count: { _all: true } }),
    ]);
    const count = (rows: { organizationId: string; _count: { _all: number } }[], id: string) => rows.find((r) => r.organizationId === id)?._count._all ?? 0;
    return orgs.map((o) => ({
      id: o.id,
      name: o.name,
      legalName: o.legalName,
      status: o.status,
      isSandbox: o.isSandbox,
      countryCode: o.countryCode,
      createdAt: o.createdAt.toISOString(),
      vehicleCount: count(vehicles, o.id),
      memberCount: count(members, o.id),
      pendingInvitationCount: count(invitations, o.id),
    }));
  }

  async list(page: number, pageSize: number, search?: string): Promise<PagedResult<CustomerDto>> {
    this.assertProviderLevel();
    const where: Prisma.OrganizationWhereInput = {
      type: 'CUSTOMER',
      ...this.scopeWhere(),
      ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
    };
    return this.tenant.runAsProvider(async (tx) => {
      const [total, rows] = await Promise.all([
        tx.organization.count({ where }),
        tx.organization.findMany({ where, orderBy: { name: 'asc' }, skip: (page - 1) * pageSize, take: pageSize }),
      ]);
      return new PagedResult(await this.toDtos(tx, rows), { page, pageSize, total });
    });
  }

  async get(customerId: string): Promise<CustomerDto> {
    this.assertProviderLevel();
    return this.tenant.runAsProvider(async (tx) => {
      const org = await tx.organization.findFirst({ where: { id: customerId, type: 'CUSTOMER', ...this.scopeWhere() } });
      if (!org) throw notFound('CUSTOMER_NOT_FOUND');
      return (await this.toDtos(tx, [org]))[0]!;
    });
  }

  /**
   * Creates the customer organization and invites its first user as Owner. Customers of a provider that is not approved
   * yet are sandbox organizations: no real device can be registered for them (checked at device registration).
   */
  async create(input: CreateCustomerInput): Promise<CustomerDto> {
    this.assertProviderLevel();
    const providerId = this.ctx.organizationId;
    const ownerRole = await this.tenant.runAsProvider((tx) => tx.role.findUnique({ where: { key: ROLE_KEYS.ORG_OWNER } }));
    if (!ownerRole) throw new Error('System roles are not seeded (run db:seed)');
    const raw = randomToken();
    const expiresAt = new Date(Date.now() + this.env.INVITATION_TTL_DAYS * 86_400_000);

    const created = await this.tenant.runAsProvider(async (tx) => {
      const profile = await tx.providerProfile.findFirstOrThrow();
      const provider = await tx.organization.findUniqueOrThrow({ where: { id: providerId } });
      const org = await tx.organization.create({
        data: {
          type: 'CUSTOMER',
          parentOrganizationId: providerId,
          name: input.name,
          legalName: input.legalName,
          countryCode: input.countryCode ?? provider.countryCode,
          timezone: input.timezone ?? provider.timezone,
          currencyCode: provider.currencyCode,
          locale: provider.locale,
          isSandbox: !isOperatingProvider(profile.status),
        },
      });
      await tx.invitation.create({
        data: { organizationId: org.id, email: input.ownerEmail, roleId: ownerRole.id, tokenHash: sha256(raw), invitedByUserId: this.ctx.userId, expiresAt },
      });
      return { org, providerName: profile.displayName ?? profile.companyName };
    });

    await this.email.send({ to: input.ownerEmail, ...customerOwnerInvitationTemplate(this.env.APP_BASE_URL, raw, created.org.name, created.providerName) });
    await this.audit.record({
      action: 'customer.create',
      organizationId: created.org.id,
      targetType: 'customer',
      targetId: created.org.id,
      after: { name: created.org.name, sandbox: created.org.isSandbox },
    });
    return this.get(created.org.id).catch(() =>
      // A scoped staff member who creates a customer outside their own scope still gets the created record back.
      ({ id: created.org.id, name: created.org.name, legalName: created.org.legalName, status: 'ACTIVE' as const, isSandbox: created.org.isSandbox, countryCode: created.org.countryCode, createdAt: created.org.createdAt.toISOString(), vehicleCount: 0, memberCount: 0, pendingInvitationCount: 1 }),
    );
  }

  async update(customerId: string, input: { name?: string; legalName?: string | null }): Promise<CustomerDto> {
    this.assertProviderLevel();
    await this.tenant.runAsProvider(async (tx) => {
      const found = await tx.organization.findFirst({ where: { id: customerId, type: 'CUSTOMER', ...this.scopeWhere() }, select: { id: true } });
      if (!found) throw notFound('CUSTOMER_NOT_FOUND');
      await tx.organization.update({ where: { id: customerId }, data: input });
    });
    await this.audit.record({ action: 'customer.update', organizationId: customerId, targetType: 'customer', targetId: customerId, after: { fields: Object.keys(input) } });
    return this.get(customerId);
  }

  /** Same behaviour as provider suspension, scoped to one customer: the customer's users are blocked, ingestion continues. */
  async setSuspended(customerId: string, suspended: boolean, reason?: string): Promise<CustomerDto> {
    this.assertProviderLevel();
    const wanted = suspended ? 'SUSPENDED' : 'ACTIVE';
    await this.tenant.runAsProvider(async (tx) => {
      const org = await tx.organization.findFirst({ where: { id: customerId, type: 'CUSTOMER', ...this.scopeWhere() } });
      if (!org) throw notFound('CUSTOMER_NOT_FOUND');
      if (org.status === wanted) throw conflict('CUSTOMER_STATUS_UNCHANGED', suspended ? 'The customer is already suspended' : 'The customer is not suspended');
      await tx.organization.update({ where: { id: customerId }, data: { status: wanted } });
    });
    await this.audit.record({
      action: suspended ? 'customer.suspend' : 'customer.reactivate',
      organizationId: customerId,
      targetType: 'customer',
      targetId: customerId,
      after: { reason: reason ?? null },
    });
    return this.get(customerId);
  }

  // ------------------------------------------------------------------ per-customer limits

  async getLimits(customerId: string): Promise<CustomerLimitDto[]> {
    this.assertProviderLevel();
    return this.tenant.runAsProvider(async (tx) => {
      const org = await tx.organization.findFirst({ where: { id: customerId, type: 'CUSTOMER', ...this.scopeWhere() }, select: { id: true } });
      if (!org) throw notFound('CUSTOMER_NOT_FOUND');
      const rows = await tx.customerEntitlement.findMany({ where: { organizationId: customerId } });
      return CUSTOMER_LIMIT_KEYS.map((key) => {
        const r = rows.find((x) => x.key === key);
        return { key, enabled: r?.enabled ?? null, limitValue: r?.limitValue ?? null };
      });
    });
  }

  /** Stored now; the effective entitlement (provider plan ∩ customer limit) is enforced when plans arrive in M10. */
  async setLimits(customerId: string, input: CustomerLimitsInput): Promise<CustomerLimitDto[]> {
    this.assertProviderLevel();
    await this.tenant.runAsProvider(async (tx) => {
      const org = await tx.organization.findFirst({ where: { id: customerId, type: 'CUSTOMER', ...this.scopeWhere() }, select: { id: true } });
      if (!org) throw notFound('CUSTOMER_NOT_FOUND');
      for (const l of input.limits) {
        await tx.customerEntitlement.upsert({
          where: { organizationId_key: { organizationId: customerId, key: l.key } },
          create: { organizationId: customerId, key: l.key, enabled: l.enabled, limitValue: l.limitValue, updatedBy: this.ctx.userId },
          update: { enabled: l.enabled, limitValue: l.limitValue, updatedBy: this.ctx.userId },
        });
      }
    });
    await this.audit.record({
      action: 'customer.limits_update',
      organizationId: customerId,
      targetType: 'customer',
      targetId: customerId,
      after: { keys: input.limits.map((l) => l.key) },
    });
    return this.getLimits(customerId);
  }

  // ------------------------------------------------------------------ provider staff scope

  /** `customerIds` null = the staff member may act for all customers; a list limits them to those customers. */
  async setStaffScope(memberId: string, customerIds: string[] | null): Promise<{ memberId: string; customerIds: string[] | null }> {
    this.assertProviderLevel();
    const providerId = this.ctx.organizationId;
    await this.tenant.runAsProvider(async (tx) => {
      const member = await tx.organizationMember.findFirst({ where: { id: memberId, organizationId: providerId } });
      if (!member) throw notFound('MEMBER_NOT_FOUND');
      if (customerIds) {
        const valid = await tx.organization.count({ where: { id: { in: customerIds }, type: 'CUSTOMER', providerId } });
        if (valid !== new Set(customerIds).size) throw new AppException('CUSTOMER_NOT_FOUND', 404, 'One of the customers was not found');
      }
      await tx.memberCustomerScope.deleteMany({ where: { organizationId: providerId, memberId } });
      if (customerIds) {
        await tx.memberCustomerScope.createMany({
          data: [...new Set(customerIds)].map((customerOrganizationId) => ({ organizationId: providerId, memberId, customerOrganizationId })),
        });
      }
      await tx.organizationMember.update({ where: { id: memberId }, data: { scopedToCustomers: customerIds !== null } });
    });
    await this.audit.record({
      action: 'provider.staff_scope',
      targetType: 'member',
      targetId: memberId,
      after: { scoped: customerIds !== null, customerCount: customerIds?.length ?? null },
    });
    return { memberId, customerIds };
  }
}
