import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Organization } from '@prisma/client';
import Redis from 'ioredis';
import { P, type MembershipDto } from '@gps/shared';
import { SystemPrismaService } from '../../infrastructure/prisma/prisma.service';
import { REDIS } from '../../infrastructure/redis/redis.module';
import { toOrganizationDto } from '../../common/mappers';

export interface ResolvedAccess {
  organization: Organization;
  /** Membership that grants access (lives in `actorOrganizationId`). */
  memberId: string;
  actorOrganizationId: string;
  actingAs: 'MEMBER' | 'RESELLER_PARENT';
  permissions: ReadonlySet<string>;
}

const PERMISSION_CACHE_TTL_SECONDS = 300;
const permKey = (orgId: string, memberId: string) => `org:${orgId}:member:${memberId}:perms`;

/** A reseller acting for a child customer is read-only until reseller management is designed (M9). */
const readOnly = (keys: Iterable<string>) =>
  new Set([...keys].filter((k) => k.endsWith('.read') || k.endsWith('.view')));

/**
 * Resolves "may this user act in this organization, and with which permissions?".
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
      return {
        organization: org,
        memberId: member.id,
        actorOrganizationId: org.id,
        actingAs: 'MEMBER',
        permissions: await this.permissionsFor(org.id, member.id),
      };
    }
    if (member) return null; // suspended members are treated as non-members

    if (org.parentOrganizationId) {
      const parent = await this.system.organization.findUnique({ where: { id: org.parentOrganizationId } });
      if (parent?.type === 'RESELLER' && parent.status === 'ACTIVE') {
        const parentMember = await this.system.organizationMember.findUnique({
          where: { organizationId_userId: { organizationId: parent.id, userId } },
        });
        if (parentMember?.status === 'ACTIVE') {
          const perms = await this.permissionsFor(parent.id, parentMember.id);
          if (perms.has(P.RESELLER_CUSTOMERS_READ)) {
            return {
              organization: org,
              memberId: parentMember.id,
              actorOrganizationId: parent.id,
              actingAs: 'RESELLER_PARENT',
              permissions: readOnly(perms),
            };
          }
        }
      }
    }
    return null;
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

  /** Organizations the user belongs to, plus child customers for resellers who may read them. */
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
      if (m.organization.type === 'RESELLER' && m.organization.status === 'ACTIVE') {
        const perms = await this.permissionsFor(m.organizationId, m.id);
        if (perms.has(P.RESELLER_CUSTOMERS_READ)) {
          const children = await this.system.organization.findMany({
            where: { parentOrganizationId: m.organizationId },
            orderBy: { name: 'asc' },
          });
          for (const c of children) {
            result.push({ memberId: m.id, organization: toOrganizationDto(c), roleKeys: [], relation: 'CHILD' });
          }
        }
      }
    }
    return result;
  }
}
