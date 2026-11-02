import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import Redis from 'ioredis';
import { Public } from '../../common/decorators';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { REDIS } from '../../infrastructure/redis/redis.module';

@ApiTags('Health')
@Controller('health')
@SkipThrottle()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** Liveness — process is up. Exposes no detail. */
  @Get()
  @Public()
  live() {
    return { status: 'ok' };
  }

  /** Readiness — dependencies reachable. Returns only ok/unavailable per dependency. */
  @Get('ready')
  @Public()
  async ready() {
    const db = await this.prisma.$queryRaw`SELECT 1`.then(() => true, () => false);
    const redis = await this.redis.ping().then((r) => r === 'PONG', () => false);
    if (!db || !redis) throw new ServiceUnavailableException();
    return { status: 'ok' };
  }
}
