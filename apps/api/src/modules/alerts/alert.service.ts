import { Inject, Injectable } from '@nestjs/common';
import type { Alert, AlertRule } from '@prisma/client';
import Redis from 'ioredis';
import type { AlertDto, AlertType } from '@gps/shared';
import { TenantPrismaService } from '../../infrastructure/prisma/prisma.service';
import { REDIS } from '../../infrastructure/redis/redis.module';
import { FanoutService } from '../realtime/fanout.service';
import { IngestStatsService } from '../tracking/ingest-stats.service';

export interface RaiseInput {
  organizationId: string;
  vehicleId: string;
  rule: AlertRule;
  startedAt: Date;
  latitude: number | null;
  longitude: number | null;
  simulated: boolean;
  delayed: boolean;
}

export const toAlertDto = (a: Alert & { vehicle: { registrationNumber: string } }): AlertDto => ({
  id: a.id,
  vehicleId: a.vehicleId,
  registrationNumber: a.vehicle.registrationNumber,
  type: a.type as AlertType,
  severity: a.severity,
  startedAt: a.startedAt.toISOString(),
  simulated: a.simulated,
  delayed: a.delayed,
  acknowledgedAt: a.acknowledgedAt?.toISOString() ?? null,
  latitude: a.latitude,
  longitude: a.longitude,
});

/**
 * Persists an alert after de-duplicating with the rule's cooldown (Redis `SET NX PX`, key per rule and vehicle), then
 * pushes it to the organization's sockets. Notification delivery (email/SMS/...) is M8.
 */
@Injectable()
export class AlertService {
  constructor(
    private readonly tenant: TenantPrismaService,
    private readonly fanout: FanoutService,
    private readonly stats: IngestStatsService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** Returns the alert, or null when the cooldown suppressed it. */
  async raise(input: RaiseInput): Promise<AlertDto | null> {
    const { rule } = input;
    if (rule.cooldownSeconds > 0) {
      const acquired = await this.redis.set(`alert:cd:${rule.id}:${input.vehicleId}`, '1', 'PX', rule.cooldownSeconds * 1000, 'NX');
      if (acquired !== 'OK') {
        await this.stats.incr('alerts_suppressed_cooldown');
        return null;
      }
    }
    const created = await this.tenant.runInOrganization(input.organizationId, (tx) =>
      tx.alert.create({
        data: {
          organizationId: input.organizationId,
          vehicleId: input.vehicleId,
          ruleId: rule.id,
          type: rule.type,
          severity: rule.severity,
          startedAt: input.startedAt,
          latitude: input.latitude,
          longitude: input.longitude,
          simulated: input.simulated,
          delayed: input.delayed,
        },
        include: { vehicle: { select: { registrationNumber: true } } },
      }),
    );
    await this.stats.incr('alerts_raised');
    const dto = toAlertDto(created);
    this.fanout.emitAlert(input.organizationId, dto);
    return dto;
  }
}
