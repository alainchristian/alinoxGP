import { Inject, Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { ROLE_KEYS, ROLE_SCOPE_FOR_ORG_TYPE, type InvitationDto, type MemberDto } from '@gps/shared';
import { AppException, conflict, forbidden, notFound } from '../../common/errors';
import { PagedResult } from '../../common/response';
import type { AppClsStore, TenantContext } from '../../common/request-context';
import { ENV, type Env } from '../../infrastructure/config/env';
import { PrismaService, TenantPrismaService } from '../../infrastructure/prisma/prisma.service';
import { AccessService } from '../access-control/access.service';
import { AuditService } from '../audit/audit.service';
import { invitationTemplate } from '../messaging/email-templates';
import { EMAIL_PORT, type EmailPort } from '../messaging/email.port';
import { randomToken, sha256 } from '../users/crypto';

/** Roles that cannot be handed out through invitations or member updates (ownership transfer comes later). */
const NOT_ASSIGNABLE = new Set<string>([ROLE_KEYS.ORG_OWNER, ROLE_KEYS.PLATFORM_SUPER_ADMIN]);

@Injectable()
export class MembersService {
  constructor(
    private readonly tenant: TenantPrismaService,
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly cls: ClsService<AppClsStore>,
    @Inject(EMAIL_PORT) private readonly email: EmailPort,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private get ctx(): TenantContext {
    return this.cls.get('tenant')!;
  }

  async list(page: number, pageSize: number): Promise<PagedResult<MemberDto>> {
    const [total, rows] = await this.tenant.run(async (tx) =>
      Promise.all([
        tx.organizationMember.count(),
        tx.organizationMember.findMany({
          include: { user: { select: { id: true, email: true, fullName: true } }, roles: { include: { role: true } } },
          orderBy: { createdAt: 'asc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ]),
    );
    const items: MemberDto[] = rows.map((m) => ({
      memberId: m.id,
      userId: m.user.id,
      email: m.user.email,
      fullName: m.user.fullName,
      status: m.status,
      roleKeys: m.roles.map((r) => r.role.key),
      createdAt: m.createdAt.toISOString(),
    }));
    return new PagedResult(items, { page, pageSize, total });
  }

  /** Validates that `roleKey` may be granted here by the current actor (scope, assignability, no escalation). */
  private async assertGrantable(roleKey: string) {
    const role = await this.prisma.role.findUnique({
      where: { key: roleKey },
      include: { permissions: { include: { permission: true } } },
    });
    if (!role || role.scope !== ROLE_SCOPE_FOR_ORG_TYPE[this.ctx.organizationType]) {
      throw new AppException('ROLE_NOT_FOUND', 404, 'Role not found');
    }
    if (NOT_ASSIGNABLE.has(role.key)) throw forbidden('ROLE_NOT_ASSIGNABLE', 'This role cannot be assigned here');
    // Privilege-escalation guard: you cannot hand out permissions you do not hold yourself.
    const missing = role.permissions.map((p) => p.permission.key).filter((k) => !this.ctx.permissions.has(k));
    if (missing.length > 0) throw forbidden('ROLE_EXCEEDS_YOUR_PERMISSIONS', 'You cannot grant a role more powerful than your own');
    return role;
  }

  async invite(email: string, roleKey: string): Promise<InvitationDto> {
    const role = await this.assertGrantable(roleKey);
    const orgId = this.ctx.organizationId;

    const existingUser = await this.prisma.user.findUnique({ where: { email } });
    const raw = randomToken();
    const expiresAt = new Date(Date.now() + this.env.INVITATION_TTL_DAYS * 86_400_000);

    const invitation = await this.tenant.run(async (tx) => {
      if (existingUser) {
        const already = await tx.organizationMember.findUnique({
          where: { organizationId_userId: { organizationId: orgId, userId: existingUser.id } },
        });
        if (already) throw conflict('ALREADY_MEMBER', 'This person is already a member of the organization');
      }
      await tx.invitation.updateMany({
        where: { email, acceptedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return tx.invitation.create({
        data: {
          organizationId: orgId,
          email,
          roleId: role.id,
          tokenHash: sha256(raw),
          invitedByUserId: this.ctx.userId,
          expiresAt,
        },
      });
    });

    const org = await this.tenant.run((tx) => tx.organization.findUnique({ where: { id: orgId } }));
    const inviter = await this.prisma.user.findUnique({ where: { id: this.ctx.userId } });
    const mail = invitationTemplate(this.env.APP_BASE_URL, raw, org?.name ?? 'an organization', inviter?.fullName ?? 'A colleague');
    await this.email.send({ to: email, ...mail });
    await this.audit.record({
      action: 'member.invite',
      targetType: 'invitation',
      targetId: invitation.id,
      after: { email, roleKey },
    });
    return { id: invitation.id, email, roleKey, expiresAt: expiresAt.toISOString(), createdAt: invitation.createdAt.toISOString() };
  }

  async listInvitations(): Promise<InvitationDto[]> {
    const rows = await this.tenant.run((tx) =>
      tx.invitation.findMany({
        where: { acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
        include: { role: true },
        orderBy: { createdAt: 'desc' },
      }),
    );
    return rows.map((i) => ({
      id: i.id,
      email: i.email,
      roleKey: i.role.key,
      expiresAt: i.expiresAt.toISOString(),
      createdAt: i.createdAt.toISOString(),
    }));
  }

  async revokeInvitation(invitationId: string): Promise<void> {
    const res = await this.tenant.run((tx) =>
      tx.invitation.updateMany({ where: { id: invitationId, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } }),
    );
    if (res.count === 0) throw notFound('INVITATION_NOT_FOUND');
    await this.audit.record({ action: 'member.invitation_revoke', targetType: 'invitation', targetId: invitationId });
  }

  private async loadTarget(memberId: string) {
    const target = await this.tenant.run((tx) =>
      tx.organizationMember.findUnique({
        where: { id: memberId },
        include: { roles: { include: { role: true } } },
      }),
    );
    if (!target) throw notFound('MEMBER_NOT_FOUND');
    if (target.id === this.ctx.memberId) throw forbidden('CANNOT_MODIFY_SELF', 'You cannot change your own membership');
    if (target.roles.some((r) => r.role.key === ROLE_KEYS.ORG_OWNER)) {
      throw forbidden('OWNER_PROTECTED', 'The organization owner cannot be changed or removed');
    }
    return target;
  }

  async update(memberId: string, input: { roleKeys?: string[]; status?: 'ACTIVE' | 'SUSPENDED' }): Promise<MemberDto> {
    const target = await this.loadTarget(memberId);
    const orgId = this.ctx.organizationId;
    const roles = input.roleKeys ? await Promise.all([...new Set(input.roleKeys)].map((k) => this.assertGrantable(k))) : null;

    await this.tenant.run(async (tx) => {
      if (roles) {
        await tx.memberRole.deleteMany({ where: { memberId } });
        await tx.memberRole.createMany({
          data: roles.map((r) => ({ organizationId: orgId, memberId, roleId: r.id })),
        });
      }
      if (input.status) await tx.organizationMember.update({ where: { id: memberId }, data: { status: input.status } });
    });
    await this.access.invalidate(orgId, memberId);
    await this.audit.record({
      action: 'member.update',
      targetType: 'member',
      targetId: memberId,
      before: { roleKeys: target.roles.map((r) => r.role.key), status: target.status },
      after: { roleKeys: input.roleKeys ?? target.roles.map((r) => r.role.key), status: input.status ?? target.status },
    });
    const m = await this.tenant.run((tx) =>
      tx.organizationMember.findUnique({
        where: { id: memberId },
        include: { user: { select: { id: true, email: true, fullName: true } }, roles: { include: { role: true } } },
      }),
    );
    if (!m) throw notFound('MEMBER_NOT_FOUND');
    return {
      memberId: m.id,
      userId: m.user.id,
      email: m.user.email,
      fullName: m.user.fullName,
      status: m.status,
      roleKeys: m.roles.map((r) => r.role.key),
      createdAt: m.createdAt.toISOString(),
    };
  }

  async remove(memberId: string): Promise<void> {
    const target = await this.loadTarget(memberId);
    await this.tenant.run((tx) => tx.organizationMember.delete({ where: { id: memberId } }));
    await this.access.invalidate(this.ctx.organizationId, memberId);
    await this.audit.record({
      action: 'member.remove',
      targetType: 'member',
      targetId: memberId,
      before: { userId: target.userId, roleKeys: target.roles.map((r) => r.role.key) },
    });
  }
}
