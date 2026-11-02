import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { ConsentNoticeDto } from '@gps/shared';
import { AppException, notFound } from '../../common/errors';
import { ENV, type Env } from '../../infrastructure/config/env';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

const toDto = (n: Prisma.ConsentNoticeGetPayload<object>): ConsentNoticeDto => ({
  id: n.id,
  kind: n.kind,
  version: n.version,
  title: n.title,
  body: n.body,
  isDraftWording: n.isDraftWording,
});

/**
 * Consent MECHANISM (ADR-0009): versioned notices and append-only acknowledgement records. The platform does not decide
 * what the legal text must say (OQ-020 / OQ-037): wording is data, marked as draft until a lawyer has reviewed it.
 */
@Injectable()
export class ConsentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** The notice customers must acknowledge now: the newest PUBLISHED tracking notice, or null if none is published. */
  async current(): Promise<ConsentNoticeDto | null> {
    const n = await this.prisma.consentNotice.findFirst({ where: { kind: 'TRACKING_NOTICE', status: 'PUBLISHED' }, orderBy: { version: 'desc' } });
    return n ? toDto(n) : null;
  }

  /**
   * Called when a device is registered. If a notice is published and acknowledgement is required, the user must have
   * acknowledged THAT version (not an older one). Returns the notice to record, or null when none applies.
   */
  async requireAcknowledgement(acknowledgedNoticeId: string | undefined): Promise<ConsentNoticeDto | null> {
    if (!this.env.DEVICE_CONSENT_REQUIRED) return null;
    const notice = await this.current();
    if (!notice) return null;
    if (acknowledgedNoticeId !== notice.id) {
      throw new AppException('CONSENT_REQUIRED', 422, 'Read and acknowledge the tracking notice before registering a device');
    }
    return notice;
  }

  // ---------------------------------------------------------------- platform staff

  async listNotices(): Promise<(ConsentNoticeDto & { status: string; publishedAt: string | null })[]> {
    const rows = await this.prisma.consentNotice.findMany({ orderBy: [{ kind: 'asc' }, { version: 'desc' }] });
    return rows.map((n) => ({ ...toDto(n), status: n.status, publishedAt: n.publishedAt?.toISOString() ?? null }));
  }

  /** Creates the next version as a DRAFT. A draft can be edited by creating another; only publishing makes it binding. */
  async createDraft(input: { title: string; body: string; isDraftWording: boolean }): Promise<ConsentNoticeDto> {
    const last = await this.prisma.consentNotice.findFirst({ where: { kind: 'TRACKING_NOTICE' }, orderBy: { version: 'desc' }, select: { version: true } });
    const row = await this.prisma.consentNotice.create({ data: { kind: 'TRACKING_NOTICE', version: (last?.version ?? 0) + 1, ...input } });
    await this.audit.record({ action: 'consent.notice_draft', targetType: 'consent_notice', targetId: row.id, after: { version: row.version } });
    return toDto(row);
  }

  /** Publishes a draft and retires the previously published version, atomically. A published notice is immutable (trigger). */
  async publish(id: string): Promise<ConsentNoticeDto> {
    const row = await this.prisma.$transaction(async (tx) => {
      const n = await tx.consentNotice.findUnique({ where: { id } });
      if (!n) throw notFound('CONSENT_NOTICE_NOT_FOUND');
      if (n.status !== 'DRAFT') throw new AppException('CONSENT_NOTICE_NOT_DRAFT', 409, 'Only a draft can be published');
      await tx.consentNotice.updateMany({ where: { kind: n.kind, status: 'PUBLISHED' }, data: { status: 'RETIRED' } });
      return tx.consentNotice.update({ where: { id }, data: { status: 'PUBLISHED', publishedAt: new Date() } });
    });
    await this.audit.record({ action: 'consent.notice_publish', targetType: 'consent_notice', targetId: id, after: { version: row.version } });
    return toDto(row);
  }
}
