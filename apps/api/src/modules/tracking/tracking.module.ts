import { Module } from '@nestjs/common';
import { AlertsModule } from '../alerts/alerts.module';
import { DevicesModule } from '../devices/devices.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { IngestionService } from './ingestion.service';
import { OfflineSweeperService } from './offline-sweeper.service';
import { PipelineMetricsService } from './pipeline-metrics.service';
import { PositionPipelineService } from './position-pipeline.service';
import { TrackingController } from './tracking.controller';

@Module({
  imports: [DevicesModule, RealtimeModule, AlertsModule],
  controllers: [TrackingController],
  providers: [PositionPipelineService, IngestionService, OfflineSweeperService, PipelineMetricsService],
  exports: [IngestionService, PositionPipelineService, OfflineSweeperService, PipelineMetricsService],
})
export class TrackingModule {}
