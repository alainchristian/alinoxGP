import { Module } from '@nestjs/common';
import { ENV, type Env } from '../../infrastructure/config/env';
import { MAP_PROVIDER } from './map-provider.port';
import { DevOsmMapProvider, MapboxMapProvider } from './map-providers';
import { MapsController } from './maps.controller';

@Module({
  controllers: [MapsController],
  providers: [{ provide: MAP_PROVIDER, inject: [ENV], useFactory: (env: Env) => (env.MAP_PROVIDER === 'mapbox' ? new MapboxMapProvider(env) : new DevOsmMapProvider(env)) }],
  exports: [MAP_PROVIDER],
})
export class MapsModule {}
