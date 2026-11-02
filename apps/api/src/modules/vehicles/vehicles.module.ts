import { Module } from '@nestjs/common';
import { OrgClockService } from '../../common/org-clock.service';
import { VehicleDocumentsService } from './vehicle-documents.service';
import { VehiclesController } from './vehicles.controller';
import { VehiclesService } from './vehicles.service';

@Module({
  controllers: [VehiclesController],
  providers: [VehiclesService, VehicleDocumentsService, OrgClockService],
  exports: [VehiclesService, OrgClockService],
})
export class VehiclesModule {}
