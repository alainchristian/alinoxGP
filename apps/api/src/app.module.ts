import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ClsModule } from 'nestjs-cls';
import { LoggerModule } from 'nestjs-pino';
import { ZodValidationPipe } from 'nestjs-zod';
import type { IncomingMessage } from 'node:http';
import { ProblemDetailsFilter } from './common/problem.filter';
import { EnvelopeInterceptor } from './common/response';
import { DEFAULT_LIMIT, THROTTLE_TTL_MS } from './common/throttle';
import { ConfigModule } from './infrastructure/config/config.module';
import { GpsEngineModule } from './integrations/gps-engine/gps-engine.module';
import { ENV, type Env } from './infrastructure/config/env';
import { PrismaModule } from './infrastructure/prisma/prisma.module';
import { RedisModule } from './infrastructure/redis/redis.module';
import { AccessControlModule } from './modules/access-control/access-control.module';
import { PermissionsGuard } from './modules/access-control/permissions.guard';
import { TenantContextGuard } from './modules/access-control/tenant-context.guard';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { JwtAuthGuard, StepUpGuard } from './modules/auth/jwt-auth.guard';
import { DevicesModule } from './modules/devices/devices.module';
import { EngineAdminModule } from './modules/engine-admin/engine-admin.module';
import { AlertsModule } from './modules/alerts/alerts.module';
import { HealthController } from './modules/health/health.controller';
import { LiveStateModule } from './modules/live-state/live-state.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { MessagingModule } from './modules/messaging/messaging.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { ProvidersModule } from './modules/providers/providers.module';
import { MapsModule } from './modules/maps/maps.module';
import { TrackingModule } from './modules/tracking/tracking.module';
import { UsersModule } from './modules/users/users.module';
import { VehiclesModule } from './modules/vehicles/vehicles.module';
import { VehicleCategoriesModule } from './modules/vehicle-categories/vehicle-categories.module';
import { DriversModule } from './modules/drivers/drivers.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { CatalogueModule } from './modules/catalogue/catalogue.module';
import { ConsentModule } from './modules/consent/consent.module';
import { DeviceAdminModule } from './modules/device-admin/device-admin.module';
import { DeviceSupportModule } from './modules/device-support/device-support.module';

@Module({
  imports: [
    ConfigModule,
    ClsModule.forRoot({
      global: true,
      middleware: {
        mount: true,
        generateId: true,
        idGenerator: (req: IncomingMessage) => {
          const incoming = req.headers['x-request-id'];
          return typeof incoming === 'string' && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
        },
        setup: (cls, req: IncomingMessage & { ip?: string }) => {
          cls.set('requestId', cls.getId());
          cls.set('ip', req.ip ?? req.socket.remoteAddress);
          cls.set('userAgent', req.headers['user-agent']);
        },
      },
    }),
    LoggerModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        pinoHttp: {
          level: env.LOG_LEVEL,
          // Never log credentials or tokens (spec §13). Request bodies are not logged at all.
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers.cookie',
              'res.headers["set-cookie"]',
              'req.headers["x-organization-id"]',
            ],
            censor: '[redacted]',
          },
          genReqId: (req: IncomingMessage) => {
            const incoming = req.headers['x-request-id'];
            return typeof incoming === 'string' && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
          },
          autoLogging: { ignore: (req: IncomingMessage) => (req.url ?? '').startsWith('/api/v1/health') },
          serializers: {
            req: (req: { id: string; method: string; url: string }) => ({ id: req.id, method: req.method, url: req.url.split('?')[0] }),
            res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
          },
          ...(env.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty', options: { singleLine: true } } } : {}),
        },
      }),
    }),
    // In-memory counters per process. Switch to Redis-backed storage when running multiple API instances (M10).
    ThrottlerModule.forRoot({ throttlers: [{ name: 'default', ttl: THROTTLE_TTL_MS, limit: DEFAULT_LIMIT }] }),
    PrismaModule,
    RedisModule,
    AuditModule,
    MessagingModule,
    GpsEngineModule,
    LiveStateModule,
    UsersModule,
    AccessControlModule,
    OrganizationsModule,
    ProvidersModule,
    AuthModule,
    VehiclesModule,
    VehicleCategoriesModule,
    DriversModule,
    DashboardModule,
    CatalogueModule,
    ConsentModule,
    DeviceSupportModule,
    DeviceAdminModule,
    DevicesModule,
    RealtimeModule,
    AlertsModule,
    TrackingModule,
    MapsModule,
    EngineAdminModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
    { provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor },
    // Guard order matters (gps-api-conventions §2): throttle -> authenticate -> tenant -> permission -> step-up.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: TenantContextGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_GUARD, useClass: StepUpGuard },
  ],
})
export class AppModule {}
