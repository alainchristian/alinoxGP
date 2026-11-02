import { Module } from '@nestjs/common';
import { DevicesModule } from '../devices/devices.module';
import { TrackingModule } from '../tracking/tracking.module';
import { EngineAdminController } from './engine-admin.controller';
import { MaintenanceQueueService } from './maintenance-queue.service';
import { ReconciliationService } from './reconciliation.service';

@Module({
  imports: [DevicesModule, TrackingModule],
  controllers: [EngineAdminController],
  providers: [ReconciliationService, MaintenanceQueueService],
  exports: [ReconciliationService],
})
export class EngineAdminModule {}
