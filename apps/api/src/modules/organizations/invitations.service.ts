import { Injectable } from '@nestjs/common';
import { AppException, conflict, notFound } from '../../common/errors';
import { SystemPrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { sha256 } from '../users/crypto';
import { UsersService } from '../users/users.service';

/**
 * Invitation acceptance. The invitation token is a bearer secret that identifies the organization, so
 * lookup and acceptance run on the system client (there is no tenant context yet; one of the reviewed
 * system uses). Tokens are single-use, expire, and are stored hashed.
 */
@Injectable()
export class InvitationsService {
  constructor(
    private readonly system: SystemPrismaService,
    private readonly users: UsersService,
    private readonly audit: AuditService,
  ) {}

  private async findValid(token: string) {
    const inv = await this.system.invitation.findUnique({
      where: { tokenHash: sha256(token) },
      include: { organization: true, role: true },
    });
    if (!inv || inv.acceptedAt || inv.revokedAt || inv.expiresAt < new Date() || inv.organization.status !== 'ACTIVE') {
      throw notFound('INVITATION_NOT_FOUND', 'This invitation is invalid or has expired');
    }
    return inv;
  }

  async lookup(token: string) {
    const inv = await this.findValid(token);
    const account = await this.users.findByEmail(inv.email);
    return {
      organizationName: inv.organization.name,
      email: inv.email,
      roleName: inv.role.name,
      accountExists: account !== null,
    };
  }

  private async accept(inv: Awaited<ReturnType<InvitationsService['findValid']>>, userId: string) {
    await this.system.$transaction(async (tx) => {
      const claimed = await tx.invitation.updateMany({
        where: { id: inv.id, acceptedAt: null, revokedAt: null },
        data: { acceptedAt: new Date() },
      });
      if (claimed.count !== 1) throw notFound('INVITATION_NOT_FOUND', 'This invitation is invalid or has expired');
      const member = await tx.organizationMember.create({ data: { organizationId: inv.organizationId, userId } });
      await tx.memberRole.create({
        data: { organizationId: inv.organizationId, memberId: member.id, roleId: inv.roleId },
      });
    });
    await this.audit.record({
      action: 'member.invitation_accept',
      organizationId: inv.organizationId,
      actorUserId: userId,
      targetType: 'invitation',
      targetId: inv.id,
    });
    return { organizationId: inv.organizationId };
  }

  /** New person: the invitation proves control of the email address, so the account is created verified. */
  async acceptNewUser(token: string, password: string, fullName: string) {
    const inv = await this.findValid(token);
    if (await this.users.findByEmail(inv.email)) {
      throw conflict('ACCOUNT_EXISTS_LOGIN_REQUIRED', 'An account with this email exists. Sign in to accept the invitation.');
    }
    const user = await this.users.create({
      email: inv.email,
      passwordHash: await this.users.hashPassword(password),
      fullName,
      emailVerified: true,
    });
    return this.accept(inv, user.id);
  }

  async acceptExisting(token: string, userId: string) {
    const inv = await this.findValid(token);
    const user = await this.users.findById(userId);
    if (!user || user.email !== inv.email.toLowerCase()) throw notFound('INVITATION_NOT_FOUND', 'This invitation is invalid or has expired');
    const already = await this.system.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: inv.organizationId, userId } },
    });
    if (already) throw new AppException('ALREADY_MEMBER', 409, 'You are already a member of this organization');
    return this.accept(inv, userId);
  }
}
