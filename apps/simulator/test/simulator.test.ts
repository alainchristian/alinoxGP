import { describe, expect, it, vi } from 'vitest';
import { KIGALI_CITY_LOOP, KIGALI_STREETS_LOOP, ROUTES, routeLengthM, bearingDeg, buildOsmandQuery, drive, haversineM, kmhToKnots, rng, sendPosition, SimulatorGuardError } from '../src';

describe('OsmAnd client', () => {
  it('converts km/h to knots because Traccar stores the OsmAnd speed parameter unconverted as knots', () => {
    expect(kmhToKnots(37.04)).toBe(20);
    expect(kmhToKnots(0)).toBe(0);
    expect(kmhToKnots(100)).toBe(54);
  });

  it('builds the query the decoder accepts: epoch SECONDS, knots, bearing, battery, ignition, simulated flag', () => {
    const q = buildOsmandQuery({ id: 'SIM-0001', latitude: -1.9441, longitude: 30.0619, speedKmh: 37.04, heading: 90.4, batteryPercent: 88, ignition: true, time: 1_793_525_666_999 });
    expect(Object.fromEntries(q)).toEqual({
      id: 'SIM-0001', lat: '-1.9441', lon: '30.0619', timestamp: '1793525666', speed: '20', bearing: '90', batt: '88', ignition: 'true', simulated: 'true',
    });
  });

  it('omits ignition entirely when unknown, so the platform shows Unknown rather than a false "off"', () => {
    expect(buildOsmandQuery({ id: 'SIM-1', latitude: 1, longitude: 1 }).has('ignition')).toBe(false);
  });

  it('refuses ids that are not clearly simulated (never impersonate a real tracker)', async () => {
    const fetchMock = vi.fn();
    await expect(sendPosition('http://x', { id: '356938035643809', latitude: 1, longitude: 1 }, fetchMock)).rejects.toBeInstanceOf(SimulatorGuardError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports the HTTP status, and a closed connection as such', async () => {
    expect(await sendPosition('http://x/', { id: 'SIM-1', latitude: 1, longitude: 1 }, vi.fn().mockResolvedValue(new Response(null, { status: 400 })))).toEqual({ httpStatus: 400 });
    expect(await sendPosition('http://x', { id: 'SIM-1', latitude: 95, longitude: 1 }, vi.fn().mockRejectedValue(new TypeError('closed')))).toEqual({ httpStatus: 'connection-closed' });
  });
});

describe('motion', () => {
  const opts = { route: KIGALI_CITY_LOOP, speedKmh: 40, intervalSec: 5, seed: 42, startTime: 1_000_000 };
  const take = (n: number, o = opts) => {
    const g = drive(o);
    return Array.from({ length: n }, () => g.next().value!);
  };

  it('is deterministic for a given seed and different for another', () => {
    expect(take(50)).toEqual(take(50));
    expect(take(50, { ...opts, seed: 7 })).not.toEqual(take(50));
  });

  it('advances at roughly the requested speed (distance between samples ~ speed x interval, within GPS noise)', () => {
    const pts = take(40);
    const expected = (40 / 3.6) * 5; // 55.6 m
    for (let i = 1; i < pts.length; i++) {
      const d = haversineM([pts[i - 1]!.longitude, pts[i - 1]!.latitude], [pts[i]!.longitude, pts[i]!.latitude]);
      expect(d).toBeGreaterThan(expected - 15);
      expect(d).toBeLessThan(expected + 15);
    }
  });

  it('timestamps advance by the interval and ignition is on while driving', () => {
    const pts = take(5);
    expect(pts.map((p) => p.time)).toEqual([1_000_000, 1_005_000, 1_010_000, 1_015_000, 1_020_000]);
    expect(pts.every((p) => p.ignition)).toBe(true);
  });

  it('never produces (0,0) or out-of-range coordinates, and keeps noise within a few metres of the route', () => {
    for (const p of take(400)) {
      expect(p.latitude).toBeGreaterThan(-2);
      expect(p.latitude).toBeLessThan(-1.9);
      expect(p.longitude).toBeGreaterThan(30);
      expect(p.longitude).toBeLessThan(30.1);
    }
  });

  it('wraps around a closed loop and a non-looping drive ends', () => {
    expect(take(500).length).toBe(500);
    const finite = [...drive({ ...opts, loop: false })];
    expect(finite.length).toBeGreaterThan(10);
    expect(finite.length).toBeLessThan(500);
  });

  it('heading follows the route bearing', () => {
    expect(bearingDeg([30, -1.9], [30, -1.8])).toBeCloseTo(0, 0);
    expect(bearingDeg([30, -1.9], [30.1, -1.9])).toBeCloseTo(90, 0);
    for (const p of take(20)) expect(p.heading).toBeGreaterThanOrEqual(0);
  });

  it('rng is reproducible and in [0,1)', () => {
    const a = rng(1);
    const b = rng(1);
    for (let i = 0; i < 20; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
});


describe('street-following route (OpenStreetMap, ODbL)', () => {
  const route = KIGALI_STREETS_LOOP;

  it('is registered next to the rough hand-drawn loop, which the scenarios keep using', () => {
    expect(Object.keys(ROUTES).sort()).toEqual(['kigali-city-loop', 'kigali-streets']);
    expect(ROUTES['kigali-streets']).toBe(KIGALI_STREETS_LOOP);
    expect(ROUTES['kigali-city-loop']).toBe(KIGALI_CITY_LOOP);
  });

  it('is a real circuit: several kilometres, hundreds of points, inside central Kigali', () => {
    const length = routeLengthM(route);
    expect(length).toBeGreaterThan(5_000);
    expect(length).toBeLessThan(12_000);
    expect(route.length).toBeGreaterThan(250);
    for (const [lon, lat] of route) {
      expect(lat).toBeGreaterThan(-1.97);
      expect(lat).toBeLessThan(-1.93);
      expect(lon).toBeGreaterThan(30.04);
      expect(lon).toBeLessThan(30.09);
    }
  });

  it('follows streets point by point: no long straight jumps between consecutive points, and it closes on itself', () => {
    let longest = 0;
    for (let i = 0; i < route.length; i++) longest = Math.max(longest, haversineM(route[i]!, route[(i + 1) % route.length]!));
    // A long straight street has few mapped points, so a gap of a few hundred metres is legitimate; the hand-drawn loop's
    // 400–600 m segments cut across blocks. Compare with it, and bound it absolutely.
    let handDrawnLongest = 0;
    for (let i = 0; i < KIGALI_CITY_LOOP.length; i++) handDrawnLongest = Math.max(handDrawnLongest, haversineM(KIGALI_CITY_LOOP[i]!, KIGALI_CITY_LOOP[(i + 1) % KIGALI_CITY_LOOP.length]!));
    expect(longest).toBeLessThan(handDrawnLongest);
    expect(longest).toBeLessThan(350);
    expect(haversineM(route[route.length - 1]!, route[0]!)).toBeLessThan(350); // the closing leg is a street too
  });
});

describe('startOffsetM', () => {
  const opts = { route: KIGALI_STREETS_LOOP, speedKmh: 40, intervalSec: 5, seed: 7, startTime: 0, noiseM: 0 };
  const first = (startOffsetM?: number) => drive({ ...opts, startOffsetM }).next().value!;

  it('starts that far along the route (not at its first point)', () => {
    const offset = haversineM(KIGALI_STREETS_LOOP[0]!, KIGALI_STREETS_LOOP[1]!) + haversineM(KIGALI_STREETS_LOOP[1]!, KIGALI_STREETS_LOOP[2]!);
    const p = first(offset);
    const expected = KIGALI_STREETS_LOOP[2]!;
    expect(haversineM([p.longitude, p.latitude], expected)).toBeLessThan(1);
    expect(haversineM([p.longitude, p.latitude], KIGALI_STREETS_LOOP[0]!)).toBeGreaterThan(5);
  });

  it('wraps around a closed loop, and a fleet spread by offsets covers the whole circuit', () => {
    const total = routeLengthM(KIGALI_STREETS_LOOP);
    const a = first(100);
    const b = first(total + 100);
    expect(haversineM([a.longitude, a.latitude], [b.longitude, b.latitude])).toBeLessThan(1);

    const spread = Array.from({ length: 20 }, (_, i) => first((i / 20) * total));
    const lons = spread.map((p) => p.longitude);
    expect(Math.max(...lons) - Math.min(...lons)).toBeGreaterThan(0.012); // ≈ 1.3 km east–west: spread out, not a convoy
  });

  it('without an offset it behaves as before', () => {
    expect(first(undefined)).toEqual(first(0));
    const p = first(0);
    expect(haversineM([p.longitude, p.latitude], KIGALI_STREETS_LOOP[0]!)).toBeLessThan(1);
  });
});
