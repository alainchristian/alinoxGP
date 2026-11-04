import { Inject, Injectable } from '@nestjs/common';
import type { Prisma, ProviderProfile } from '@prisma/client';
import {
  NEUTRAL_BRANDING,
  PROVIDER_TERMS_VERSION,
  ROLE_KEYS,
  readableTextOn,
  type BrandingDto,
  type BrandingUpdateInput,
  type ProviderProfileDto,
  type ProviderRegistrationInput,
  type ProviderStatus,
} from '@gps/shared';
import { AppException, badRequest, conflict, notFound } from '../../common/errors';
import { PagedResult } from '../../common/response';
import { ENV, type Env } from '../../infrastructure/config/env';
import { SystemPrismaService, TenantPrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  alreadyRegisteredTemplate,
  providerApprovedTemplate,
  providerRejectedTemplate,
  providerSuspendedTemplate,
  verifyEmailTemplate,
} from '../messaging/email-templates';
import { EMAIL_PORT, type EmailPort } from '../messaging/email.port';
import { UsersService } from '../users/users.service';
import { canTransition } from './provider-lifecycle';

export const toBrandingDto = (p: Pick<ProviderProfile, 'slug' | 'displayName' | 'companyName' | 'primaryColor' | 'accentColor' | 'logoUrl' | 'supportPhone' | 'supportEmail' | 'supportWhatsapp' | 'websiteUrl' | 'termsUrl' | 'privacyUrl' | 'showPoweredBy'>): BrandingDto => {
  const primary = p.primaryColor ?? NEUTRAL_BRANDING.primaryColor;
  return {
    slug: p.slug,
    displayName: p.displayName ?? p.companyName,
    primaryColor: primary,
    onPrimaryColor: readableTextOn(primary),
    accentColor: p.accentColor ?? NEUTRAL_BRANDING.accentColor,
    logoUrl: p.logoUrl,
    supportPhone: p.supportPhone,
    supportEmail: p.supportEmail,
    supportWhatsapp: p.supportWhatsapp,
    websiteUrl: p.websiteUrl,
    termsUrl: p.termsUrl,
    privacyUrl: p.privacyUrl,
    showPoweredBy: p.showPoweredBy,
    neutral: false,
  };
};

export const toProviderProfileDto = (p: ProviderProfile): ProviderProfileDto => ({
  organizationId: p.organizationId,
  status: p.status,
  companyName: p.companyName,
  registrationNumber: p.registrationNumber,
  tin: p.tin,
  contactName: p.contactName,
  contactEmail: p.contactEmail,
  contactPhone: p.contactPhone,
  expectedDevices: p.expectedDevices,
  licenceNumber: p.licenceNumber,
  termsVersion: p.termsVersion,
  termsAcceptedAt: p.termsAcceptedAt?.toISOString() ?? null,
  approvedAt: p.approvedAt?.toISOString() ?? null,
  rejectionReason: p.rejectionReason,
  suspendedAt: p.suspendedAt?.toISOString() ?? null,
  suspensionReason: p.suspensionReason,
  createdAt: p.createdAt.toISOString(),
  branding: toBrandingDto(p),
});

/**
 * Provider registration, platform approval and the provider's own profile/branding (spec Modules 15–17, skill gps-provider-model).
 * Registration, approval and the cross-provider admin list run on the system client: they happen before any tenant exists
 * or across tenants (reviewed use #5 on SystemPrismaService). The provider's own profile uses RLS.
 */
@Injectable()
export class ProvidersService {
  constructor(
    private readonly system: SystemPrismaService,
    private readonly tenant: TenantPrismaService,
    private readonly users: UsersService,
    private readonly audit: AuditService,
    @Inject(EMAIL_PORT) private readonly email: EmailPort,
    @Inject(ENV) private readonly env: Env,
  ) {}

  // ------------------------------------------------------------------ public registration

