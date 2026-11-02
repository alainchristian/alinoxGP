import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { todayIn } from '@gps/shared';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import type { AppClsStore } from './request-context';

/** "Today" for the active organization: the calendar date in the ORGANIZATION's time zone, not the server's. */
@Injectable()
export class OrgClockService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  /** `YYYY-MM-DD`. The tenant context was already verified by the guard, so the organization row is read by its id. */
  async today(now: Date = new Date()): Promise<string> {
    const organizationId = this.cls.get('tenant')!.organizationId;
    const org = await this.prisma.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } });
    return todayIn(org?.timezone ?? 'UTC', now);
  }
}

/** `@db.Date` columns come back as a Date at UTC midnight; the API speaks `YYYY-MM-DD`. */
export const dateOnly = (d: Date | null | undefined): string | null => (d ? d.toISOString().slice(0, 10) : null);
/** `YYYY-MM-DD` (or null) to the Date Prisma expects for a `@db.Date` column. `undefined` means "leave unchanged". */
export const toDateColumn = (s: string | null | undefined): Date | null | undefined =>
  s === undefined ? undefined : s === null ? null : new Date(`${s}T00:00:00Z`);
