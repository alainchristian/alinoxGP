import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ClsService } from 'nestjs-cls';
import { createZodDto } from 'nestjs-zod';
import { assignDeviceSchema, P, pageQuerySchema, registerDeviceSchema, setDeviceVariantSchema, unassignDeviceSchema, updateDeviceSchema } from '@gps/shared';
import { RequirePermissions } from '../../common/decorators';
import type { AppClsStore } from '../../common/request-context';
import { DeviceCapabilitiesService } from './device-capabilities.service';
import { DevicesService } from './devices.service';

class RegisterDeviceDto extends createZodDto(registerDeviceSchema) {}
class UpdateDeviceDto extends createZodDto(updateDeviceSchema) {}
class AssignDeviceDto extends createZodDto(assignDeviceSchema) {}
class UnassignDeviceDto extends createZodDto(unassignDeviceSchema) {}
class SetVariantDto extends createZodDto(setDeviceVariantSchema) {}
class PageDto extends createZodDto(pageQuerySchema) {}

@ApiTags('GPS devices')
@Controller('devices')
export class DevicesController {
  constructor(
    private readonly devices: DevicesService,
    private readonly capabilities: DeviceCapabilitiesService,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  @Get()
  @RequirePermissions(P.DEVICES_READ)
  list(@Query() q: PageDto) {
    return this.devices.list(q.page, q.pageSize);
  }

  @Post()
  @RequirePermissions(P.DEVICES_REGISTER)
  register(@Body() body: RegisterDeviceDto) {
    return this.devices.register(body);
  }

  @Get(':id')
  @RequirePermissions(P.DEVICES_READ)
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.devices.get(id);
  }

  @Patch(':id')
  @RequirePermissions(P.DEVICES_REGISTER)
  rename(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateDeviceDto) {
    return this.devices.rename(id, body.name);
  }

  @Post(':id/sync')
  @HttpCode(200)
  @RequirePermissions(P.DEVICES_REGISTER)
  resync(@Param('id', ParseUUIDPipe) id: string) {
    return this.devices.resync(id);
  }

  /** Identify (or change) the catalogue model of a registered device. */
  @Put(':id/variant')
  @RequirePermissions(P.DEVICES_REGISTER)
  setVariant(@Param('id', ParseUUIDPipe) id: string, @Body() body: SetVariantDto) {
    return this.devices.setVariant(id, body.variantId, body.firmwareVersion);
  }

  /** What the device must be set to (server, port, protocol, notes); anything unknown is listed, not guessed. */
  @Get(':id/configuration')
  @RequirePermissions(P.DEVICES_READ)
  configuration(@Param('id', ParseUUIDPipe) id: string) {
    return this.devices.configuration(id);
  }

  /** The customer confirms the device is configured; the platform then waits for its first position. */
  @Post(':id/configured')
  @HttpCode(200)
  @RequirePermissions(P.DEVICES_REGISTER)
  configured(@Param('id', ParseUUIDPipe) id: string) {
    return this.devices.confirmConfigured(id);
  }

  /** Effective capabilities with the reason for each (catalogue × installation × observed). */
  @Get(':id/capabilities')
  @RequirePermissions(P.DEVICES_CAPABILITIES_READ)
  capabilitiesOf(@Param('id', ParseUUIDPipe) id: string) {
    return this.capabilities.forDevice(this.cls.get('tenant')!.organizationId, id);
  }

  @Get(':id/history')
  @RequirePermissions(P.DEVICES_READ)
  history(@Param('id', ParseUUIDPipe) id: string) {
    return this.devices.statusHistory(id);
  }

  @Post(':id/assign')
  @HttpCode(200)
  @RequirePermissions(P.DEVICES_ASSIGN)
  assign(@Param('id', ParseUUIDPipe) id: string, @Body() body: AssignDeviceDto) {
    return this.devices.assign(id, body.vehicleId, body.reason);
  }

  @Post(':id/unassign')
  @HttpCode(200)
  @RequirePermissions(P.DEVICES_ASSIGN)
  unassign(@Param('id', ParseUUIDPipe) id: string, @Body() body: UnassignDeviceDto) {
    return this.devices.unassign(id, body.reason);
  }
}