  /** Always answers the same way, whether or not the email is already registered (no enumeration). */
  async register(input: ProviderRegistrationInput): Promise<void> {
    const passwordHash = await this.users.hashPassword(input.password); // hashed first: equal timing either way
    const existing = await this.users.findByEmail(input.email);
    if (existing) {
      await this.email.send({ to: existing.email, ...alreadyRegisteredTemplate(this.env.APP_BASE_URL) });
      await this.audit.record({ action: 'provider.register_duplicate', actorUserId: existing.id });
      return;
    }
    const country = await this.system.country.findUnique({ where: { code: input.countryCode } });
    if (!country || !country.enabled) throw badRequest('COUNTRY_NOT_SUPPORTED', 'This country is not available yet');
    const ownerRole = await this.system.role.findUnique({ where: { key: ROLE_KEYS.PROVIDER_OWNER } });
    if (!ownerRole) throw new Error('System roles are not seeded (run db:seed)');

    const user = await this.users.create({ email: input.email, passwordHash, fullName: input.contactName });
    const now = new Date();
    const org = await this.system.$transaction(async (tx) => {
      const created = await tx.organization.create({
        data: {
          type: 'PROVIDER',
          name: input.companyName,
          legalName: input.companyName,
          countryCode: country.code,
          timezone: input.timezone ?? country.defaultTimezone,
          currencyCode: country.defaultCurrency,
        },
      });
      await tx.providerProfile.create({
        data: {
          organizationId: created.id,
          status: 'PENDING_VERIFICATION',
          companyName: input.companyName,
          registrationNumber: input.registrationNumber,
          tin: input.tin,
          contactName: input.contactName,
          contactEmail: input.email,
          contactPhone: input.phone,
          expectedDevices: input.expectedDevices,
          termsVersion: PROVIDER_TERMS_VERSION,
          termsAcceptedAt: now,
        },
      });
      const member = await tx.organizationMember.create({ data: { organizationId: created.id, userId: user.id } });
      await tx.memberRole.create({ data: { organizationId: created.id, memberId: member.id, roleId: ownerRole.id } });
      return created;
    });
    const token = await this.users.issueEmailToken(user.id, 'VERIFY_EMAIL');
    await this.email.send({ to: user.email, ...verifyEmailTemplate(this.env.APP_BASE_URL, token, user.fullName) });
    await this.audit.record({
      action: 'provider.register',
      organizationId: org.id,
      actorUserId: user.id,
      targetType: 'provider',
      targetId: org.id,
      after: { termsVersion: PROVIDER_TERMS_VERSION },
    });
  }

  /** Called when a user verifies their email: a provider waiting for verification moves to the approval queue. */
  async onEmailVerified(userId: string): Promise<void> {
    const waiting = await this.system.providerProfile.findMany({
      where: { status: 'PENDING_VERIFICATION', organization: { members: { some: { userId, roles: { some: { role: { key: ROLE_KEYS.PROVIDER_OWNER } } } } } } },
      select: { organizationId: true },
    });
    for (const w of waiting) {
      const done = await this.system.providerProfile.updateMany({
        where: { organizationId: w.organizationId, status: 'PENDING_VERIFICATION' },
        data: { status: 'PENDING_APPROVAL' },
      });
      if (done.count === 1) {
        await this.audit.record({ action: 'provider.pending_approval', organizationId: w.organizationId, actorUserId: userId, targetType: 'provider', targetId: w.organizationId });
      }
    }
  }

  // ------------------------------------------------------------------ platform administration

  async adminList(page: number, pageSize: number, status?: ProviderStatus, search?: string) {
    const where: Prisma.ProviderProfileWhereInput = {
      ...(status ? { status } : {}),
      ...(search ? { OR: [{ companyName: { contains: search, mode: 'insensitive' } }, { contactEmail: { contains: search, mode: 'insensitive' } }] } : {}),
    };
    const [total, rows] = await Promise.all([
      this.system.providerProfile.count({ where }),
      this.system.providerProfile.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
    ]);
    return new PagedResult(rows.map(toProviderProfileDto), { page, pageSize, total });
  }

  async adminGet(id: string): Promise<ProviderProfileDto & { customerCount: number }> {
    const p = await this.system.providerProfile.findUnique({ where: { organizationId: id } });
    if (!p) throw notFound('PROVIDER_NOT_FOUND');
    const customerCount = await this.system.organization.count({ where: { providerId: id, type: 'CUSTOMER' } });
    return { ...toProviderProfileDto(p), customerCount };
  }

