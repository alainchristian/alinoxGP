import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { P, publishConsentNoticeSchema } from '@gps/shared';
import { RequirePermissions } from '../../common/decorators';
import { TenantPrismaService } from '../../infrastructure/prisma/prisma.service';
import { ConsentService } from './consent.service';

class DraftNoticeDto extends createZodDto(publishConsentNoticeSchema) {}

@ApiTags('Consent')
@Controller('consent')
export class ConsentController {
  constructor(
    private readonly consent: ConsentService,
    private readonly tenant: TenantPrismaService,
  ) {}

  /** The notice to show before registering a device (null when none is published). */
  @Get('current')
  @RequirePermissions(P.DEVICES_REGISTER)
  current() {
    return this.consent.current();
  }

  /** The organization's acknowledgement records: who acknowledged which version, when, for which device. */
  @Get('records')
  @RequirePermissions(P.ORGANIZATION_READ)
  async records() {
    const rows = await this.tenant.run((tx) => tx.consentRecord.findMany({ orderBy: { acceptedAt: 'desc' }, take: 200, include: { notice: { select: { version: true, title: true } } } }));
    return rows.map((r) => ({ id: r.id, userId: r.userId, deviceId: r.deviceId, noticeVersion: r.notice.version, noticeTitle: r.notice.title, acceptedAt: r.acceptedAt.toISOString() }));
  }
}

@ApiTags('Platform admin')
@Controller('admin/consent')
export class ConsentAdminController {
  constructor(private readonly consent: ConsentService) {}

  @Get('notices')
  @RequirePermissions(P.PLATFORM_SETTINGS_MANAGE)
  notices() {
    return this.consent.listNotices();
  }

  @Post('notices')
  @RequirePermissions(P.PLATFORM_SETTINGS_MANAGE)
  draft(@Body() body: DraftNoticeDto) {
    return this.consent.createDraft(body);
  }

  @Post('notices/:id/publish')
  @RequirePermissions(P.PLATFORM_SETTINGS_MANAGE)
  publish(@Param('id', ParseUUIDPipe) id: string) {
    return this.consent.publish(id);
  }
}
