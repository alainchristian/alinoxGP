import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Organization } from '@prisma/client';
import Redis from 'ioredis';
import { permissionsActingOnCustomer, type MembershipDto } from '@gps/shared';
import { SystemPrismaService } from '../../infrastructure/prisma/prisma.service';
import { REDIS } from '../../infrastructure/redis/redis.module';
import { toOrganizationDto } from '../../common/mappers';

export interface ResolvedAccess {
  organization: Organization;
  /** Membership that grants access (lives in `actorOrganizationId`). */
  memberId: string;
  actorOrganizationId: string;
  actingAs: 'MEMBER' | 'PROVIDER_STAFF';
  /** Provider staff: 'ALL' or the customers this member is limited to. Always 'ALL' for other members. */
  customerScope: 'ALL' | readonly string[];
  /** True when a customer's provider is suspended: the customer sees a neutral "contact your provider" message (ingestion continues). */
  providerSuspended: boolean;
  permissions: ReadonlySet<string>;
}

const PERMISSION_CACHE_TTL_SECONDS = 300;
const permKey = (orgId: string, memberId: string) => `org:${orgId}:member:${memberId}:perms`;

/**
 * Resolves "may this user act in this organization, and with which permissions?" (ADR-0010).
 *  - A member of the organization acts with their own roles.
 *  - Staff of the PROVIDER of a customer organization act for it with permissions DERIVED from their provider roles
 *    (`permissionsActingOnCustomer`), limited to the customers they are scoped to. They are not members of the customer.
 * Uses the system client because it runs BEFORE a tenant context exists (it is what creates it).
 * See SystemPrismaService for the list of reviewed uses.
 */
@Injectable()
export class AccessService {
  private readonly logger = new Logger(AccessService.name);

  constructor(
    private readonly system: SystemPrismaService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async resolve(userId: string, organizationId: string): Promise<ResolvedAccess | null> {
    const org = await this.system.organization.findUnique({ where: { id: organizationId } });
    if (!org) return null;

    const member = await this.system.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
    });
    if (member?.status === 'ACTIVE') {
      const owner = org.type === 'CUSTOMER' && org.providerId ? await this.system.organization.findUnique({ where: { id: org.providerId }, select: { status: true } }) : null;
      return {
        providerSuspended: owner?.status === 'SUSPENDED',
        organization: org,
        memberId: member.id,
        actorOrganizationId: org.id,
        actingAs: 'MEMBER',
        customerScope: org.type === 'PROVIDER' ? await this.scopeOf(member) : 'ALL',
        permissions: await this.permissionsFor(org.id, member.id),
      };
    }
    if (member) return null; // suspended members are treated as non-members

    // Provider staff acting for one of the provider's customers.
    if (org.type === 'CUSTOMER' && org.providerId) {
      const provider = await this.system.organization.findUnique({ where: { id: org.providerId } });
      if (provider?.type !== 'PROVIDER' || provider.status !== 'ACTIVE') return null;
      const staff = await this.system.organizationMember.findUnique({
        where: { organizationId_userId: { organizationId: provider.id, userId } },
      });
      if (staff?.status !== 'ACTIVE') return null;
      const customerScope = await this.scopeOf(staff);
      if (customerScope !== 'ALL' && !customerScope.includes(org.id)) return null;
      const acting = permissionsActingOnCustomer(await this.permissionsFor(provider.id, staff.id));
      if (acting.size === 0) return null;
      return {
        providerSuspended: false,
        organization: org,
        memberId: staff.id,
        actorOrganizationId: provider.id,
        actingAs: 'PROVIDER_STAFF',
        customerScope,
        permissions: acting,
      };
    }
    return null;
  }

  /** 'ALL' unless the provider staff member is limited to a list of customers. */
  private async scopeOf(member: { id: string; organizationId: string; scopedToCustomers: boolean }): Promise<'ALL' | string[]> {
    if (!member.scopedToCustomers) return 'ALL';
    const rows = await this.system.memberCustomerScope.findMany({
      where: { organizationId: member.organizationId, memberId: member.id },
      select: { customerOrganizationId: true },
    });
    return rows.map((r) => r.customerOrganizationId);
  }

  async permissionsFor(organizationId: string, memberId: string): Promise<ReadonlySet<string>> {
    const key = permKey(organizationId, memberId);
    try {
      const cached = await this.redis.get(key);
      if (cached) return new Set(JSON.parse(cached) as string[]);
    } catch (err) {
      this.logger.warn(`Permission cache read failed, using database (${String(err)})`);
    }
    const rows = await this.system.permission.findMany({
      where: { roles: { some: { role: { memberRoles: { some: { memberId, organizationId } } } } } },
      select: { key: true },
    });
    const keys = rows.map((r) => r.key);
    try {
      await this.redis.set(key, JSON.stringify(keys), 'EX', PERMISSION_CACHE_TTL_SECONDS);
    } catch {
      /* cache is best-effort */
    }
    return new Set(keys);
  }

  /** Call whenever a member's roles or status change, or the member is removed. */
  async invalidate(organizationId: string, memberId: string): Promise<void> {
    try {
      await this.redis.del(permKey(organizationId, memberId));
    } catch (err) {
      this.logger.warn(`Permission cache invalidation failed; entry expires within ${PERMISSION_CACHE_TTL_SECONDS}s`);
      void err;
    }
  }

  async defaultOrganizationId(userId: string): Promise<string | null> {
    const m = await this.system.organizationMember.findFirst({
      where: { userId, status: 'ACTIVE', organization: { status: 'ACTIVE' } },
      orderBy: { createdAt: 'asc' },
      select: { organizationId: true },
    });
    return m?.organizationId ?? null;
  }

  /** Organizations the user belongs to, plus the customers of a provider the user is staff of (within their scope). */
  async listMemberships(userId: string): Promise<MembershipDto[]> {
    const members = await this.system.organizationMember.findMany({
      where: { userId, status: 'ACTIVE' },
      include: { organization: true, roles: { include: { role: true } } },
      orderBy: { createdAt: 'asc' },
    });
    const result: MembershipDto[] = [];
    for (const m of members) {
      result.push({
        memberId: m.id,
        organization: toOrganizationDto(m.organization),
        roleKeys: m.roles.map((r) => r.role.key),
        relation: 'MEMBER',
      });
      if (m.organization.type === 'PROVIDER' && m.organization.status === 'ACTIVE') {
        const acting = permissionsActingOnCustomer(await this.permissionsFor(m.organizationId, m.id));
        if (acting.size > 0) {
          const scope = await this.scopeOf(m);
          const customers = await this.system.organization.findMany({
            where: { providerId: m.organizationId, type: 'CUSTOMER', ...(scope === 'ALL' ? {} : { id: { in: [...scope] } }) },
            orderBy: { name: 'asc' },
          });
          for (const c of customers) {
            result.push({ memberId: m.id, organization: toOrganizationDto(c), roleKeys: [], relation: 'CUSTOMER' });
          }
        }
      }
    }
    return result;
  }
}
