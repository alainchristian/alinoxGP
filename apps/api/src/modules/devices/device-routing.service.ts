import { Inject, Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { ENV, type Env } from '../../infrastructure/config/env';
import { SystemPrismaService } from '../../infrastructure/prisma/prisma.service';
import { REDIS } from '../../infrastructure/redis/redis.module';

export interface DeviceRoute {
  deviceId: string;
  uniqueId: string;
  isSimulated: boolean;
  ownerOrganizationId: string;
  ownerIsSandbox: boolean;
  /** The installation currently open for this device; null when the device is registered but not on a vehicle. */
  assignment: { organizationId: string; vehicleId: string } | null;
}

const CHANNEL_NAME = 'gps:routing:invalidate';
/** Entries beyond this are dropped oldest-first so the cache cannot grow without bound. */
const MAX_ENTRIES = 50_000;

/**
 * Resolves `engine device id -> device -> open assignment -> organization/vehicle` for every incoming position
 * (gps-tenant-isolation §5: Traccar has no notion of OUR tenants that we trust). Unmapped devices resolve to null
 * and are dropped and counted by the caller.
 *
 * Uses the system DB role (reviewed use: ingestion routing happens before any tenant context exists).
 *
 * An in-process cache keeps the hot path off the database. Its TTL must exceed the devices' reporting interval, otherwise
 * it never hits. A long TTL is safe because every assignment change calls `invalidate()`, which clears the entry on THIS
 * instance and publishes the change over Redis so every OTHER instance clears it too. If Redis is unreachable the
 * publish fails (logged) and other instances fall back to the TTL as the upper bound of staleness.
 */
@Injectable()
export class DeviceRoutingService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(DeviceRoutingService.name);
  private readonly cache = new Map<number, { route: DeviceRoute | null; expires: number }>();
  private readonly instanceId = randomUUID();
  private subscriber: Redis | null = null;
  private hits = 0;
  private misses = 0;

  /** Pub/sub channels are not covered by the Redis client's keyPrefix, so the suite/environment prefix is added here. */
  private get channel() {
    return `${this.env.REDIS_KEY_PREFIX ?? ''}${CHANNEL_NAME}`;
  }

  constructor(
    private readonly system: SystemPrismaService,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onModuleInit() {
    // A subscribing connection cannot issue other commands, so it gets its own.
    const sub = new Redis(this.env.REDIS_URL);
    sub.on('error', (err) => this.logger.warn(`Routing invalidation subscriber: ${err.message}`));
    sub.on('message', (_channel, payload) => this.handleInvalidation(payload));
    sub.subscribe(this.channel).catch((err: unknown) => this.logger.warn(`Could not subscribe to routing invalidations: ${String(err)}`));
    this.subscriber = sub;
  }

  async onApplicationShutdown() {
    const sub = this.subscriber;
    this.subscriber = null;
    if (sub) await sub.quit().catch(() => sub.disconnect());
  }

  async resolve(engineDeviceId: number, now = Date.now()): Promise<DeviceRoute | null> {
    const hit = this.cache.get(engineDeviceId);
    if (hit && hit.expires > now) {
      this.hits++;
      return hit.route;
    }
    this.misses++;

    const device = await this.system.gpsDevice.findUnique({
      where: { traccarDeviceId: engineDeviceId },
      include: { owner: { select: { isSandbox: true } }, assignments: { where: { unassignedAt: null }, take: 1 } },
    });
    const route: DeviceRoute | null = device
      ? {
          deviceId: device.id,
          uniqueId: device.uniqueId,
          isSimulated: device.isSimulated,
          ownerOrganizationId: device.ownerOrganizationId,
          ownerIsSandbox: device.owner.isSandbox,
          assignment: device.assignments[0]
            ? { organizationId: device.assignments[0].organizationId, vehicleId: device.assignments[0].vehicleId }
            : null,
        }
      : null;
    if (this.cache.size >= MAX_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(engineDeviceId, { route, expires: now + this.env.ROUTING_CACHE_TTL_SEC * 1000 });
    return route;
  }

  /** Cache effectiveness since start (or the last reset): a hit rate far below 100 % on a steady fleet means the TTL is too short. */
  stats(): { hits: number; misses: number; hitRate: number | null } {
    const total = this.hits + this.misses;
    return { hits: this.hits, misses: this.misses, hitRate: total === 0 ? null : this.hits / total };
  }

  resetStats() {
    this.hits = 0;
    this.misses = 0;
  }

  /** Drops one device (or everything) locally and tells the other API instances to do the same. */
  invalidate(engineDeviceId?: number | null) {
    const all = engineDeviceId === undefined || engineDeviceId === null;
    if (all) this.cache.clear();
    else this.cache.delete(engineDeviceId);
    this.redis
      .publish(this.channel, JSON.stringify({ from: this.instanceId, engineDeviceId: all ? null : engineDeviceId }))
      .catch((err: unknown) => this.logger.warn(`Could not publish routing invalidation (peers fall back to the TTL): ${String(err)}`));
  }

  /** A peer instance changed an assignment (public so it can be tested without a second Redis connection). */
  handleInvalidation(payload: string) {
    try {
      const msg = JSON.parse(payload) as { from?: string; engineDeviceId?: number | null };
      if (msg.from === this.instanceId) return; // already applied locally
      if (typeof msg.engineDeviceId === 'number') this.cache.delete(msg.engineDeviceId);
      else this.cache.clear();
    } catch {
      this.cache.clear(); // an unreadable message: the safe reaction is to forget everything
    }
  }
}
