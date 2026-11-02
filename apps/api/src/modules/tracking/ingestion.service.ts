import { randomUUID } from 'node:crypto';
import { BeforeApplicationShutdown, Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';
import { ENV, type Env } from '../../infrastructure/config/env';
import { REDIS } from '../../infrastructure/redis/redis.module';
import { GPS_ENGINE, type EngineStreamMessage, type EngineSubscription, type GpsEnginePort } from '../../integrations/gps-engine/port';
import { INGESTION_LEASE_KEY, LiveStateStore } from '../live-state/live-state.store';
import { FanoutService } from '../realtime/fanout.service';
import { IngestStatsService } from './ingest-stats.service';
import { OfflineSweeperService } from './offline-sweeper.service';
import { PipelineMetricsService } from './pipeline-metrics.service';
import { PositionPipelineService } from './position-pipeline.service';

const LOCK_KEY = INGESTION_LEASE_KEY;
const LOCK_TTL_MS = 15_000;
const TICK_MS = 5_000;

// Renew only if we still hold the lock / release only if we still hold it (never touch another leader's lock).
const RENEW = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end`;
const RELEASE = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`;

export interface IngestionState {
  enabled: boolean;
  leader: boolean;
  streamConnected: boolean;
  lastMessageAt: Date | null;
  lastConnectedAt: Date | null;
}

/**
 * Runs the GPS-engine stream consumer on EXACTLY ONE API instance (Redis lease with TTL + renewal). If the leader
 * dies, the lease expires and another instance takes over; the new leader backfills the latest positions so nothing
 * is missed (skill gps-traccar-integration §5). Processing is idempotent (older/equal fixes never regress state).
 */
@Injectable()
export class IngestionService implements OnModuleInit, BeforeApplicationShutdown {
  private readonly logger = new Logger(IngestionService.name);
  private readonly instanceId = randomUUID();
  private timer: NodeJS.Timeout | null = null;
  private subscription: EngineSubscription | null = null;
  private ticking = false;
  private disconnectedAt: Date | null = null;
  readonly state: IngestionState = { enabled: false, leader: false, streamConnected: false, lastMessageAt: null, lastConnectedAt: null };

  constructor(
    @Inject(GPS_ENGINE) private readonly engine: GpsEnginePort,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly pipeline: PositionPipelineService,
    private readonly stats: IngestStatsService,
    private readonly sweeper: OfflineSweeperService,
    private readonly liveState: LiveStateStore,
    private readonly fanout: FanoutService,
    private readonly metrics: PipelineMetricsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onModuleInit() {
    this.state.enabled = this.env.INGESTION_ENABLED;
    if (!this.state.enabled) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref?.();
  }

  private async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      if (this.state.leader) {
        const renewed = await this.redis.eval(RENEW, 1, LOCK_KEY, this.instanceId, String(LOCK_TTL_MS));
        if (renewed !== 1) await this.loseLeadership('lease lost');
      } else {
        const got = await this.redis.set(LOCK_KEY, this.instanceId, 'PX', LOCK_TTL_MS, 'NX');
        if (got === 'OK') await this.becomeLeader();
      }
    } catch (err) {
      this.logger.warn(`Leader election failed: ${err instanceof Error ? err.message : String(err)}`);
      // If we cannot talk to Redis we cannot prove we are the only consumer: stop consuming.
      if (this.state.leader) await this.loseLeadership('redis unavailable');
    } finally {
      this.ticking = false;
    }
  }

  private async becomeLeader() {
    this.logger.log(`Became GPS ingestion leader (${this.instanceId.slice(0, 8)})`);
    try {
      // Take ownership of the live state BEFORE consuming: one bulk read from Redis (or PostgreSQL if Redis was lost).
      await this.liveState.becomeLeader(this.instanceId);
    } catch (err) {
      // Without the state we must not consume (positions would be applied to an empty memory): give the lease back.
      this.logger.error(`Could not warm the live state; giving up leadership: ${err instanceof Error ? err.message : String(err)}`);
      await this.liveState.stepDown(false);
      await this.redis.eval(RELEASE, 1, LOCK_KEY, this.instanceId).catch(() => undefined);
      return;
    }
    this.state.leader = true;
    this.subscription = this.engine.subscribe((m) => this.onMessage(m));
    this.sweeper.start();
  }

  private async loseLeadership(reason: string) {
    this.logger.warn(`Giving up GPS ingestion leadership: ${reason}`);
    this.state.leader = false;
    this.state.streamConnected = false;
    this.sweeper.stop();
    const sub = this.subscription;
    this.subscription = null;
    await sub?.stop();
    // The lease is lost (or released): this instance must not write live state any more. On a graceful shutdown the
    // store was already flushed in beforeApplicationShutdown, while the lease was still ours.
    await this.liveState.stepDown(false);
  }

  private async onMessage(message: EngineStreamMessage): Promise<void> {
    switch (message.kind) {
      case 'connection':
        if (message.state === 'connected') {
          this.state.streamConnected = true;
          this.state.lastConnectedAt = new Date();
          this.fanout.emitEngineStatus(true);
          await this.backfill();
        } else {
          this.state.streamConnected = false;
          this.disconnectedAt = new Date();
          this.fanout.emitEngineStatus(false); // clients show "tracking engine unavailable", not stale data that looks live
        }
        return;
      case 'position':
        this.state.lastMessageAt = new Date();
        try {
          const arrivedAt = Date.now();
          await this.pipeline.process(message.position);
          this.metrics.record(arrivedAt - message.position.serverTime.getTime(), Date.now() - arrivedAt);
        } catch (err) {
          await this.stats.incr('processing_errors');
          this.logger.error(`Position processing failed: ${err instanceof Error ? err.message : String(err)}`); // no coordinates in logs
        }
        return;
      case 'malformed':
        await this.stats.incr('dropped_malformed');
        return;
      case 'device':
        return; // engine-side status is only a hint; connectivity is derived from our own state (M3)
    }
  }

  /** After (re)connecting: fetch the latest position of every device so a gap in the stream is repaired. */
  private async backfill() {
    const gapMs = this.disconnectedAt ? Date.now() - this.disconnectedAt.getTime() : 0;
    try {
      const latest = await this.engine.getLatestPositions();
      for (const p of latest) {
        try {
          await this.pipeline.process(p, 'backfill');
        } catch (err) {
          await this.stats.incr('processing_errors');
          this.logger.error(`Backfill item failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      this.logger.log(`Backfilled ${latest.length} latest position(s) after (re)connect; stream gap ${Math.round(gapMs / 1000)} s`);
    } catch (err) {
      this.logger.warn(`Backfill failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    this.disconnectedAt = null;
  }

  async beforeApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const wasLeader = this.state.leader;
    if (wasLeader) {
      // Stop consuming, then write everything the leader holds in memory (Redis batch + PostgreSQL) while the lease is still ours.
      this.sweeper.stop();
      await this.subscription?.stop().catch(() => undefined);
      this.subscription = null;
      await this.liveState.stepDown(true);
    }
    await this.loseLeadership('shutdown').catch(() => undefined);
    if (wasLeader) await this.redis.eval(RELEASE, 1, LOCK_KEY, this.instanceId).catch(() => undefined);
  }
}
