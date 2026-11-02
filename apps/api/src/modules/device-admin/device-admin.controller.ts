import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { DEVICE_LIFECYCLE_STATUSES, P, pageQuerySchema, setDeviceVariantSchema, setLifecycleSchema } from '@gps/shared';
import { RequirePermissions } from '../../common/decorators';
import { DeviceAdminService } from './device-admin.service';

class ListDto extends createZodDto(
  pageQuerySchema.extend({
    q: z.string().trim().max(64).optional(),
    status: z.enum(DEVICE_LIFECYCLE_STATUSES).optional(),
    stuck: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  }),
) {}
class LifecycleDto extends createZodDto(setLifecycleSchema) {}
class VariantDto extends createZodDto(setDeviceVariantSchema) {}

/** Technical administrators: find a device, see why it is not communicating. Cross-tenant; platform permission only. */
@ApiTags('Platform admin')
@Controller('admin/devices')
export class DeviceAdminController {
  constructor(private readonly admin: DeviceAdminService) {}

  @Get()
  @RequirePermissions(P.PLATFORM_DEVICES_DIAGNOSE)
  list(@Query() q: ListDto) {
    return this.admin.list(q.page, q.pageSize, { q: q.q, status: q.status, stuck: q.stuck });
  }

  @Get(':id/diagnostics')
  @RequirePermissions(P.PLATFORM_DEVICES_DIAGNOSE)
  diagnostics(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.diagnostics(id);
  }

  @Post(':id/lifecycle')
  @HttpCode(200)
  @RequirePermissions(P.PLATFORM_DEVICES_DIAGNOSE)
  setLifecycle(@Param('id', ParseUUIDPipe) id: string, @Body() body: LifecycleDto) {
    return this.admin.setLifecycle(id, body.status, body.reason);
  }

  @Put(':id/variant')
  @RequirePermissions(P.PLATFORM_DEVICES_DIAGNOSE)
  setVariant(@Param('id', ParseUUIDPipe) id: string, @Body() body: VariantDto) {
    return this.admin.setVariant(id, body.variantId, body.firmwareVersion);
  }

  @Post(':id/resync')
  @HttpCode(200)
  @RequirePermissions(P.PLATFORM_DEVICES_DIAGNOSE)
  resync(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.resync(id);
  }
}
