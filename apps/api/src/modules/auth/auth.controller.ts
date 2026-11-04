import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { Authenticated, Public } from '../../common/decorators';
import { AppException, forbidden, unauthorized } from '../../common/errors';
import { isUuid } from '../../common/mappers';
import { AUTH_THROTTLE } from '../../common/throttle';
import { Inject } from '@nestjs/common';
import { ENV, type Env } from '../../infrastructure/config/env';
import { AuthService } from './auth.service';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  ResendVerificationDto,
  ResetPasswordDto,
  StepUpDto,
  TotpConfirmDto,
  TotpDisableDto,
  VerifyEmailDto,
} from './dto';

export const REFRESH_COOKIE = 'gps_rt';
const COOKIE_PATH = '/api/v1/auth';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private setRefreshCookie(res: Response, token: string) {
    res.cookie(REFRESH_COOKIE, token, {
      httpOnly: true,
      secure: this.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: COOKIE_PATH,
      maxAge: this.env.REFRESH_TOKEN_TTL_DAYS * 86_400_000,
    });
  }

  private clearRefreshCookie(res: Response) {
    res.clearCookie(REFRESH_COOKIE, { path: COOKIE_PATH, httpOnly: true, sameSite: 'strict' });
  }

  @Post('login')
  @Public()
  @HttpCode(200)
  @Throttle(AUTH_THROTTLE)
  async login(@Body() body: LoginDto, @Res({ passthrough: true }) res: Response) {
    const { result, refreshToken } = await this.auth.login(body);
    this.setRefreshCookie(res, refreshToken);
    return result;
  }

  /** Cookie-authenticated; additionally requires a custom header so a cross-site form post cannot trigger it. */
  @Post('refresh')
  @Public()
  @HttpCode(200)
  @Throttle(AUTH_THROTTLE)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Headers('x-requested-with') requestedWith?: string,
  ) {
    if (requestedWith !== 'gps-web') throw forbidden('CSRF_HEADER_REQUIRED', 'Missing request header');
    const presented = (req.cookies as Record<string, string | undefined> | undefined)?.[REFRESH_COOKIE];
    if (!presented) throw unauthorized('NO_REFRESH_TOKEN');
    try {
      const { result, refreshToken } = await this.auth.refresh(presented);
      this.setRefreshCookie(res, refreshToken);
      return result;
    } catch (err) {
      // A benign race (another tab rotated the token an instant ago) must NOT clear the cookie:
      // the browser already holds the winner's fresh token and the client will simply retry.
      if (!(err instanceof AppException && err.code === 'REFRESH_RACE')) this.clearRefreshCookie(res);
      throw err;
    }
  }

  @Post('logout')
  @Authenticated()
  @HttpCode(204)
  async logout(@Res({ passthrough: true }) res: Response) {
    await this.auth.logout();
    this.clearRefreshCookie(res);
  }

  @Post('forgot-password')
  @Public()
  @HttpCode(202)
  @Throttle(AUTH_THROTTLE)
  async forgot(@Body() body: ForgotPasswordDto) {
    await this.auth.forgotPassword(body.email);
    return { message: 'If an account exists for this address, a reset link has been sent.' };
  }

  @Post('reset-password')
  @Public()
  @HttpCode(204)
  @Throttle(AUTH_THROTTLE)
  async reset(@Body() body: ResetPasswordDto) {
    await this.auth.resetPassword(body.token, body.password);
  }

  @Post('verify-email')
  @Public()
  @HttpCode(204)
  @Throttle(AUTH_THROTTLE)
  async verify(@Body() body: VerifyEmailDto) {
    await this.auth.verifyEmail(body.token);
  }

  @Post('resend-verification')
  @Public()
  @HttpCode(202)
  @Throttle(AUTH_THROTTLE)
  async resend(@Body() body: ResendVerificationDto) {
    await this.auth.resendVerification(body.email);
    return { message: 'If the address is awaiting verification, a new email has been sent.' };
  }

  @Post('step-up')
  @Authenticated()
  @HttpCode(204)
  @Throttle(AUTH_THROTTLE)
  async stepUp(@Body() body: StepUpDto) {
    await this.auth.stepUp(body);
  }

  @Post('change-password')
  @Authenticated()
  @HttpCode(204)
  @Throttle(AUTH_THROTTLE)
  async changePassword(@Body() body: ChangePasswordDto) {
    await this.auth.changePassword(body.currentPassword, body.newPassword);
  }

  @Post('2fa/enroll')
  @Authenticated()
  enroll() {
    return this.auth.beginTotp();
  }

  @Post('2fa/confirm')
  @Authenticated()
  @HttpCode(200)
  @Throttle(AUTH_THROTTLE)
  confirm(@Body() body: TotpConfirmDto) {
    return this.auth.confirmTotp(body.code);
  }

  @Post('2fa/disable')
  @Authenticated()
  @HttpCode(204)
  @Throttle(AUTH_THROTTLE)
  async disable(@Body() body: TotpDisableDto) {
    await this.auth.disableTotp(body.password);
  }

  @Get('sessions')
  @Authenticated()
  sessions() {
    return this.auth.listSessions();
  }

  @Delete('sessions/:sessionId')
  @Authenticated()
  @HttpCode(204)
  async revoke(@Param('sessionId', ParseUUIDPipe) sessionId: string) {
    await this.auth.revokeSession(sessionId);
  }

  @Get('me')
  @Authenticated()
  me(@Headers('x-organization-id') organizationId?: string) {
    if (organizationId !== undefined && !isUuid(organizationId)) {
      throw new AppException('ORGANIZATION_NOT_FOUND', 404, 'Resource not found');
    }
    return this.auth.me(organizationId);
  }
}
