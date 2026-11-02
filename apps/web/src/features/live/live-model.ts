import type { AlertDto, MapConfigDto, VehicleStatus } from '@gps/shared';
import type { RowMap, VehicleRow } from '../monitor/monitor-model';

/**
 * Pure logic of the live tracking page (no React, no map library), so it is testable without a browser.
 * Rule: a vehicle with no usable position is NOT drawn (and is never drawn at 0,0); it still appears in the list.
 */

// ---------------------------------------------------------------- map features

export interface VehicleFeatureProps {
  id: string;
  reg: string;
  status: VehicleStatus;
  /** Degrees clockwise from north; 0 when unknown (then `hasHeading` is false and the marker is not rotated). */
  heading: number;
  hasHeading: boolean;
  simulated: boolean;
  /** An unacknowledged alert from the last few minutes: drawn as a red ring on top of the status marker. */
  alert: boolean;
  /** Not heard from for longer than the offline threshold (drawn dimmed). */
  stale: boolean;
}

export interface PointFeature {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: VehicleFeatureProps;
}
export interface FeatureCollection {
  type: 'FeatureCollection';
  features: PointFeature[];
}

export function hasPosition(r: VehicleRow): r is VehicleRow & { latitude: number; longitude: number } {
  return r.latitude !== null && r.longitude !== null && Math.abs(r.latitude) <= 90 && Math.abs(r.longitude) <= 180;
}

export function toFeature(r: VehicleRow, alertIds: ReadonlySet<string>): PointFeature | null {
  if (!hasPosition(r)) return null;
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [r.longitude, r.latitude] }, // GeoJSON is lon, lat
    properties: {
      id: r.vehicleId,
      reg: r.registrationNumber,
      status: r.status,
      heading: r.heading ?? 0,
      hasHeading: r.heading !== null,
      simulated: r.simulated,
      alert: alertIds.has(r.vehicleId),
      stale: r.status === 'OFFLINE',
    },
  };
}

/**
 * Every drawable vehicle as GeoJSON, except `excludeId`: the SELECTED vehicle is drawn on its own layer, on top, so it is
 * never hidden inside a cluster (and is not counted in one).
 */
export function toFeatureCollection(rows: RowMap, alertIds: ReadonlySet<string>, excludeId: string | null = null): FeatureCollection {
  const features: PointFeature[] = [];
  for (const r of rows.values()) {
    if (r.vehicleId === excludeId) continue;
    const f = toFeature(r, alertIds);
    if (f) features.push(f);
  }
  return { type: 'FeatureCollection', features };
}

export type Bounds = [[number, number], [number, number]];

/** South-west / north-east corner of every drawable vehicle, or null when there is nothing to frame. */
export function boundsOf(rows: Iterable<VehicleRow>): Bounds | null {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const r of rows) {
    if (!hasPosition(r)) continue;
    minLon = Math.min(minLon, r.longitude);
    maxLon = Math.max(maxLon, r.longitude);
    minLat = Math.min(minLat, r.latitude);
    maxLat = Math.max(maxLat, r.latitude);
  }
  return Number.isFinite(minLon) ? [[minLon, minLat], [maxLon, maxLat]] : null;
}

// ---------------------------------------------------------------- trail of the selected vehicle

export type TrailPoint = [number, number];
export const TRAIL_MAX_POINTS = 150;
/** A new point closer than this to the previous one adds nothing visible (GPS noise while stopped). */
const TRAIL_MIN_STEP_M = 3;

const toRad = (d: number) => (d * Math.PI) / 180;
export function distanceM(a: TrailPoint, b: TrailPoint): number {
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

/** Appends a position to a vehicle's trail (immutable), skipping duplicates and sub-noise steps; bounded. */
export function extendTrail(trail: readonly TrailPoint[] | undefined, lat: number | null, lon: number | null): readonly TrailPoint[] {
  const base = trail ?? [];
  if (lat === null || lon === null) return base;
  const point: TrailPoint = [lon, lat];
  const last = base[base.length - 1];
  if (last && distanceM(last, point) < TRAIL_MIN_STEP_M) return base;
  return [...base, point].slice(-TRAIL_MAX_POINTS);
}

// ---------------------------------------------------------------- alert overlay

/** How long an unacknowledged alert keeps its red ring. */
export const ALERT_RING_WINDOW_SEC = 15 * 60;

/** Vehicles with an unacknowledged alert raised within the window. (A full `alertActive` field with clear semantics is M8.) */
export function vehiclesWithRecentAlert(alerts: readonly AlertDto[], now: number, windowSec = ALERT_RING_WINDOW_SEC): Set<string> {
  const out = new Set<string>();
  for (const a of alerts) if (a.acknowledgedAt === null && now - Date.parse(a.startedAt) <= windowSec * 1000) out.add(a.vehicleId);
  return out;
}

// ---------------------------------------------------------------- labels

const POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
export function headingLabel(deg: number | null): string {
  if (deg === null) return '—';
  const normalized = ((deg % 360) + 360) % 360;
  return `${Math.round(normalized)}° ${POINTS[Math.round(normalized / 45) % 8]}`;
}

/** Whether this build can draw the configured provider (the Mapbox renderer is added when a token exists — OQ-012). */
export function canDrawProvider(config: Pick<MapConfigDto, 'provider'>): boolean {
  return config.provider === 'dev-osm';
}

/** MapLibre style for the development provider: a single raster layer of the configured tiles. */
export function devStyle(config: MapConfigDto) {
  return {
    version: 8 as const,
    sources: {
      base: { type: 'raster' as const, tiles: config.tiles ?? [], tileSize: config.tileSize, maxzoom: config.maxZoom, attribution: config.attribution },
    },
    layers: [{ id: 'base', type: 'raster' as const, source: 'base' }],
  };
}
