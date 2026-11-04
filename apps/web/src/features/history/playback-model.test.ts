import { describe, expect, it } from 'vitest';
import { PLAYBACK_SPEEDS, advance, boundsOf, dayRange, formatDuration, segments, startOfDayIn, stateAt, travelled, type PlayPoint } from './playback-model';

const pt = (t: number, lon: number, speed: number | null = 30): PlayPoint => ({ t, latitude: -1.9, longitude: lon, speedKmh: speed, heading: 90, ignition: true });
const line = [pt(0, 30.0), pt(10_000, 30.1), pt(30_000, 30.3, null)];

describe('stateAt', () => {
  it('interpolates between neighbouring fixes and clamps outside the route', () => {
    expect(stateAt(line, 5_000)).toMatchObject({ longitude: 30.05, index: 0 });
    expect(stateAt(line, 20_000)!.longitude).toBeCloseTo(30.2, 6);
    expect(stateAt(line, -5)).toMatchObject({ longitude: 30.0, index: 0 });
    expect(stateAt(line, 99_999)).toMatchObject({ longitude: 30.3, index: 2 });
    expect(stateAt([], 0)).toBeNull();
  });

  it('keeps an unknown speed unknown instead of inventing a number', () => {
    expect(stateAt(line, 5_000)!.speedKmh).toBe(30);
    expect(stateAt(line, 20_000)!.speedKmh).toBeNull(); // one neighbour did not report speed
  });

  it('handles fixes with the same timestamp without dividing by zero', () => {
    const s = stateAt([pt(0, 30.0), pt(0, 30.5), pt(10, 31)], 0);
    expect(Number.isFinite(s!.longitude)).toBe(true);
  });
});

describe('playback clock', () => {
  it('runs at the chosen speed and stops at the end', () => {
    expect(PLAYBACK_SPEEDS).toEqual([1, 2, 4, 8, 16]);
    expect(advance(1000, 500, 1, 10_000)).toEqual({ t: 1500, finished: false });
    expect(advance(1000, 500, 16, 10_000)).toEqual({ t: 9000, finished: false });
    expect(advance(9000, 500, 16, 10_000)).toEqual({ t: 10_000, finished: true });
  });
});

describe('route drawing helpers', () => {
  it('draws the travelled part up to the current position', () => {
    expect(travelled(line, 5_000)).toEqual([[30.0, -1.9], [30.05, -1.9]].map((p) => [p[0]!, p[1]!]).map((p, i) => (i === 1 ? [expect.closeTo(30.05, 6), -1.9] : p)));
    expect(travelled([], 0)).toEqual([]);
  });

  it('splits the line where the vehicle was not tracked, never joining across the gap', () => {
    const s = segments([1, 2, 3, 4, 5], [1, 3]);
    expect(s).toEqual([[1, 2], [3, 4], [5]]);
    expect(segments([1, 2, 3], [])).toEqual([[1, 2, 3]]);
    expect(segments([], [])).toEqual([]);
  });

  it('frames the route', () => {
    expect(boundsOf(line)).toEqual([[30.0, -1.9], [30.3, -1.9]]);
    expect(boundsOf([])).toBeNull();
  });

  it('writes durations the way people read them', () => {
    expect(formatDuration(45)).toBe('45 s');
    expect(formatDuration(125)).toBe('2 min 05 s');
    expect(formatDuration(3_900)).toBe('1 h 05 min');
  });
});

describe('date range in the organization time zone', () => {
  it('starts a day at local midnight (Kigali is UTC+2, no daylight saving)', () => {
    expect(startOfDayIn('2026-11-04', 'Africa/Kigali').toISOString()).toBe('2026-11-03T22:00:00.000Z');
    expect(startOfDayIn('2026-11-04', 'UTC').toISOString()).toBe('2026-11-04T00:00:00.000Z');
    expect(startOfDayIn('2026-07-01', 'America/New_York').toISOString()).toBe('2026-07-01T04:00:00.000Z'); // daylight time
  });

  it('covers whole days inclusive, never past now', () => {
    const now = new Date('2026-11-04T10:00:00Z');
    const past = dayRange('2026-11-01', '2026-11-02', 'Africa/Kigali', 7, now);
    expect(past).toEqual({ ok: true, from: '2026-10-31T22:00:00.000Z', to: '2026-11-02T22:00:00.000Z', days: 2 });
    const today = dayRange('2026-11-04', '2026-11-04', 'Africa/Kigali', 7, now);
    expect(today).toMatchObject({ ok: true, to: now.toISOString() });
  });

  it('refuses a long, inverted, incomplete or future range with a plain message', () => {
    const now = new Date('2026-11-04T10:00:00Z');
    expect(dayRange('2026-10-20', '2026-11-04', 'UTC', 7, now)).toEqual({ ok: false, error: 'Choose at most 7 days at a time' });
    expect(dayRange('2026-11-04', '2026-11-01', 'UTC', 7, now)).toMatchObject({ ok: false });
    expect(dayRange('', '2026-11-01', 'UTC', 7, now)).toMatchObject({ ok: false, error: 'Choose both dates' });
    expect(dayRange('2026-11-06', '2026-11-06', 'UTC', 7, now)).toEqual({ ok: false, error: 'That period has not started yet' });
    expect(dayRange('2026-11-04', '2026-11-04', 'UTC', 7, now)).toMatchObject({ ok: true });
  });
});
