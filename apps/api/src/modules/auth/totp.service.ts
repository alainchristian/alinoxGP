import { Inject, Injectable } from '@nestjs/common';
import { authenticator } from 'otplib';
import { ENV, type Env } from '../../infrastructure/config/env';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { decryptSecret, encryptSecret, randomToken, sha256 } from '../users/crypto';

authenticator.options = { window: 1 }; // tolerate one 30 s step of clock drift

@Injectable()
export class TotpService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Creates (or replaces an unconfirmed) secret. Stored encrypted; not active until confirmed. */
  async beginEnrollment(userId: string, email: string) {
    const secret = authenticator.generateSecret();
    await this.prisma.user.update({
      where: { id: userId },
      data: { totpSecretEnc: encryptSecret(secret, this.env.TOTP_ENCRYPTION_KEY), totpEnabledAt: null },
    });
    return { secret, otpauthUrl: authenticator.keyuri(email, 'GPS Platform', secret) };
  }

  /** Checks a 6-digit code against the stored secret (whether or not enrolment is confirmed yet). */
  async checkCode(userId: string, code: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.totpSecretEnc) return false;
    try {
      return authenticator.check(code, decryptSecret(user.totpSecretEnc, this.env.TOTP_ENCRYPTION_KEY));
    } catch {
      return false;
    }
  }

  async enable(userId: string): Promise<string[]> {
    const codes = Array.from({ length: 8 }, () => `${randomToken(4)}-${randomToken(4)}`.toLowerCase());
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { totpEnabledAt: new Date() } }),
      this.prisma.totpRecoveryCode.deleteMany({ where: { userId } }),
      this.prisma.totpRecoveryCode.createMany({ data: codes.map((c) => ({ userId, codeHash: sha256(c) })) }),
    ]);
    return codes;
  }

  async disable(userId: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { totpSecretEnc: null, totpEnabledAt: null } }),
      this.prisma.totpRecoveryCode.deleteMany({ where: { userId } }),
    ]);
  }

  /** Accepts a 6-digit code or a single-use recovery code. */
  async verifyLoginCode(userId: string, input: string): Promise<boolean> {
    const code = input.trim().toLowerCase();
    if (/^\d{6}$/.test(code)) return this.checkCode(userId, code);
    const claimed = await this.prisma.totpRecoveryCode.updateMany({
      where: { userId, codeHash: sha256(code), usedAt: null },
      data: { usedAt: new Date() },
    });
    return claimed.count === 1;
  }
}
