import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import { ENV, type Env } from './infrastructure/config/env';

export const API_PREFIX = 'api/v1';

/** Shared by main.ts and the e2e tests so tests exercise the real HTTP configuration. */
export function configureApp(app: INestApplication) {
  const env = app.get<Env>(ENV);
  const express = app as NestExpressApplication;
  express.set('trust proxy', env.TRUST_PROXY);
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix(API_PREFIX);
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({
    origin: env.APP_BASE_URL,
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Organization-Id', 'X-Requested-With', 'Idempotency-Key', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id'],
  });

  const swaggerEnabled = env.SWAGGER_ENABLED ?? env.NODE_ENV !== 'production';
  if (swaggerEnabled) {
    const config = new DocumentBuilder()
      .setTitle('GPS Platform API')
      .setDescription('Fleet tracking platform. Errors are RFC 9457 problem details with a stable `code`.')
      .setVersion('1.0')
      .addBearerAuth()
      .addApiKey({ type: 'apiKey', name: 'X-Organization-Id', in: 'header' }, 'organization')
      .build();
    SwaggerModule.setup('api/docs', app, cleanupOpenApiDoc(SwaggerModule.createDocument(app, config)));
  }
  return app;
}
