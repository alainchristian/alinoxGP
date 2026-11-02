import { describe, expect, it } from 'vitest';
import { DEFAULT_STATUS_THRESHOLDS as T, deriveStatus, isStationaryFix, nextStatusDeadline, type StatusInput } from './status';

const NOW = new Date('2026-11-01T12:00:00Z');
const ago = (sec: number) => new Date(NOW.getTime() - sec * 1000);
const base: StatusInput = { everReported: true, lastSeenAt: ago(5), speedKmh: 0, motion: null, ignition: null, stationarySince: ago(0) };
const s = (over: Partial<StatusInput>, t = T) => deriveStatus({ ...base, ...over }, NOW, t);

describe('deriveStatus — every rule', () => {
  it('NO_DATA: never reported (or no lastSeenAt)', () => {
    expect(s({ everReported: false, lastSeenAt: null })).toBe('NO_DATA');
    expect(s({ everReported: true, lastSeenAt: null })).toBe('NO_DATA');
    expect(s({ everReported: false })).toBe('NO_DATA');
  });

  describe('OFFLINE boundary (default 600 s)', () => {
    it.each([[0, false], [599, false], [600, false], [601, true], [3600, true]])('silent for %i s -> offline=%s', (sec, offline) => {
      expect(s({ lastSeenAt: ago(sec), speedKmh: 50 }) === 'OFFLINE').toBe(offline);
    });
    it('offline wins over everything else, including a moving last fix', () => {
      expect(s({ lastSeenAt: ago(5000), speedKmh: 90, ignition: true })).toBe('OFFLINE');
    });
    it('NO_DATA wins over OFFLINE', () => {
      expect(s({ everReported: false, lastSeenAt: ago(99999) })).toBe('NO_DATA');
    });
  });

  describe('MOVING boundary (default 5 km/h)', () => {
    it.each([[4.9, false], [5, true], [5.1, true], [120, true]])('speed %f -> moving=%s', (speed, moving) => {
      expect(s({ speedKmh: speed }) === 'MOVING').toBe(moving);
    });
    it('a motion flag of false vetoes MOVING (GPS jitter at standstill); true or unknown does not', () => {
      expect(s({ speedKmh: 8, motion: false })).not.toBe('MOVING');
      expect(s({ speedKmh: 8, motion: true })).toBe('MOVING');
      expect(s({ speedKmh: 8, motion: null })).toBe('MOVING');
    });
    it('unknown speed is never MOVING', () => {
      expect(s({ speedKmh: null, motion: true })).not.toBe('MOVING');
    });
    it('moving wins over ignition false (e.g. towed) and over a stale stationarySince', () => {
      expect(s({ speedKmh: 30, ignition: false, stationarySince: ago(9999) })).toBe('MOVING');
    });
  });

  describe('ignition ON, stationary: STATIONARY until 180 s, then IDLING', () => {
    it.each([[0, 'STATIONARY'], [179, 'STATIONARY'], [180, 'IDLING'], [900, 'IDLING']])('stationary %i s -> %s', (sec, expected) => {
      expect(s({ ignition: true, stationarySince: ago(sec) })).toBe(expected);
    });
  });

  describe('ignition OFF: PARKED regardless of how long it has been stopped', () => {
    it.each([[0], [10], [10_000]])('stationary %i s -> PARKED', (sec) => {
      expect(s({ ignition: false, stationarySince: ago(sec) })).toBe('PARKED');
    });
  });

  describe('ignition UNKNOWN: STATIONARY until 300 s, then PARKED (never IDLING)', () => {
    it.each([[0, 'STATIONARY'], [299, 'STATIONARY'], [300, 'PARKED'], [5000, 'PARKED']])('stationary %i s -> %s', (sec, expected) => {
      expect(s({ ignition: null, stationarySince: ago(sec) })).toBe(expected);
    });
  });

  it('a missing stationarySince counts as "just stopped", not as a long stop', () => {
    expect(s({ ignition: true, stationarySince: null })).toBe('STATIONARY');
    expect(s({ ignition: null, stationarySince: null })).toBe('STATIONARY');
  });

  it('a stationarySince in the future (clock skew) is clamped to zero', () => {
    expect(s({ ignition: true, stationarySince: new Date(NOW.getTime() + 60_000) })).toBe('STATIONARY');
  });

  it('thresholds are configurable', () => {
    const fast = { offlineAfterSec: 12, movingSpeedKmh: 5, idleAfterSec: 6, parkedAfterSec: 10 };
    expect(s({ ignition: true, stationarySince: ago(6) }, fast)).toBe('IDLING');
    expect(s({ ignition: null, stationarySince: ago(10) }, fast)).toBe('PARKED');
    expect(s({ lastSeenAt: ago(13) }, fast)).toBe('OFFLINE');
    expect(s({ lastSeenAt: ago(12) }, fast)).not.toBe('OFFLINE');
  });

  it('a heartbeat-only device (seen, but no fix yet) with unknown speed is STATIONARY, not NO_DATA or MOVING', () => {
    expect(s({ speedKmh: null, ignition: null, stationarySince: null })).toBe('STATIONARY');
  });
});