  private async change(
    id: string,
    to: ProviderStatus,
    actorUserId: string,
    data: Prisma.ProviderProfileUpdateInput,
    organizationStatus: 'ACTIVE' | 'SUSPENDED' | undefined,
    action: string,
    details: Prisma.InputJsonValue,
  ): Promise<ProviderProfile> {
    const current = await this.system.providerProfile.findUnique({ where: { organizationId: id } });
    if (!current) throw notFound('PROVIDER_NOT_FOUND');
    if (!canTransition(current.status, to)) {
      throw new AppException('INVALID_PROVIDER_TRANSITION', 409, `A provider that is ${current.status} cannot become ${to}`);
    }
    const updated = await this.system.$transaction(async (tx) => {
      // Compare-and-set: two administrators acting at once cannot both win.
      const claimed = await tx.providerProfile.updateMany({ where: { organizationId: id, status: current.status }, data: { status: to } });
      if (claimed.count !== 1) throw conflict('PROVIDER_CHANGED', 'The provider was changed by someone else; reload and retry');
      if (organizationStatus) await tx.organization.update({ where: { id }, data: { status: organizationStatus } });
      return tx.providerProfile.update({ where: { organizationId: id }, data });
    });
    await this.audit.record({
      action,
      organizationId: id,
      actorUserId,
      targetType: 'provider',
      targetId: id,
      before: { status: current.status },
      after: { status: to, ...(details as object) },
    });
    return updated;
  }

  async approve(id: string, actorUserId: string, input: { licenceNumber?: string; trial: boolean }) {
    const p = await this.change(
      id,
      input.trial ? 'TRIAL' : 'ACTIVE',
      actorUserId,
      { approvedByUserId: actorUserId, approvedAt: new Date(), rejectionReason: null, licenceNumber: input.licenceNumber },
      'ACTIVE',
      'provider.approve',
      { licenceRecorded: Boolean(input.licenceNumber) },
    );
    await this.email.send({ to: p.contactEmail, ...providerApprovedTemplate(this.env.APP_BASE_URL, p.companyName) });
    return toProviderProfileDto(p);
  }

  async reject(id: string, actorUserId: string, reason: string) {
    const p = await this.change(id, 'REJECTED', actorUserId, { rejectedAt: new Date(), rejectionReason: reason }, undefined, 'provider.reject', { reason });
    await this.email.send({ to: p.contactEmail, ...providerRejectedTemplate(p.companyName, reason) });
    return toProviderProfileDto(p);
  }

  /** Console becomes read-only except billing, customers see a neutral message, ingestion continues, nothing is deleted. */
  async suspend(id: string, actorUserId: string, reason: string) {
    const p = await this.change(id, 'SUSPENDED', actorUserId, { suspendedAt: new Date(), suspensionReason: reason }, 'SUSPENDED', 'provider.suspend', { reason });
    await this.email.send({ to: p.contactEmail, ...providerSuspendedTemplate(p.companyName, reason) });
    return toProviderProfileDto(p);
  }

  async reactivate(id: string, actorUserId: string) {
    const p = await this.change(id, 'ACTIVE', actorUserId, { suspendedAt: null, suspensionReason: null }, 'ACTIVE', 'provider.reactivate', {});
    return toProviderProfileDto(p);
  }

  // ------------------------------------------------------------------ the provider's own profile and branding

  async myProfile(): Promise<ProviderProfileDto> {
    const p = await this.tenant.run((tx) => tx.providerProfile.findFirst());
    if (!p) throw notFound('PROVIDER_NOT_FOUND');
    return toProviderProfileDto(p);
  }

  async updateBranding(input: BrandingUpdateInput, actorUserId: string): Promise<ProviderProfileDto> {
    const before = await this.tenant.run((tx) => tx.providerProfile.findFirst());
    if (!before) throw notFound('PROVIDER_NOT_FOUND');
    if (input.slug && input.slug !== before.slug) {
      const taken = await this.system.providerProfile.findUnique({ where: { slug: input.slug }, select: { organizationId: true } });
      if (taken && taken.organizationId !== before.organizationId) throw conflict('BRANDING_SLUG_TAKEN', 'This address is already used');
    }
    let updated: ProviderProfile;
    try {
      updated = await this.tenant.run((tx) => tx.providerProfile.update({ where: { organizationId: before.organizationId }, data: input }));
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') throw conflict('BRANDING_SLUG_TAKEN', 'This address is already used');
      throw err;
    }
    await this.audit.record({
      action: 'provider.branding_update',
      actorUserId,
      targetType: 'provider',
      targetId: before.organizationId,
      after: { fields: Object.keys(input) },
    });
    return toProviderProfileDto(updated);
  }
}
