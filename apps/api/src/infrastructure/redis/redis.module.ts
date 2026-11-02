import { Global, Inject, Injectable, Module, OnApplicationShutdown } from '@nestjs/common';
import Redis from 'ioredis';
import { ENV, type Env } from '../config/env';

export const REDIS = Symbol('REDIS');

@Injectable()
class RedisShutdown implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}
  /**
   * Graceful: QUIT lets commands already sent (fire-and-forget counters, ring buffer, lease release) complete instead of
   * rejecting them with "Connection is closed". It runs in the application-shutdown phase, after every module's
   * onModuleDestroy, so other services' shutdown hooks (final flush, lease release) can still use Redis.
   */
  async onApplicationShutdown() {
    try {
      await this.redis.quit();
    } catch {
      this.redis.disconnect();
    }
  }
}

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [ENV],
      useFactory: (env: Env) =>
        new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2, enableOfflineQueue: false, lazyConnect: false, keyPrefix: env.REDIS_KEY_PREFIX }),
    },
    RedisShutdown,
  ],
  exports: [REDIS],
})
export class RedisModule {}
