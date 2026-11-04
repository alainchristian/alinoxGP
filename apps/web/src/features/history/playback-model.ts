import type { RoutePointDto } from '@gps/shared';

/** Pure model of route playback and of the date range pickers (unit-tested; no React or map code here). */

export interface PlayPoint {
  /** Epoch ms. */
  t: number;
  latitude: number;
  longitude: number;
  speedKmh: number | null;
  heading: number | null;
  ignition: boolean | null;
}

/** Speeds offered by the spec: 1×, 2×, 4×, 8×, 16×. 1× is real time. */
export const PLAYBACK_SPEEDS = [1, 2, 4, 8, 16] as const;
export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];

export const toPlayPoints = (route: readonly RoutePointDto[]): PlayPoint[] =>
  route.map((p) => ({ t: Date.parse(p.t), latitude: p.latitude, longitude: p.longitude, speedKmh: p.speedKmh, heading: p.heading, ignition: p.ignition }));

export interface PlayState {
  latitude: number;
  longitude: number;
  /** Interpolated between the two surrounding fixes. null when either fix did not report speed: unknown is not 0. */
  speedKmh: number | null;
  heading: number | null;
  /** Index of the last fix at or before the time. */
  index: number;
}

/** Where the vehicle was at `t`: linear interpolation between the neighbouring fixes, clamped to the first and last. */
export function stateAt(points: readonly PlayPoint[], t: number): PlayState | null {
  if (points.length === 0) return null;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  if (t <= first.t) return { latitude: first.latitude, longitude: first.longitude, speedKmh: first.speedKmh, heading: first.heading, index: 0 };
  if (t >= last.t) return { latitude: last.latitude, longitude: last.longitude, speedKmh: last.speedKmh, heading: last.heading, index: points.length - 1 };
  // Binary search for the last point with p.t <= t.
  let lo = 0;
  let hi = points.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (points[mid]!.t <= t) lo = mid;
    else hi = mid - 1;
  }
  const a = points[lo]!;
  const b = points[lo + 1]!;
  const f = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
  const mix = (x: number | null, y: number | null) => (x === null || y === null ? null : x + (y - x) * f);
  return { latitude: a.latitude + (b.latitude - a.latitude) * f, longitude: a.longitude + (b.longitude - a.longitude) * f, speedKmh: mix(a.speedKmh, b.speedKmh), heading: a.heading, index: lo };
}

/** Advances the playback clock by `elapsedMs` of wall time at `speed`×; stops at the end. */
export function advance(t: number, elapsedMs: number, speed: PlaybackSpeed, end: number): { t: number; finished: boolean } {
  const next = t + elapsedMs * speed;
  return next >= end ? { t: end, finished: true } : { t: next, finished: false };
}

/** The part of the route driven up to `t` (for the "already travelled" line). */
export function travelled(points: readonly PlayPoint[], t: number): [number, number][] {
  const s = stateAt(points, t);
  if (!s) return [];
  const line = points.slice(0, s.index + 1).map((p): [number, number] => [p.longitude, p.latitude]);
  line.push([s.longitude, s.latitude]);
  return line;
}

/** Splits the line where the vehicle was not tracked (another tracker window began): the gap is never drawn as a straight line. */
export function segments<T>(points: readonly T[], breaks: readonly number[]): T[][] {
  const out: T[][] = [];
  let from = 0;
  for (const b of [...breaks].sort((x, y) => x - y)) {
    out.push(points.slice(from, b + 1));
    from = b + 1;
  }
  out.push(points.slice(from));
  return out.filter((s) => s.length > 0);
}

export function boundsOf(points: readonly { latitude: number; longitude: number }[]): [[number, number], [number, number]] | null {
  if (points.length === 0) return null;
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const p of points) {
    w = Math.min(w, p.longitude); e = Math.max(e, p.longitude); s = Math.min(s, p.latitude); n = Math.max(n, p.latitude);
  }
  return [[w, s], [e, n]];
}

export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h} h ${String(m).padStart(2, '0')} min`;
  if (m > 0) return `${m} min ${String(s % 60).padStart(2, '0')} s`;
  return `${s} s`;
}

// ---------------------------------------------------------------- date range in the organization's time zone

/** Offset (ms) of `timeZone` from UTC at the given instant. */
export function zoneOffsetMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** The instant at which calendar day `ymd` (YYYY-MM-DD) begins in `timeZone`. */
export function startOfDayIn(ymd: string, timeZone: string): Date {
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
  const guess = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  return new Date(guess.getTime() - zoneOffsetMs(guess, timeZone));
}

export const todayIn = (timeZone: string, now = new Date()): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);

export type RangeResult = { ok: true; from: string; to: string; days: number } | { ok: false; error: string };

/**
 * From the first day's start to the end of the last day (inclusive), in the organization's time zone, never past `now`.
 * A range longer than `maxDays` is refused here with a clear message (the API refuses it as well).
 */
export function dayRange(fromYmd: string, toYmd: string, timeZone: string, maxDays: number, now = new Date()): RangeResult {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromYmd) || !/^\d{4}-\d{2}-\d{2}$/.test(toYmd)) return { ok: false, error: 'Choose both dates' };
  if (fromYmd > toYmd) return { ok: false, error: 'The first day must not be after the last day' };
  const from = startOfDayIn(fromYmd, timeZone);
  const nextDay = new Date(Date.UTC(Number(toYmd.slice(0, 4)), Number(toYmd.slice(5, 7)) - 1, Number(toYmd.slice(8, 10)) + 1));
  const endOfLast = startOfDayIn(nextDay.toISOString().slice(0, 10), timeZone);
  const to = endOfLast > now ? now : endOfLast;
  const days = Math.round((endOfLast.getTime() - from.getTime()) / 86_400_000);
  if (days > maxDays) return { ok: false, error: `Choose at most ${maxDays} days at a time` };
  if (from >= to) return { ok: false, error: 'That period has not started yet' };
  return { ok: true, from: from.toISOString(), to: to.toISOString(), days };
}
