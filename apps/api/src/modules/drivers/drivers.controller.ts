import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ClsService } from 'nestjs-cls';
import { createZodDto } from 'nestjs-zod';
import { createDriverSchema, driverListQuerySchema, P, updateDriverSchema } from '@gps/shared';
import { RequirePermissions } from '../../common/decorators';
import type { AppClsStore } from '../../common/request-context';
import { DriversService } from './drivers.service';

class CreateDriverDto extends createZodDto(createDriverSchema) {}
class UpdateDriverDto extends createZodDto(updateDriverSchema) {}
class ListQueryDto extends createZodDto(driverListQuerySchema) {}

@ApiTags('Drivers')
@Controller('drivers')
export class DriversController {
  constructor(
    private readonly drivers: DriversService,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  @Get()
  @RequirePermissions(P.DRIVERS_READ)
  list(@Query() q: ListQueryDto) {
    return this.drivers.list(q.page, q.pageSize, { q: q.q, status: q.status, assigned: q.assigned });
  }

  @Post()
  @RequirePermissions(P.DRIVERS_MANAGE)
  create(@Body() body: CreateDriverDto) {
    return this.drivers.create(this.cls.get('tenant')!.organizationId, body);
  }

  @Get(':id')
  @RequirePermissions(P.DRIVERS_READ)
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.drivers.get(id);
  }

  @Patch(':id')
  @RequirePermissions(P.DRIVERS_MANAGE)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateDriverDto) {
    return this.drivers.update(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(P.DRIVERS_MANAGE)
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.drivers.remove(id);
  }
}
