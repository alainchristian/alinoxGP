import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ClsService } from 'nestjs-cls';
import { createZodDto } from 'nestjs-zod';
import {
  assignDriverSchema,
  createVehicleDocumentSchema,
  createVehicleSchema,
  P,
  unassignDriverSchema,
  updateVehicleDocumentSchema,
  updateVehicleSchema,
  vehicleListQuerySchema,
} from '@gps/shared';
import { RequirePermissions } from '../../common/decorators';
import type { AppClsStore } from '../../common/request-context';
import { VehicleDocumentsService } from './vehicle-documents.service';
import { VehiclesService } from './vehicles.service';

class CreateVehicleDto extends createZodDto(createVehicleSchema) {}
class UpdateVehicleDto extends createZodDto(updateVehicleSchema) {}
class ListQueryDto extends createZodDto(vehicleListQuerySchema) {}
class AssignDriverDto extends createZodDto(assignDriverSchema) {}
class UnassignDriverDto extends createZodDto(unassignDriverSchema) {}
class CreateDocumentDto extends createZodDto(createVehicleDocumentSchema) {}
class UpdateDocumentDto extends createZodDto(updateVehicleDocumentSchema) {}

/** Organization comes from the verified tenant context (header `X-Organization-Id` + membership), never the body. */
@ApiTags('Vehicles')
@Controller('vehicles')
export class VehiclesController {
  constructor(
    private readonly vehicles: VehiclesService,
    private readonly documents: VehicleDocumentsService,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  private get tenant() {
    return this.cls.get('tenant')!;
  }

  @Get()
  @RequirePermissions(P.VEHICLES_READ)
  list(@Query() q: ListQueryDto) {
    return this.vehicles.list(q.page, q.pageSize, { q: q.q, categoryId: q.categoryId, hasDevice: q.hasDevice, hasDriver: q.hasDriver, sort: q.sort });
  }

  @Post()
  @RequirePermissions(P.VEHICLES_CREATE)
  create(@Body() body: CreateVehicleDto) {
    return this.vehicles.create(this.tenant.organizationId, body);
  }

  @Get(':id')
  @RequirePermissions(P.VEHICLES_READ)
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.vehicles.get(id);
  }

  @Patch(':id')
  @RequirePermissions(P.VEHICLES_UPDATE)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateVehicleDto) {
    return this.vehicles.update(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(P.VEHICLES_DELETE)
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.vehicles.remove(id);
  }

  // ---- assigned driver (one at a time; history kept)

  @Post(':id/driver')
  @RequirePermissions(P.DRIVERS_MANAGE)
  assignDriver(@Param('id', ParseUUIDPipe) id: string, @Body() body: AssignDriverDto) {
    return this.vehicles.assignDriver(this.tenant.organizationId, this.tenant.userId, id, body.driverId, body.reason);
  }

  @Delete(':id/driver')
  @RequirePermissions(P.DRIVERS_MANAGE)
  unassignDriver(@Param('id', ParseUUIDPipe) id: string, @Body() body: UnassignDriverDto) {
    return this.vehicles.unassignDriver(this.tenant.userId, id, body?.reason);
  }

  @Get(':id/driver-history')
  @RequirePermissions(P.VEHICLES_READ, P.DRIVERS_READ)
  driverHistory(@Param('id', ParseUUIDPipe) id: string) {
    return this.vehicles.driverHistory(id);
  }

  // ---- document records

  @Get(':id/documents')
  @RequirePermissions(P.VEHICLES_READ)
  listDocuments(@Param('id', ParseUUIDPipe) id: string) {
    return this.documents.list(id);
  }

  @Post(':id/documents')
  @RequirePermissions(P.VEHICLES_DOCUMENTS_MANAGE)
  createDocument(@Param('id', ParseUUIDPipe) id: string, @Body() body: CreateDocumentDto) {
    return this.documents.create(this.tenant.organizationId, id, body);
  }

  @Patch(':id/documents/:documentId')
  @RequirePermissions(P.VEHICLES_DOCUMENTS_MANAGE)
  updateDocument(@Param('id', ParseUUIDPipe) id: string, @Param('documentId', ParseUUIDPipe) documentId: string, @Body() body: UpdateDocumentDto) {
    return this.documents.update(id, documentId, body);
  }

  @Delete(':id/documents/:documentId')
  @HttpCode(204)
  @RequirePermissions(P.VEHICLES_DOCUMENTS_MANAGE)
  async removeDocument(@Param('id', ParseUUIDPipe) id: string, @Param('documentId', ParseUUIDPipe) documentId: string) {
    await this.documents.remove(id, documentId);
  }
}
