import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ClsService } from 'nestjs-cls';
import { createZodDto } from 'nestjs-zod';
import { createVehicleCategorySchema, P, updateVehicleCategorySchema } from '@gps/shared';
import { RequirePermissions } from '../../common/decorators';
import type { AppClsStore } from '../../common/request-context';
import { VehicleCategoriesService } from './vehicle-categories.service';

class CreateCategoryDto extends createZodDto(createVehicleCategorySchema) {}
class UpdateCategoryDto extends createZodDto(updateVehicleCategorySchema) {}

@ApiTags('Vehicle categories')
@Controller('vehicle-categories')
export class VehicleCategoriesController {
  constructor(
    private readonly categories: VehicleCategoriesService,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  @Get()
  @RequirePermissions(P.VEHICLES_READ)
  list() {
    return this.categories.list();
  }

  @Post()
  @RequirePermissions(P.VEHICLES_CATEGORIES_MANAGE)
  create(@Body() body: CreateCategoryDto) {
    return this.categories.create(this.cls.get('tenant')!.organizationId, body);
  }

  @Patch(':id')
  @RequirePermissions(P.VEHICLES_CATEGORIES_MANAGE)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateCategoryDto) {
    return this.categories.update(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(P.VEHICLES_CATEGORIES_MANAGE)
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.categories.remove(id);
  }
}
