import { Inject, Injectable } from '@nestjs/common';
import { EmailTokenPurpose, User } from '@prisma/client';
import type { UserDto } from '@gps/shared';
import { ENV, type Env } from '../../infrastructure/config/env';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { randomToken, sha256 } from './crypto';
import { PasswordService } from './password.service';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  }

  findById(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  create(input: { email: string; passwordHash: string; fullName: string; emailVerified?: boolean }) {
    return this.prisma.user.create({
      data: {
        email: input.email.toLowerCase(),
        passwordHash: input.passwordHash,
        fullName: input.fullName,
        emailVerifiedAt: input.emailVerified ? new Date() : null,
      },
    });
  }

  async markEmailVerified(userId: string) {
    await this.prisma.user.updateMany({ where: { id: userId, emailVerifiedAt: null }, data: { emailVerifiedAt: new Date() } });
  }

  async touchLastLogin(userId: string) {
    await this.prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
  }

  hashPassword(password: string) {
    return this.passwords.hash(password);
  }

  verifyPassword(user: Pick<User, 'passwordHash'>, password: string) {
    return this.passwords.verify(user.passwordHash, password);
  }

  verifyDummyPassword(password: string) {
    return this.passwords.verifyDummy(password);
  }

  async setPassword(userId: string, password: string) {
    const passwordHash = await this.passwords.hash(password);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });
  }

  // ---- single-use email tokens (verification, password reset); only the hash is stored ----

  async issueEmailToken(userId: string, purpose: EmailTokenPurpose): Promise<string> {
    const raw = randomToken();
    const ttlMs =
      purpose === 'VERIFY_EMAIL'
        ? this.env.EMAIL_VERIFY_TTL_HOURS * 3_600_000
        : this.env.PASSWORD_RESET_TTL_MINUTES * 60_000;
    // Invalidate older unused tokens of the same purpose.
    await this.prisma.emailToken.updateMany({
      where: { userId, purpose, usedAt: null },
      data: { usedAt: new Date() },
    });
    await this.prisma.emailToken.create({
      data: { userId, purpose, tokenHash: sha256(raw), expiresAt: new Date(Date.now() + ttlMs) },
    });
    return raw;
  }

  /** Atomically consumes a token; returns the user id or null (unknown, used or expired). */
  async consumeEmailToken(raw: string, purpose: EmailTokenPurpose): Promise<string | null> {
    const token = await this.prisma.emailToken.findUnique({ where: { tokenHash: sha256(raw) } });
    if (!token || token.purpose !== purpose || token.expiresAt < new Date()) return null;
    const claimed = await this.prisma.emailToken.updateMany({
      where: { id: token.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    return claimed.count === 1 ? token.userId : null;
  }

  toDto(user: User): UserDto {
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      locale: user.locale,
      emailVerified: user.emailVerifiedAt !== null,
      totpEnabled: user.totpEnabledAt !== null,
    };
  }
}
