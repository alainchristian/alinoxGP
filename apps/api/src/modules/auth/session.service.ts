import { Inject, Injectable, Logger } from '@nestjs/common';
import { Session } from '@prisma/client';
import Redis from 'ioredis';
import { STEP_UP_WINDOW_SECONDS } from '@gps/shared';
import { ENV, type Env } from '../../infrastructure/config/env';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { REDIS } from '../../infrastructure/redis/redis.module';
import { unauthorized } from '../../common/errors';
import { randomToken, sha256 } from '../users/crypto';

/** A refresh token presented again after this long is treated as theft; sooner is a benign tab race. */
const REUSE_GRACE_MS = 10_000;
const revokedKey = (sid: string) => `auth:revoked:${sid}`;

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private get refreshTtlMs() {
    return this.env.REFRESH_TOKEN_TTL_DAYS * 86_400_000;
  }

  async create(userId: string, meta: { ip?: string; userAgent?: string }) {
    const refreshToken = randomToken();
    const now = Date.now();
    const session = await this.prisma.session.create({
      data: {
        userId,
        ip: meta.ip,
        userAgent: meta.userAgent?.slice(0, 300),
        expiresAt: new Date(now + this.refreshTtlMs),
        refreshTokens: {
          create: { tokenHash: sha256(refreshToken), expiresAt: new Date(now + this.refreshTtlMs) },
        },
      },
    });
    return { session, refreshToken };
  }

  /** Rotates a refresh token. Reuse of an already-rotated token revokes the whole session (ADR-0002). */
  async rotate(presented: string): Promise<{ session: Session; refreshToken: string }> {
    const now = new Date();
    const token = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(presented) },
      include: { session: true },
    });
    if (!token) throw unauthorized('INVALID_REFRESH_TOKEN');
    const { session } = token;
    if (session.revokedAt || session.expiresAt < now || token.expiresAt < now) {
      throw unauthorized('SESSION_ENDED');
    }
    if (token.usedAt) {
      if (now.getTime() - token.usedAt.getTime() > REUSE_GRACE_MS) {
        await this.revoke(session.id, 'REFRESH_TOKEN_REUSE');
        throw unauthorized('REFRESH_TOKEN_REUSED');
      }
      throw unauthorized('REFRESH_RACE');
    }
    const claimed = await this.prisma.refreshToken.updateMany({
      where: { id: token.id, usedAt: null },
      data: { usedAt: now },
    });
    if (claimed.count !== 1) throw unauthorized('REFRESH_RACE');

    const refreshToken = randomToken();
    await this.prisma.refreshToken.create({
      data: {
        sessionId: session.id,
        tokenHash: sha256(refreshToken),
        expiresAt: new Date(now.getTime() + this.refreshTtlMs),
      },
    });
    const updated = await this.prisma.session.update({ where: { id: session.id }, data: { lastUsedAt: now } });
    return { session: updated, refreshToken };
  }

  async revoke(sessionId: string, reason: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    try {
      // Kept for the access-token lifetime (+ margin): after that the token is expired anyway.
      await this.redis.set(revokedKey(sessionId), '1', 'EX', this.env.ACCESS_TOKEN_TTL_SECONDS + 60);
    } catch (err) {
      this.logger.warn(`Could not mark session revoked in Redis; DB fallback remains authoritative (${String(err)})`);
    }
  }

  async revokeAllForUser(userId: string, exceptSessionId?: string, reason = 'REVOKED'): Promise<void> {
    const sessions = await this.prisma.session.findMany({
      where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
      select: { id: true },
    });
    for (const s of sessions) await this.revoke(s.id, reason);
  }

  /** Redis first (cheap); the database is the fallback if Redis is unavailable. */
  async isRevoked(sessionId: string): Promise<boolean> {
    try {
      return (await this.redis.exists(revokedKey(sessionId))) === 1;
    } catch {
      const s = await this.prisma.session.findUnique({ where: { id: sessionId }, select: { revokedAt: true } });
      return !s || s.revokedAt !== null;
    }
  }

  markStepUp(sessionId: string) {
    return this.prisma.session.update({ where: { id: sessionId }, data: { stepUpAt: new Date() } });
  }

  async hasFreshStepUp(sessionId: string): Promise<boolean> {
    const s = await this.prisma.session.findUnique({ where: { id: sessionId }, select: { stepUpAt: true } });
    return !!s?.stepUpAt && Date.now() - s.stepUpAt.getTime() <= STEP_UP_WINDOW_SECONDS * 1000;
  }

  listActive(userId: string) {
    return this.prisma.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastUsedAt: 'desc' },
    });
  }

  findOwned(userId: string, sessionId: string) {
    return this.prisma.session.findFirst({ where: { id: sessionId, userId } });
  }
}
