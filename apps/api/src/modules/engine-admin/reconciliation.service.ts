import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import type { ReconciliationReport } from '@gps/shared';
import { SystemPrismaService } from '../../infrastructure/prisma/prisma.service';
import { REDIS } from '../../infrastructure/redis/redis.module';
import { GPS_ENGINE, GpsEngineError, type GpsEnginePort } from '../../integrations/gps-engine/port';
import { AuditService } from '../audit/audit.service';
import { DeviceEngineSyncService } from '../devices/device-engine-sync.service';

const REPORT_KEY = 'gps:reconciliation:last';

/**
 * Compares OUR devices with the engine's and repairs what is safe to repair. It NEVER deletes anything
 * automatically: devices unknown to the platform are only reported to technical administrators.
 * Cross-tenant by nature (platform job), so it reads with the system role; every write goes through the device's
 * own organization context (RLS).
 */
@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(
    @Inject(GPS_ENGINE) private readonly engine: GpsEnginePort,
    private readonly system: SystemPrismaService,
    private readonly sync: DeviceEngineSyncService,
    private readonly audit: AuditService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async run(actorUserId?: string): Promise<ReconciliationReport> {
    const report: ReconciliationReport = { ranAt: new Date().toISOString(), checked: 0, missingInEngine: [], unknownToPlatform: [], repaired: [], failed: [] };
    let engineDevices;
    try {
      engineDevices = await this.engine.listDevices();
    } catch (err) {
      const code = err instanceof GpsEngineError ? err.code : 'ENGINE_PROTOCOL_ERROR';
      report.failed.push({ uniqueId: '*', code });
      await this.remember(report);
      return report;
    }
    const byUniqueId = new Map(engineDevices.map((d) => [d.uniqueId, d]));
    const ours = await this.system.gpsDevice.findMany({ where: { lifecycleStatus: { not: 'RETIRED' } } });
    const ourIds = new Set(ours.map((d) => d.uniqueId));
    report.checked = ours.length;

    for (const device of ours) {
      const inEngine = byUniqueId.get(device.uniqueId);
      if (device.engineSyncStatus === 'SYNCED' && !inEngine) report.missingInEngine.push(device.uniqueId);
      const needsSync = device.engineSyncStatus !== 'SYNCED' || !inEngine || device.traccarDeviceId !== inEngine.engineId;
      if (!needsSync) continue;
      const status = await this.sync.sync({ id: device.id, uniqueId: device.uniqueId, ownerOrganizationId: device.ownerOrganizationId });
      if (status === 'SYNCED') report.repaired.push(device.uniqueId);
      else report.failed.push({ uniqueId: device.uniqueId, code: status === 'PENDING' ? 'ENGINE_UNAVAILABLE' : 'ENGINE_REJECTED' });
    }
    for (const d of engineDevices) if (!ourIds.has(d.uniqueId)) report.unknownToPlatform.push({ engineId: d.engineId, uniqueId: d.uniqueId });

    await this.remember(report);
    await this.audit.record({
      action: 'engine.reconcile',
      organizationId: null,
      actorUserId: actorUserId ?? null,
      actorType: actorUserId ? 'USER' : 'SYSTEM',
      after: { checked: report.checked, repaired: report.repaired.length, missing: report.missingInEngine.length, unknown: report.unknownToPlatform.length, failed: report.failed.length },
    });
    this.logger.log(`Reconciliation: checked ${report.checked}, repaired ${report.repaired.length}, unknown to platform ${report.unknownToPlatform.length}, failed ${report.failed.length}`);
    return report;
  }

  async last(): Promise<ReconciliationReport | null> {
    try {
      const raw = await this.redis.get(REPORT_KEY);
      return raw ? (JSON.parse(raw) as ReconciliationReport) : null;
    } catch {
      return null;
    }
  }

  private async remember(report: ReconciliationReport) {
    try {
      await this.redis.set(REPORT_KEY, JSON.stringify(report), 'EX', 7 * 86_400);
    } catch {
      /* best effort */
    }
  }
}
