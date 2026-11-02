import { Inject, Injectable, Logger } from '@nestjs/common';
import { GPS_ENGINE, GpsEngineError, type GpsEnginePort } from '../../integrations/gps-engine/port';
import { TenantPrismaService } from '../../infrastructure/prisma/prisma.service';
import { isUniqueViolation } from '../../common/prisma-errors';
import { DeviceRoutingService } from './device-routing.service';

/**
 * Makes a device known to the GPS engine. Our database is the source of truth: a device is registered here first
 * and the engine registration is retried (reconciliation job, `POST /devices/:id/sync`) if the engine is down, so
 * an engine outage never loses a registration. The engine-side device name is OUR device id — a neutral label, so
 * Traccar holds no customer names.
 */
@Injectable()
export class DeviceEngineSyncService {
  private readonly logger = new Logger(DeviceEngineSyncService.name);

  constructor(
    @Inject(GPS_ENGINE) private readonly engine: GpsEnginePort,
    private readonly tenant: TenantPrismaService,
    private readonly routing: DeviceRoutingService,
  ) {}

  /** `ownerOrganizationId` selects the tenant used for the write (RLS applies). Never throws for engine failures. */
  async sync(device: { id: string; uniqueId: string; ownerOrganizationId: string }): Promise<'SYNCED' | 'PENDING' | 'FAILED'> {
    let status: 'SYNCED' | 'PENDING' | 'FAILED';
    let engineId: number | null = null;
    let errorCode: string | null = null;
    try {
      const registered = await this.engine.registerDevice({ uniqueId: device.uniqueId, name: device.id });
      engineId = registered.engineId;
      status = 'SYNCED';
    } catch (err) {
      const code = err instanceof GpsEngineError ? err.code : 'ENGINE_PROTOCOL_ERROR';
      errorCode = code;
      // Unreachable engine: try again later. Anything else (rejected, auth, protocol): needs attention.
      status = code === 'ENGINE_UNAVAILABLE' ? 'PENDING' : 'FAILED';
      this.logger.warn(`Engine registration of device ${device.id} not completed: ${code}`);
    }

    try {
      await this.tenant.runInOrganization(device.ownerOrganizationId, (tx) =>
        tx.gpsDevice.update({
          where: { id: device.id },
          data: { traccarDeviceId: engineId ?? undefined, engineSyncStatus: status, engineSyncError: errorCode },
        }),
      );
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      // The engine id is already linked to another device row: an inconsistency needing an administrator.
      status = 'FAILED';
      await this.tenant.runInOrganization(device.ownerOrganizationId, (tx) =>
        tx.gpsDevice.update({ where: { id: device.id }, data: { engineSyncStatus: 'FAILED', engineSyncError: 'ENGINE_ID_CONFLICT' } }),
      );
    }
    this.routing.invalidate(engineId);
    return status;
  }
}
