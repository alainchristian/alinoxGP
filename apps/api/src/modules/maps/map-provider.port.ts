import type { MapConfigDto } from '@gps/shared';

/**
 * Where the map comes from (ADR-0008). Everything provider-specific — tile servers, style URLs, the public token — stays
 * behind this port, so the web app draws whatever the server describes and a provider can be replaced without touching it.
 * Geocoding joins this port in M6 (and stays lazy and un-persisted until OQ-012 is settled).
 */
export interface MapProviderPort {
  config(): MapConfigDto;
}

export const MAP_PROVIDER = Symbol('MAP_PROVIDER');
