import { Inject, Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import type { AlertDto, VehicleDeltaDto } from '@gps/shared';
import Redis from 'ioredis';
import { ENV, type Env } from '../../infrastructure/config/env';
import { REDIS } from '../../infrastructure/redis/redis.module';
import { ENGINE_STATUS_KEY, RealtimeGateway } from './realtime.gateway';

/**
 * Coalesces vehicle deltas per organization and flushes every FANOUT_FLUSH_MS, carrying only the NEWEST state per
 * vehicle (skill gps-position-pipeline §6) — at 200 positions/s the browsers receive one batch per second, not 200
 * messages. A client that follows a single vehicle joins that vehicle's room and gets each delta immediately.
 * (Such a client is also in the organization room, so it may see the same delta twice; clients merge by `lastFixAt`.)
 */
@Injectable()
export class FanoutService implements OnModuleInit, OnApplicationShutdown {
  private readonly pending = new Map<string, Map<string, VehicleDeltaDto>>();
  private timer: NodeJS.Timeout | null = null;
  readonly counters = { deltasQueued: 0, batchesSent: 0, deltasSent: 0 };

  constructor(
    private readonly gateway: RealtimeGateway,
    @Inject(ENV) private readonly env: Env,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  onModuleInit() {
    if (!this.env.INGESTION_ENABLED) return;
    this.timer = setInterval(() => this.flush(), this.env.FANOUT_FLUSH_MS);
    this.timer.unref?.();
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    // Do NOT flush here: shutdown hooks run in no guaranteed order, so the Socket.IO Redis adapter may already be closed
    // (publishing then fails with an unhandled "Connection is closed"). Connected clients are going away anyway and
    // re-fetch the REST snapshot when they reconnect, so pending deltas are simply dropped.
    this.pending.clear();
  }

  queueDelta(orgId: string, delta: VehicleDeltaDto) {
    this.counters.deltasQueued++;
    let org = this.pending.get(orgId);
    if (!org) this.pending.set(orgId, (org = new Map()));
    org.set(delta.vehicleId, delta); // newest wins
    this.gateway.emitToVehicle(orgId, delta.vehicleId, 'vehicle:delta', { vehicles: [delta] });
  }

  emitAlert(orgId: string, alert: AlertDto) {
    this.gateway.emitToOrg(orgId, 'alert:new', alert);
  }

  emitEngineStatus(connected: boolean) {
    const status = { connected, at: new Date().toISOString() };
    this.gateway.emitToAll('engine:status', status);
    // Remembered, so a client that connects LATER (any API instance) is told the current state at once instead of waiting for the next change.
    this.redis.set(ENGINE_STATUS_KEY, JSON.stringify(status)).catch(() => undefined);
  }

  flush() {
    for (const [orgId, vehicles] of this.pending) {
      if (vehicles.size === 0) continue;
      const batch = [...vehicles.values()];
      this.counters.batchesSent++;
      this.counters.deltasSent += batch.length;
      this.gateway.emitToOrg(orgId, 'vehicle:delta', { vehicles: batch });
    }
    this.pending.clear();
  }
}
