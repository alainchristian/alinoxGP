import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ClsService } from 'nestjs-cls';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { P, pageQuerySchema, requestSupportSchema, resolveSupportRequestSchema, SUPPORT_REQUEST_STATUSES } from '@gps/shared';
import { RequirePermissions } from '../../common/decorators';
import type { AppClsStore } from '../../common/request-context';
import { DeviceSupportService } from './device-support.service';

class RequestSupportDto extends createZodDto(requestSupportSchema) {}
class ResolveDto extends createZodDto(resolveSupportRequestSchema) {}
class AdminListDto extends createZodDto(pageQuerySchema.extend({ status: z.enum(SUPPORT_REQUEST_STATUSES).optional() })) {}

@ApiTags('GPS devices')
@Controller('device-support-requests')
export class DeviceSupportController {
  constructor(
    private readonly support: DeviceSupportService,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  @Get()
  @RequirePermissions(P.DEVICES_READ)
  mine() {
    return this.support.listMine();
  }

  @Post()
  @RequirePermissions(P.DEVICES_REGISTER)
  create(@Body() body: RequestSupportDto) {
    const t = this.cls.get('tenant')!;
    return this.support.create(t.organizationId, t.userId, body);
  }
}

@ApiTags('Platform admin')
@Controller('admin/device-support-requests')
export class DeviceSupportAdminController {
  constructor(private readonly support: DeviceSupportService) {}

  @Get()
  @RequirePermissions(P.PLATFORM_CATALOGUE_MANAGE)
  list(@Query() q: AdminListDto) {
    return this.support.listAll(q.page, q.pageSize, q.status);
  }

  @Post(':id/resolve')
  @RequirePermissions(P.PLATFORM_CATALOGUE_MANAGE)
  resolve(@Param('id', ParseUUIDPipe) id: string, @Body() body: ResolveDto) {
    return this.support.resolve(id, body.status, body.resolutionNote);
  }
}
