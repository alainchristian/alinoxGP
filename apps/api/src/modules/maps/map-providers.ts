import type { MapConfigDto } from '@gps/shared';
import type { Env } from '../../infrastructure/config/env';
import type { MapProviderPort } from './map-provider.port';

/**
 * DEVELOPMENT map: OpenStreetMap raster tiles. OSM's tile usage policy allows only light use and forbids production use,
 * so this adapter labels itself `devOnly`, the UI says so, and the environment validation refuses it in production.
 */
export class DevOsmMapProvider implements MapProviderPort {
  constructor(private readonly env: Pick<Env, 'MAP_DEV_TILE_URL'>) {}

  config(): MapConfigDto {
    return {
      provider: 'dev-osm',
      devOnly: true,
      attribution: '© OpenStreetMap contributors',
      tiles: [this.env.MAP_DEV_TILE_URL],
      tileSize: 256,
      maxZoom: 19,
      styles: { streets: null, satellite: null },
      accessToken: null,
      notice: 'Development map (OpenStreetMap tiles). Not for production; satellite imagery needs the Mapbox provider.',
    };
  }
}

/** PRODUCTION map: Mapbox GL JS with Mapbox styles. Only a PUBLIC token is ever handed to a browser (checked at start-up). */
export class MapboxMapProvider implements MapProviderPort {
  constructor(private readonly env: Pick<Env, 'MAPBOX_PUBLIC_TOKEN'>) {}

  config(): MapConfigDto {
    return {
      provider: 'mapbox',
      devOnly: false,
      attribution: '© Mapbox © OpenStreetMap',
      tiles: null,
      tileSize: 512,
      maxZoom: 22,
      styles: { streets: 'mapbox://styles/mapbox/streets-v12', satellite: 'mapbox://styles/mapbox/satellite-streets-v12' },
      accessToken: this.env.MAPBOX_PUBLIC_TOKEN ?? null,
      notice: null,
    };
  }
}
