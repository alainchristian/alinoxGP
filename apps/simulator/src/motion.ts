/** Simple, deterministic motion along a polyline. Full scenario support (stops, drift, delays, ...) arrives in M3. */
export type LonLat = readonly [longitude: number, latitude: number];

export interface SimPoint {
  latitude: number;
  longitude: number;
  speedKmh: number;
  heading: number;
  /** Device clock for this sample, epoch ms. */
  time: number;
  ignition: boolean;
}

const R = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

export function haversineM(a: LonLat, b: LonLat): number {
  const dLat = rad(b[1] - a[1]);
  const dLon = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function bearingDeg(a: LonLat, b: LonLat): number {
  const y = Math.sin(rad(b[0] - a[0])) * Math.cos(rad(b[1]));
  const x = Math.cos(rad(a[1])) * Math.sin(rad(b[1])) - Math.sin(rad(a[1])) * Math.cos(rad(b[1])) * Math.cos(rad(b[0] - a[0]));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

/** Small seedable PRNG (mulberry32) so every run is reproducible. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface DriveOptions {
  route: readonly LonLat[];
  /** Cruising speed in km/h. */
  speedKmh: number;
  intervalSec: number;
  seed: number;
  /** Device clock of the first sample, epoch ms. */
  startTime: number;
  /** GPS noise amplitude in metres (default 3). */
  noiseM?: number;
  /** Go round the route repeatedly (default true; the route should be a closed loop). */
  loop?: boolean;
  /** Start this many metres along the route instead of at its first point (wraps around a closed loop). Spreads a fleet out. */
  startOffsetM?: number;
}

/** Length of the route in metres (closed back to its first point when `loop`). */
export function routeLengthM(route: readonly LonLat[], loop = true): number {
  let total = 0;
  for (let i = 0; i + 1 < route.length; i++) total += haversineM(route[i]!, route[i + 1]!);
  if (loop && route.length > 1) total += haversineM(route[route.length - 1]!, route[0]!);
  return total;
}

/** Positions of a vehicle driving along `route`, one per `intervalSec`. Never yields (0,0) or invalid coordinates. */
export function* drive(opts: DriveOptions): Generator<SimPoint> {
  const { route, speedKmh, intervalSec, seed, startTime, noiseM = 3, loop = true, startOffsetM = 0 } = opts;
  if (route.length < 2) throw new Error('A route needs at least two points');
  const rand = rng(seed);
  const stepM = (speedKmh / 3.6) * intervalSec;
  let segment = 0;
  let along = 0; // metres travelled along the current segment
  let t = startTime;

  // Begin partway round the route (a fleet that all starts at the same point looks like a convoy, not a fleet).
  const total = routeLengthM(route, loop);
  let remaining = total > 0 ? Math.max(0, startOffsetM) % total : 0;
  for (let guard = 0; guard <= route.length; guard++) {
    const len = haversineM(route[segment]!, route[(segment + 1) % route.length]!);
    if (remaining < len || (!loop && segment >= route.length - 2)) break;
    remaining -= len;
    segment = (segment + 1) % route.length;
  }
  along = remaining;

  for (;;) {
    const a = route[segment]!;
    const b = route[(segment + 1) % route.length]!;
    const len = haversineM(a, b);
    const f = len === 0 ? 0 : Math.min(1, along / len);
    const lon = a[0] + (b[0] - a[0]) * f;
    const lat = a[1] + (b[1] - a[1]) * f;
    const noiseLat = ((rand() - 0.5) * 2 * noiseM) / 111_320;
    const noiseLon = ((rand() - 0.5) * 2 * noiseM) / (111_320 * Math.cos(rad(lat)));
    yield {
      latitude: Number((lat + noiseLat).toFixed(6)),
      longitude: Number((lon + noiseLon).toFixed(6)),
      speedKmh: Math.max(0, Number((speedKmh + (rand() - 0.5) * 2).toFixed(1))),
      heading: Math.round(bearingDeg(a, b)),
      time: t,
      ignition: true,
    };
    t += intervalSec * 1000;
    along += stepM;
    while (along >= haversineM(route[segment]!, route[(segment + 1) % route.length]!)) {
      along -= haversineM(route[segment]!, route[(segment + 1) % route.length]!);
      segment++;
      if (segment >= route.length - (loop ? 0 : 1)) {
        if (!loop) return;
        segment = 0;
      }
    }
  }
}
