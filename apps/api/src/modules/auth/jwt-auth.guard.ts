import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { ClsService } from 'nestjs-cls';
import { IS_PUBLIC, REQUIRE_STEP_UP } from '../../common/decorators';
import { forbidden, unauthorized } from '../../common/errors';
import type { AppClsStore } from '../../common/request-context';
import { ENV, type Env } from '../../infrastructure/config/env';
import { SessionService } from './session.service';

interface AccessTokenPayload {
  sub: string;
  sid: string;
}

/** Authenticates the bearer access token and rejects tokens of revoked sessions (ADR-0002). */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly sessions: SessionService,
    private readonly cls: ClsService<AppClsStore>,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()])) {
      return true;
    }
    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization;
    const [scheme, token] = header?.split(' ') ?? [];
    if (scheme !== 'Bearer' || !token) throw unauthorized('UNAUTHENTICATED');

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        secret: this.env.JWT_ACCESS_SECRET,
        algorithms: ['HS256'],
      });
    } catch {
      throw unauthorized('INVALID_TOKEN', 'Your session has expired');
    }
    if (!payload.sub || !payload.sid || (await this.sessions.isRevoked(payload.sid))) {
      throw unauthorized('SESSION_REVOKED', 'Your session has ended');
    }
    this.cls.set('auth', { userId: payload.sub, sessionId: payload.sid });
    return true;
  }
}

/** Sensitive actions need a password/TOTP confirmation within the last 5 minutes (step-up). */
@Injectable()
export class StepUpGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.reflector.getAllAndOverride<boolean>(REQUIRE_STEP_UP, [context.getHandler(), context.getClass()])) {
      return true;
    }
    const auth = this.cls.get('auth');
    if (!auth) throw unauthorized('UNAUTHENTICATED');
    if (!(await this.sessions.hasFreshStepUp(auth.sessionId))) {
      throw forbidden('STEP_UP_REQUIRED', 'Confirm your password to continue');
    }
    return true;
  }
}
