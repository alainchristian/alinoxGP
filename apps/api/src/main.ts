import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { ENV, type Env } from './infrastructure/config/env';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  configureApp(app);
  app.enableShutdownHooks();
  const env = app.get<Env>(ENV);
  await app.listen(env.PORT);
}

bootstrap().catch((err) => {
  // Configuration errors must stop the process with a readable message.
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
