import { describe, expect, it } from 'vitest';
import type { AlertDto, LiveLocationDto, MapConfigDto } from '@gps/shared';
import {
  ALERT_RING_WINDOW_SEC,
  TRAIL_MAX_POINTS,
  boundsOf,
  canDrawProvider,
  devStyle,
  distanceM,
  extendTrail,
  hasPosition,
  headingLabel,
  toFeature,
  toFeatureCollection,
  vehiclesWithRecentAlert,
} from './live-model';

const NOW = Date.parse('2026-11-02T10:00:00Z');
const iso = (secAgo: number) => new Date(NOW - secAgo * 1000).toISOString();
const row = (id: string, over: Partial<LiveLocationDto> = {}): LiveLocationDto => ({
  vehicleId: id, registrationNumber: `RW-${id}`, deviceId: `d-${id}`, status: 'MOVING', latitude: -1.94, longitude: 30.06, speedKmh: 40, heading: 90, ignition: true,
  lastFixAt: iso(1), lastSeenAt: iso(1), lastFixInvalid: false, lastFixDelayed: false, simulated: true, ...over,
});
const rows = (...rs: LiveLocationDto[]) => new Map(rs.map((r) => [r.vehicleId, r]));
const alert = (vehicleId: string, over: Partial<AlertDto> = {}): AlertDto => ({
  id: `a-${vehicleId}`, vehicleId, registrationNumber: `RW-${vehicleId}`, type: 'OVERSPEED', severity: 'WARNING', startedAt: iso(30), simulated: true, delayed: false, acknowledgedAt: null, latitude: null, longitude: null, ...over,
});

describe('map features', () => {
  it('puts longitude first (GeoJSON order) and carries what the layers need', () => {
    const f = toFeature(row('1', { latitude: -1.9441, longitude: 30.0619, heading: 135 }), new Set(['1']))!;
    expect(f.geometry.coordinates).toEqual([30.0619, -1.9441]);
    expect(f.properties).toMatchObject({ id: '1', reg: 'RW-1', status: 'MOVING', heading: 135, hasHeading: true, simulated: true, alert: true, stale: false });
  });

  it('never draws a vehicle without a usable position — and never at 0,0', () => {
    expect(toFeature(row('1', { latitude: null, longitude: null }), new Set())).toBeNull();
    expect(toFeature(row('1', { latitude: -1.9, longitude: null }), new Set())).toBeNull();
    expect(toFeature(row('1', { latitude: 95, longitude: 30 }), new Set())).toBeNull(); // out of range
    expect(hasPosition(row('1', { latitude: 0, longitude: 0 }))).toBe(true); // a real place on the equator is not "unknown"
    expect(toFeatureCollection(rows(row('1'), row('2', { latitude: null, longitude: null })), new Set()).features.map((f) => f.properties.id)).toEqual(['1']);
  });

  it('leaves the selected vehicle out of the clustered set: it is drawn on its own layer, never hidden in (or counted by) a cluster', () => {
    const fc = toFeatureCollection(rows(row('1'), row('2'), row('3')), new Set(), '2');
    expect(fc.features.map((f) => f.properties.id)).toEqual(['1', '3']);
    expect(toFeatureCollection(rows(row('1')), new Set(), 'unknown').features).toHaveLength(1);
  });

  it('an unknown heading is flagged so the marker is not rotated to a made-up direction', () => {
    expect(toFeature(row('1', { heading: null }), new Set())!.properties).toMatchObject({ heading: 0, hasHeading: false });
  });

  it('marks offline vehicles stale and only the alerted ones with the alert ring', () => {
    const fc = toFeatureCollection(rows(row('1', { status: 'OFFLINE' }), row('2')), new Set(['2']));
    const by = Object.fromEntries(fc.features.map((f) => [f.properties.id, f.properties]));
    expect([by['1']?.stale, by['1']?.alert, by['2']?.stale, by['2']?.alert]).toEqual([true, false, false, true]);
  });
});

describe('boundsOf', () => {
  it('frames every drawable vehicle and ignores those without a position', () => {
    const b = boundsOf(rows(row('1', { latitude: -1.9, longitude: 30.0 }), row('2', { latitude: -2.0, longitude: 30.2 }), row('3', { latitude: null, longitude: null })).values());
    expect(b).toEqual([[30.0, -2.0], [30.2, -1.9]]);
  });
  it('is null when there is nothing to frame', () => {
    expect(boundsOf([])).toBeNull();
    expect(boundsOf(rows(row('1', { latitude: null, longitude: null })).values())).toBeNull();
  });
});

describe('trail', () => {
  it('appends moving positions, in order', () => {
    let t = extendTrail(undefined, -1.9, 30.0);
    t = extendTrail(t, -1.9005, 30.0005);
    expect(t).toEqual([[30.0, -1.9], [30.0005, -1.9005]]);
  });
  it('skips an unknown position, a duplicate, and GPS jitter of a stopped vehicle', () => {
    let t = extendTrail(undefined, -1.9, 30.0);
    t = extendTrail(t, null, null);
    t = extendTrail(t, -1.9, 30.0);
    t = extendTrail(t, -1.90001, 30.00001); // ~1.5 m
    expect(t).toHaveLength(1);
  });
  it('is bounded and never mutates the trail it was given', () => {
    let t: readonly [number, number][] = [];
    for (let i = 0; i < TRAIL_MAX_POINTS + 25; i++) t = extendTrail(t, -1.9 - i * 0.001, 30.0);
    expect(t).toHaveLength(TRAIL_MAX_POINTS);
    const before = t;
    extendTrail(t, -5, 31);
    expect(t).toBe(before);
  });
  it('measures distance in metres', () => {
    expect(Math.round(distanceM([30.0, -1.9], [30.0, -1.91]))).toBeCloseTo(1112, -1); // 0.01° of latitude ≈ 1.11 km
  });
});

describe('alert overlay', () => {
  it('rings only vehicles with an unacknowledged alert inside the window', () => {
    const set = vehiclesWithRecentAlert(
      [alert('1'), alert('2', { acknowledgedAt: iso(5) }), alert('3', { startedAt: iso(ALERT_RING_WINDOW_SEC + 60) }), alert('4', { startedAt: iso(ALERT_RING_WINDOW_SEC - 10) })],
      NOW,
    );
    expect([...set].sort()).toEqual(['1', '4']);
  });
});

describe('labels and provider', () => {
  it.each([
    [null, '—'],
    [0, '0° N'],
    [90, '90° E'],
    [200, '200° S'],
    [359, '359° N'],
    [-90, '270° W'],
    [450, '90° E'],
  ])('heading %s -> %s', (deg, label) => expect(headingLabel(deg)).toBe(label));

  const dev: MapConfigDto = { provider: 'dev-osm', devOnly: true, attribution: '© OpenStreetMap contributors', tiles: ['https://t/{z}/{x}/{y}.png'], tileSize: 256, maxZoom: 19, styles: { streets: null, satellite: null }, accessToken: null, notice: null };
  it('draws only the provider this build supports, and says so otherwise', () => {
    expect(canDrawProvider(dev)).toBe(true);
    expect(canDrawProvider({ provider: 'mapbox' })).toBe(false);
  });
  it('builds a single raster layer from the server-described tiles, with attribution', () => {
    const s = devStyle(dev);
    expect(s.sources.base).toMatchObject({ type: 'raster', tiles: ['https://t/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© OpenStreetMap contributors' });
    expect(s.layers).toEqual([{ id: 'base', type: 'raster', source: 'base' }]);
  });
});
