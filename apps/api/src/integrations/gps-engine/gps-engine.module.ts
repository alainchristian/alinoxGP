import { Global, Module } from '@nestjs/common';
import { ENV, type Env } from '../../infrastructure/config/env';
import { FakeEngineAdapter } from './fake/fake-engine.adapter';
import { GPS_ENGINE } from './port';
import { TraccarAdapter } from './traccar/traccar.adapter';
import { TraccarClient } from './traccar/traccar.client';

/** Binds the `GpsEnginePort` to the configured implementation (Traccar by default). */
@Global()
@Module({
  providers: [
    TraccarClient,
    TraccarAdapter,
    FakeEngineAdapter,
    {
      provide: GPS_ENGINE,
      inject: [ENV, TraccarAdapter, FakeEngineAdapter],
      useFactory: (env: Env, traccar: TraccarAdapter, fake: FakeEngineAdapter) => (env.GPS_ENGINE === 'fake' ? fake : traccar),
    },
  ],
  exports: [GPS_ENGINE, FakeEngineAdapter],
})
export class GpsEngineModule {}
