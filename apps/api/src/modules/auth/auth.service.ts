import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ClsService } from 'nestjs-cls';
import Redis from 'ioredis';
import type { AuthSessionDto, MeDto, SessionInfoDto } from '@gps/shared';
import { AppException, forbidden, unauthorized } from '../../common/errors';
import type { AppClsStore } from '../../common/request-context';
import { ENV, type Env } from '../../infrastructure/config/env';
import { REDIS } from '../../infrastructure/redis/redis.module';
import { AccessService } from '../access-control/access.service';
import { AuditService } from '../audit/audit.service';
import { resetPasswordTemplate, verifyEmailTemplate } from '../messaging/email-templates';
import { EMAIL_PORT, type EmailPort } from '../messaging/email.port';
import { ProvidersService } from '../providers/providers.service';
import { sha256 } from '../users/crypto';
import { UsersService } from '../users/users.service';
import { SessionService } from './session.service';
import { TotpService } from './totp.service';

const MAX_FAILED_LOGINS = 10;
const LOCK_WINDOW_SECONDS = 15 * 60;

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly sessions: SessionService,
    private readonly totp: TotpService,
    private readonly providers: ProvidersService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly jwt: JwtService,
    private readonly cls: ClsService<AppClsStore>,
    @Inject(EMAIL_PORT) private readonly email: EmailPort,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private meta() {
    return { ip: this.cls.get('ip'), userAgent: this.cls.get('userAgent') };
  }

  private get userId() {
    return this.cls.get('auth')!.userId;
  }
  private get sessionId() {
    return this.cls.get('auth')!.sessionId;
  }

  // ------------------------------------------------------------------ verification
  // Public sign-up is for GPS providers only (POST /providers/register, ProvidersService). End customers are invited.

  private async sendVerification(userId: string, email: string, fullName: string) {
    const token = await this.users.issueEmailToken(userId, 'VERIFY_EMAIL');
    await this.email.send({ to: email, ...verifyEmailTemplate(this.env.APP_BASE_URL, token, fullName) });
  }

  async verifyEmail(token: string): Promise<void> {
    const userId = await this.users.consumeEmailToken(token, 'VERIFY_EMAIL');
    if (!userId) throw new AppException('INVALID_OR_EXPIRED_TOKEN', 400, 'This link is invalid or has expired');
    await this.users.markEmailVerified(userId);
    await this.audit.record({ action: 'auth.email_verified', actorUserId: userId });
    // A provider that registered with this address now waits for platform approval.
    await this.providers.onEmailVerified(userId);
  }

  async resendVerification(email: string): Promise<void> {
    const user = await this.users.findByEmail(email);
    if (user && !user.emailVerifiedAt) await this.sendVerification(user.id, user.email, user.fullName);
  }

  // ------------------------------------------------------------------ login / session lifecycle

  private failKey(email: string) {
    return `auth:fail:${sha256(email)}`;
  }

  private async assertNotLocked(email: string) {
    try {
      const n = Number((await this.redis.get(this.failKey(email))) ?? 0);
      if (n >= MAX_FAILED_LOGINS) {
        throw new AppException('ACCOUNT_TEMPORARILY_LOCKED', 429, 'Too many failed attempts. Try again later.');
      }
    } catch (err) {
      if (err instanceof AppException) throw err; // Redis unavailable: IP rate limiting still applies
    }
  }

  private async recordFailure(email: string) {
    try {
      const key = this.failKey(email);
      const n = await this.redis.incr(key);
      if (n === 1) await this.redis.expire(key, LOCK_WINDOW_SECONDS);
    } catch {
      /* best effort */
    }
  }

  private async issueTokens(userId: string, sessionId: string) {
    return this.jwt.signAsync({ sub: userId, sid: sessionId });
  }

  async login(input: { email: string; password: string; totpCode?: string }) {
    await this.assertNotLocked(input.email);
    const user = await this.users.findByEmail(input.email);
    if (!user) {
      await this.users.verifyDummyPassword(input.password);
      await this.recordFailure(input.email);
      throw unauthorized('INVALID_CREDENTIALS', 'Incorrect email or password');
    }
    if (!(await this.users.verifyPassword(user, input.password))) {
      await this.recordFailure(input.email);
      await this.audit.record({ action: 'auth.login_failed', actorUserId: user.id });
      throw unauthorized('INVALID_CREDENTIALS', 'Incorrect email or password');
    }
    if (user.status !== 'ACTIVE') throw forbidden('ACCOUNT_DISABLED', 'This account is disabled');
    if (!user.emailVerifiedAt) throw forbidden('EMAIL_NOT_VERIFIED', 'Verify your email address before signing in');
    if (user.totpEnabledAt) {
      if (!input.totpCode) throw unauthorized('TOTP_REQUIRED', 'Enter your authenticator code');
      if (!(await this.totp.verifyLoginCode(user.id, input.totpCode))) {
        await this.recordFailure(input.email);
        await this.audit.record({ action: 'auth.login_failed', actorUserId: user.id });
        throw unauthorized('INVALID_TOTP', 'The authenticator code is not valid');
      }
    }
    try {
      await this.redis.del(this.failKey(input.email));
    } catch {
      /* best effort */
    }
    const { session, refreshToken } = await this.sessions.create(user.id, this.meta());
    await this.users.touchLastLogin(user.id);
    await this.audit.record({ action: 'auth.login', actorUserId: user.id, targetType: 'session', targetId: session.id });
    const result: AuthSessionDto = {
      accessToken: await this.issueTokens(user.id, session.id),
      expiresInSeconds: this.env.ACCESS_TOKEN_TTL_SECONDS,
      user: this.users.toDto(user),
    };
    return { result, refreshToken, session };
  }

  async refresh(presentedRefreshToken: string) {
    const { session, refreshToken } = await this.sessions.rotate(presentedRefreshToken);
    const user = await this.users.findById(session.userId);
    if (!user || user.status !== 'ACTIVE') {
      await this.sessions.revoke(session.id, 'USER_INACTIVE');
      throw unauthorized('SESSION_ENDED');
    }
    const result: AuthSessionDto = {
      accessToken: await this.issueTokens(user.id, session.id),
      expiresInSeconds: this.env.ACCESS_TOKEN_TTL_SECONDS,
      user: this.users.toDto(user),
    };
    return { result, refreshToken, session };
  }

  async logout(): Promise<void> {
    await this.sessions.revoke(this.sessionId, 'LOGOUT');
    await this.audit.record({ action: 'auth.logout', targetType: 'session', targetId: this.sessionId });
  }

  // ------------------------------------------------------------------ password management

  /** Always succeeds from the caller's point of view. */
  async forgotPassword(email: string): Promise<void> {
    const user = await this.users.findByEmail(email);
    if (!user || user.status !== 'ACTIVE') return;
    const token = await this.users.issueEmailToken(user.id, 'RESET_PASSWORD');
    await this.email.send({ to: user.email, ...resetPasswordTemplate(this.env.APP_BASE_URL, token) });
    await this.audit.record({ action: 'auth.password_reset_requested', actorUserId: user.id });
  }

  async resetPassword(token: string, password: string): Promise<void> {
    const userId = await this.users.consumeEmailToken(token, 'RESET_PASSWORD');
    if (!userId) throw new AppException('INVALID_OR_EXPIRED_TOKEN', 400, 'This link is invalid or has expired');
    await this.users.setPassword(userId, password);
    // A reset implies the mailbox is controlled by the account owner.
    await this.users.markEmailVerified(userId);
    await this.sessions.revokeAllForUser(userId, undefined, 'PASSWORD_RESET');
    await this.audit.record({ action: 'auth.password_reset', actorUserId: userId });
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    const user = await this.users.findById(this.userId);
    if (!user || !(await this.users.verifyPassword(user, currentPassword))) {
      throw unauthorized('INVALID_CREDENTIALS', 'Your current password is incorrect');
    }
    await this.users.setPassword(user.id, newPassword);
    await this.sessions.revokeAllForUser(user.id, this.sessionId, 'PASSWORD_CHANGED');
    await this.audit.record({ action: 'auth.password_changed' });
  }

  // ------------------------------------------------------------------ step-up & 2FA

  async stepUp(input: { password?: string; totpCode?: string }): Promise<void> {
    const user = await this.users.findById(this.userId);
    if (!user) throw unauthorized('UNAUTHENTICATED');
    let ok = false;
    if (input.password) ok = await this.users.verifyPassword(user, input.password);
    else if (input.totpCode && user.totpEnabledAt) ok = await this.totp.verifyLoginCode(user.id, input.totpCode);
    if (!ok) {
      await this.audit.record({ action: 'auth.step_up_failed' });
      throw unauthorized('STEP_UP_FAILED', 'Confirmation failed');
    }
    await this.sessions.markStepUp(this.sessionId);
    await this.audit.record({ action: 'auth.step_up' });
  }

  async beginTotp() {
    const user = await this.users.findById(this.userId);
    if (!user) throw unauthorized('UNAUTHENTICATED');
    if (user.totpEnabledAt) throw new AppException('TOTP_ALREADY_ENABLED', 409, 'Two-factor authentication is already enabled');
    return this.totp.beginEnrollment(user.id, user.email);
  }

  async confirmTotp(code: string) {
    if (!(await this.totp.checkCode(this.userId, code))) {
      throw new AppException('INVALID_TOTP', 400, 'The authenticator code is not valid');
    }
    const recoveryCodes = await this.totp.enable(this.userId);
    await this.audit.record({ action: 'auth.2fa_enabled' });
    return { recoveryCodes };
  }

  async disableTotp(password: string): Promise<void> {
    const user = await this.users.findById(this.userId);
    if (!user || !(await this.users.verifyPassword(user, password))) {
      throw unauthorized('INVALID_CREDENTIALS', 'Your password is incorrect');
    }
    await this.totp.disable(user.id);
    await this.audit.record({ action: 'auth.2fa_disabled' });
  }

  // ------------------------------------------------------------------ sessions & identity

  async listSessions(): Promise<SessionInfoDto[]> {
    const rows = await this.sessions.listActive(this.userId);
    return rows.map((s) => ({
      id: s.id,
      userAgent: s.userAgent,
      ip: s.ip,
      createdAt: s.createdAt.toISOString(),
      lastUsedAt: s.lastUsedAt.toISOString(),
      current: s.id === this.sessionId,
    }));
  }

  async revokeSession(sessionId: string): Promise<void> {
    const owned = await this.sessions.findOwned(this.userId, sessionId);
    if (!owned) throw new AppException('SESSION_NOT_FOUND', 404, 'Session not found');
    await this.sessions.revoke(sessionId, 'USER_REVOKED');
    await this.audit.record({ action: 'auth.session_revoked', targetType: 'session', targetId: sessionId });
  }

  async me(requestedOrganizationId?: string): Promise<MeDto> {
    const user = await this.users.findById(this.userId);
    if (!user) throw unauthorized('UNAUTHENTICATED');
    const memberships = await this.access.listMemberships(user.id);
    const candidate = requestedOrganizationId ?? memberships.find((m) => m.relation === 'MEMBER')?.organization.id ?? null;
    let activeOrganizationId: string | null = null;
    let permissions: string[] = [];
    if (candidate) {
      const resolved = await this.access.resolve(user.id, candidate);
      if (resolved && resolved.organization.status === 'ACTIVE') {
        activeOrganizationId = resolved.organization.id;
        permissions = [...resolved.permissions].sort();
      }
    }
    return { user: this.users.toDto(user), memberships, activeOrganizationId, permissions, entitlements: {} };
  }
}
