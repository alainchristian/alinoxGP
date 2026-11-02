import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ClsService } from 'nestjs-cls';
import { createZodDto } from 'nestjs-zod';
import {
  addVerificationSchema,
  CAPABILITY_KEYS,
  createManufacturerSchema,
  createModelSchema,
  createVariantSchema,
  P,
  setCapabilitySchema,
  updateModelSchema,
  updateVariantSchema,
  type CapabilityKey,
} from '@gps/shared';
import { RequirePermissions } from '../../common/decorators';
import { badRequest } from '../../common/errors';
import type { AppClsStore } from '../../common/request-context';
import { CatalogueService } from './catalogue.service';

class CreateManufacturerDto extends createZodDto(createManufacturerSchema) {}
class CreateModelDto extends createZodDto(createModelSchema) {}
class UpdateModelDto extends createZodDto(updateModelSchema) {}
class CreateVariantDto extends createZodDto(createVariantSchema) {}
class UpdateVariantDto extends createZodDto(updateVariantSchema) {}
class SetCapabilityDto extends createZodDto(setCapabilitySchema) {}
class AddVerificationDto extends createZodDto(addVerificationSchema) {}

const capabilityKey = (raw: string): CapabilityKey => {
  if (!(CAPABILITY_KEYS as readonly string[]).includes(raw)) throw badRequest('UNKNOWN_CAPABILITY', 'Unknown capability');
  return raw as CapabilityKey;
};

/** What customers choose from while onboarding a device. Listed models only; staff evidence (who tested) is not included. */
@ApiTags('Device catalogue')
@Controller('catalogue')
export class CatalogueController {
  constructor(private readonly catalogue: CatalogueService) {}

  @Get('models')
  @RequirePermissions(P.DEVICES_READ)
  models() {
    return this.catalogue.listForCustomers();
  }
}

/** Platform administrators manage the catalogue (spec Module 6). Global data, so no tenant data is touched. */
@ApiTags('Platform admin')
@Controller('admin/catalogue')
export class CatalogueAdminController {
  constructor(
    private readonly catalogue: CatalogueService,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  @Get('models')
  @RequirePermissions(P.PLATFORM_CATALOGUE_MANAGE)
  models() {
    return this.catalogue.listAll();
  }

  @Get('manufacturers')
  @RequirePermissions(P.PLATFORM_CATALOGUE_MANAGE)
  manufacturers() {
    return this.catalogue.listManufacturers();
  }

  @Post('manufacturers')
  @RequirePermissions(P.PLATFORM_CATALOGUE_MANAGE)
  createManufacturer(@Body() body: CreateManufacturerDto) {
    return this.catalogue.createManufacturer(body);
  }

  @Post('models')
  @RequirePermissions(P.PLATFORM_CATALOGUE_MANAGE)
  createModel(@Body() body: CreateModelDto) {
    return this.catalogue.createModel({ ...body, networkTechnologies: body.networkTechnologies ?? [] });
  }

  @Patch('models/:id')
  @RequirePermissions(P.PLATFORM_CATALOGUE_MANAGE)
  updateModel(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateModelDto) {
    return this.catalogue.updateModel(id, body);
  }

  @Post('variants')
  @RequirePermissions(P.PLATFORM_CATALOGUE_MANAGE)
  createVariant(@Body() body: CreateVariantDto) {
    return this.catalogue.createVariant(body);
  }

  @Patch('variants/:id')
  @RequirePermissions(P.PLATFORM_CATALOGUE_MANAGE)
  updateVariant(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateVariantDto) {
    return this.catalogue.updateVariant(id, body);
  }

  @Put('variants/:id/capabilities/:key')
  @RequirePermissions(P.PLATFORM_CATALOGUE_MANAGE)
  setCapability(@Param('id', ParseUUIDPipe) id: string, @Param('key') key: string, @Body() body: SetCapabilityDto) {
    return this.catalogue.setCapability(id, capabilityKey(key), body);
  }

  @Delete('variants/:id/capabilities/:key')
  @RequirePermissions(P.PLATFORM_CATALOGUE_MANAGE)
  clearCapability(@Param('id', ParseUUIDPipe) id: string, @Param('key') key: string) {
    return this.catalogue.clearCapability(id, capabilityKey(key));
  }

  @Post('variants/:id/verifications')
  @RequirePermissions(P.PLATFORM_CATALOGUE_MANAGE)
  addVerification(@Param('id', ParseUUIDPipe) id: string, @Body() body: AddVerificationDto) {
    return this.catalogue.addVerification(id, this.cls.get('tenant')?.userId, body);
  }
}
