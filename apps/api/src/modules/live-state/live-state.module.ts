import { Global, Module } from '@nestjs/common';
import { IngestStatsService } from '../tracking/ingest-stats.service';
import { LiveStateStore } from './live-state.store';
import { StatusConfigService } from './status-config.service';

/** Shared, dependency-free building blocks of the live pipeline (state store, thresholds, ingest counters). */
@Global()
@Module({
  providers: [LiveStateStore, StatusConfigService, IngestStatsService],
  exports: [LiveStateStore, StatusConfigService, IngestStatsService],
})
export class LiveStateModule {}
