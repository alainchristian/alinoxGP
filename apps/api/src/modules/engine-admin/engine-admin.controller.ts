import { Controller, Get, HttpCode, Inject, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ClsService } from 'nestjs-cls';
import { P, type EngineHealthDto, type ReconciliationReport } from '@gps/shared';
import { RequirePermissions } from '../../common/decorators';
import type { AppClsStore } from '../../common/request-context';
import { SystemPrismaService } from '../../infrastructure/prisma/prisma.service';
import { GPS_ENGINE, type GpsEnginePort } from '../../integrations/gps-engine/port';
import { IngestStatsService } from '../tracking/ingest-stats.service';
import { PipelineMetricsService } from '../tracking/pipeline-metrics.service';
import { IngestionService } from '../tracking/ingestion.service';
import { ReconciliationService } from './reconciliation.service';

/**
 * Platform-staff diagnostics for the GPS engine integration. Cross-tenant by nature, so it reads aggregate counts
 * with the system role; it exposes no customer data (no coordinates, names or identifiers).
 */
@ApiTags('Platform admin')
@Controller('admin/engine')
export class EngineAdminController {
  constructor(
    @Inject(GPS_ENGINE) private readonly engine: GpsEnginePort,
    private readonly ingestion: IngestionService,
    private readonly stats: IngestStatsService,
    private readonly reconciliation: ReconciliationService,
    private readonly metrics: PipelineMetricsService,
    private readonly system: SystemPrismaService,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  @Get('health')
  @RequirePermissions(P.PLATFORM_DEVICES_DIAGNOSE)
  async health(): Promise<EngineHealthDto> {
    const [engine, stats, grouped, simulated, last] = await Promise.all([
      this.engine.health(),
      this.stats.all(),
      this.system.gpsDevice.groupBy({ by: ['engineSyncStatus'], _count: true }),
      this.system.gpsDevice.count({ where: { isSimulated: true } }),
      this.reconciliation.last(),
    ]);
    const count = (s: string) => grouped.find((g) => g.engineSyncStatus === s)?._count ?? 0;
    const s = this.ingestion.state;
    return {
      engine,
      ingestion: {
        enabled: s.enabled,
        leader: s.leader,
        streamConnected: s.streamConnected,
        lastMessageAt: s.lastMessageAt?.toISOString() ?? null,
        lastConnectedAt: s.lastConnectedAt?.toISOString() ?? null,
      },
      stats,
      pipeline: this.metrics.snapshot(),
      devices: { total: grouped.reduce((n, g) => n + g._count, 0), synced: count('SYNCED'), pending: count('PENDING'), failed: count('FAILED'), simulated },
      lastReconciliation: last,
    };
  }

  @Post('reconcile')
  @HttpCode(200)
  @RequirePermissions(P.PLATFORM_DEVICES_DIAGNOSE)
  reconcile(): Promise<ReconciliationReport> {
    return this.reconciliation.run(this.cls.get('auth')!.userId);
  }
}
