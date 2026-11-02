import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ENV, type Env } from '../../infrastructure/config/env';
import { AccessControlModule } from '../access-control/access-control.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard, StepUpGuard } from './jwt-auth.guard';
import { SessionService } from './session.service';
import { TotpService } from './totp.service';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        secret: env.JWT_ACCESS_SECRET,
        signOptions: { algorithm: 'HS256', expiresIn: env.ACCESS_TOKEN_TTL_SECONDS },
      }),
    }),
    UsersModule,
    AccessControlModule,
    OrganizationsModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, SessionService, TotpService, JwtAuthGuard, StepUpGuard],
  exports: [JwtModule, SessionService, JwtAuthGuard, StepUpGuard],
})
export class AuthModule {}