describe('isStationaryFix', () => {
  it.each([
    [0, null, true],
    [4.9, null, true],
    [5, null, false],
    [50, false, true], // motion flag says it is not moving
    [50, true, false],
    [null, false, true],
    [null, true, false],
    [null, null, false], // unknown stays unknown: do not claim a stop
  ])('speed %s motion %s -> %s', (speed, motion, expected) => {
    expect(isStationaryFix(speed, motion, T)).toBe(expected);
  });
});

describe('nextStatusDeadline', () => {
  const base: StatusInput = { everReported: true, lastSeenAt: NOW, speedKmh: 0, motion: null, ignition: true, stationarySince: NOW };
  const at = (offsetSec: number) => new Date(NOW.getTime() + offsetSec * 1000);

  it('is null when nothing can change by itself: never reported, or already OFFLINE', () => {
    expect(nextStatusDeadline({ ...base, everReported: false, lastSeenAt: null }, NOW)).toBeNull();
    expect(nextStatusDeadline(base, at(T.offlineAfterSec + 1))).toBeNull();
  });

  it('a moving vehicle can only change by going silent: the deadline is its own offline threshold', () => {
    const moving = { ...base, speedKmh: 50, stationarySince: null };
    expect(nextStatusDeadline(moving, NOW)!.getTime()).toBe(NOW.getTime() + T.offlineAfterSec * 1000 + 1);
    const fast = { ...T, offlineAfterSec: 15 }; // a vehicle with its own, shorter threshold
    expect(nextStatusDeadline(moving, NOW, fast)!.getTime()).toBe(NOW.getTime() + 15_000 + 1);
  });

  it('a stopped vehicle with ignition ON is reviewed when it becomes IDLING; with ignition unknown when it becomes PARKED', () => {
    expect(nextStatusDeadline(base, NOW)!.getTime()).toBe(NOW.getTime() + T.idleAfterSec * 1000);
    expect(nextStatusDeadline({ ...base, ignition: null }, NOW)!.getTime()).toBe(NOW.getTime() + T.parkedAfterSec * 1000);
  });

  it('ignition OFF is PARKED at once: only the offline deadline remains', () => {
    expect(nextStatusDeadline({ ...base, ignition: false }, NOW)!.getTime()).toBe(NOW.getTime() + T.offlineAfterSec * 1000 + 1);
  });

  it('moves on to the next candidate once an earlier one has passed', () => {
    expect(nextStatusDeadline(base, at(T.idleAfterSec))!.getTime()).toBe(NOW.getTime() + T.offlineAfterSec * 1000 + 1);
  });

  it('PROPERTY: the deadline is never later than the first moment the derived status changes with time alone', () => {
    const ignitions = [true, false, null] as const;
    const speeds = [null, 0, 3, 50];
    const motions = [null, true, false] as const;
    const stationary = [null, 0, 100, 200, 290];
    const thresholds = [T, { offlineAfterSec: 15, movingSpeedKmh: 5, idleAfterSec: 6, parkedAfterSec: 10 }];
    let checked = 0;
    for (const t of thresholds) for (const ignition of ignitions) for (const speedKmh of speeds) for (const motion of motions) for (const s of stationary) {
      const input: StatusInput = { everReported: true, lastSeenAt: NOW, speedKmh, motion, ignition, stationarySince: s === null ? null : at(-s) };
      const start = deriveStatus(input, NOW, t);
      let firstChange: number | null = null;
      for (let sec = 1; sec <= t.offlineAfterSec + 5 && firstChange === null; sec++) if (deriveStatus(input, at(sec), t) !== start) firstChange = sec;
      const deadline = nextStatusDeadline(input, NOW, t);
      if (firstChange === null) continue; // status never changes (e.g. already OFFLINE or stays PARKED): any deadline is fine
      expect(deadline).not.toBeNull();
      expect(deadline!.getTime()).toBeLessThanOrEqual(at(firstChange).getTime());
      checked++;
    }
    expect(checked).toBeGreaterThan(50); // the grid really exercised transitions
  });
});
