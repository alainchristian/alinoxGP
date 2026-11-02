import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS } from '../../infrastructure/redis/redis.module';

export type IngestCounter =
  | 'accepted'
  | 'heartbeat_invalid'
  | 'ignored_out_of_order'
  | 'dropped_unmapped'
  | 'dropped_malformed'
  | 'unassigned_device'
  | 'blocked_simulated'
  | 'backfilled'
  | 'processing_errors'
  | 'duplicate'
  | 'delayed_fix'
  | 'clock_skew'
  | 'implausible_jump'
  | 'jump_rebaselined'
  | 'offline_detected'
  | 'alerts_raised'
  | 'alerts_suppressed_delayed'
  | 'alerts_suppressed_cooldown';

const KEY = 'gps:ingest:stats';

/**
 * Durable counters (Redis hash) for everything the pipeline drops or ignores, so nothing disappears silently.
 * Technical administrators see them in `GET /admin/engine/health`; unmapped devices are a possible onboarding issue.
 */
@Injectable()
export class IngestStatsService {
  private readonly logger = new Logger(IngestStatsService.name);

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  /** Fire-and-forget: a counter must never slow the position pipeline (it was a Redis round trip per position). */
  async incr(counter: IngestCounter, by = 1): Promise<void> {
    this.redis.hincrby(KEY, counter, by).catch((err: unknown) => {
      this.logger.warn(`Could not update ingest counter ${counter}: ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  async all(): Promise<Record<string, number>> {
    try {
      const raw = await this.redis.hgetall(KEY);
      return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Number(v)]));
    } catch {
      return {};
    }
  }

  /** Test support. */
  async reset(): Promise<void> {
    await this.redis.del(KEY);
  }
}
