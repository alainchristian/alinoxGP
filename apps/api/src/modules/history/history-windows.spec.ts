import { classifyTrip, clipToHistoryPeriod, coverageWithin, exceedsSpan, isDrawable, queryWindows, thin } from './history-windows';

const d = (s: string) => new Date(`2026-11-${s}:00Z`);
const NOW = d('10T12:00');

describe('history period and span', () => {
  it('moves the start forward to the history period and never asks for the future', () => {
    const r = clipToHistoryPeriod({ from: d('01T00:00'), to: d('12T00:00') }, NOW, 5)!;
    expect(r.clipped).toBe(true);
    expect(r.range.from.toISOString()).toBe('2026-11-05T12:00:00.000Z');
    expect(r.range.to.toISOString()).toBe(NOW.toISOString());
  });

  it('answers a range inside the period unchanged and says nothing was clipped', () => {
    const r = clipToHistoryPeriod({ from: d('08T00:00'), to: d('09T00:00') }, NOW, 5)!;
    expect(r.clipped).toBe(false);
    expect(r.range.from).toEqual(d('08T00:00'));
  });

  it('has nothing to answer when the whole range is older than the period or in the future', () => {
    expect(clipToHistoryPeriod({ from: d('01T00:00'), to: d('02T00:00') }, NOW, 5)).toBeNull();
    expect(clipToHistoryPeriod({ from: d('11T00:00'), to: d('12T00:00') }, NOW, 5)).toBeNull();
  });

  it('allows exactly the span and refuses one millisecond more', () => {
    const from = d('01T00:00');
    expect(exceedsSpan({ from, to: new Date(from.getTime() + 7 * 86_400_000) }, 7)).toBe(false);
    expect(exceedsSpan({ from, to: new Date(from.getTime() + 7 * 86_400_000 + 1) }, 7)).toBe(true);
  });
});

describe('assignment windows (a moved device never reveals the other tenant’s movements)', () => {
  const range = { from: d('02T00:00'), to: d('09T00:00') };

  it('uses only the installation period inside the range', () => {
    const w = queryWindows([{ assignedAt: d('01T00:00'), unassignedAt: d('04T00:00') }], range, NOW);
    expect(w).toHaveLength(1);
    expect(w[0]!.range).toEqual({ from: d('02T00:00'), to: d('04T00:00') });
  });

  it('a device installed AFTER the range or removed BEFORE it contributes nothing', () => {
    expect(queryWindows([{ assignedAt: d('09T12:00'), unassignedAt: null }], range, NOW)).toEqual([]);
    expect(queryWindows([{ assignedAt: d('01T00:00'), unassignedAt: d('02T00:00') }], range, NOW)).toEqual([]);
  });

  it('an open assignment runs to now, but never past the end of the range', () => {
    const w = queryWindows([{ assignedAt: d('08T00:00'), unassignedAt: null }], { from: d('07T00:00'), to: d('20T00:00') }, NOW);
    expect(w[0]!.range.to).toEqual(NOW);
    const closed = queryWindows([{ assignedAt: d('08T00:00'), unassignedAt: null }], { from: d('07T00:00'), to: d('09T00:00') }, NOW);
    expect(closed[0]!.range.to).toEqual(d('09T00:00'));
  });

  it('a vehicle that changed tracker gets one window per tracker, in time order, with the gap left out', () => {
    const w = queryWindows(
      [
        { assignedAt: d('06T00:00'), unassignedAt: null, id: 'new' },
        { assignedAt: d('01T00:00'), unassignedAt: d('04T00:00'), id: 'old' },
      ],
      range,
      NOW,
    );
    expect(w.map((x) => x.assignment.id)).toEqual(['old', 'new']);
    expect(coverageWithin([{ assignedAt: d('01T00:00'), unassignedAt: d('04T00:00') }, { assignedAt: d('06T00:00'), unassignedAt: null }], range, NOW)).toEqual([
      { from: d('02T00:00'), to: d('04T00:00') },
      { from: d('06T00:00'), to: d('09T00:00') },
    ]);
  });

  it('merges overlapping rows instead of counting a period twice', () => {
    const c = coverageWithin([{ assignedAt: d('02T00:00'), unassignedAt: d('05T00:00') }, { assignedAt: d('04T00:00'), unassignedAt: d('06T00:00') }], range, NOW);
    expect(c).toEqual([{ from: d('02T00:00'), to: d('06T00:00') }]);
  });
});

describe('drawable fixes and thinning', () => {
  it('rejects invalid fixes, impossible coordinates and the 0,0 value', () => {
    expect(isDrawable({ valid: true, latitude: -1.94, longitude: 30.06 })).toBe(true);
    expect(isDrawable({ valid: false, latitude: -1.94, longitude: 30.06 })).toBe(false);
    expect(isDrawable({ valid: true, latitude: 95, longitude: 30 })).toBe(false);
    expect(isDrawable({ valid: true, latitude: 0, longitude: 0 })).toBe(false);
    expect(isDrawable({ valid: true, latitude: Number.NaN, longitude: 1 })).toBe(false);
  });

  it('keeps the first and last point and the order when thinning', () => {
    const items = Array.from({ length: 1000 }, (_, i) => i);
    const t = thin(items, 50);
    expect(t).toHaveLength(50);
    expect(t[0]).toBe(0);
    expect(t[49]).toBe(999);
    expect([...t].sort((a, b) => a - b)).toEqual(t);
    expect(thin([1, 2, 3], 50)).toEqual([1, 2, 3]);
  });
});

describe('which engine trips are listed', () => {
  const MIN = 60_000;
  it('hides GPS drift while parked (24 m in 22 s) and counts it as too short', () => {
    expect(classifyTrip({ distanceM: 24, durationMs: 22_000 }, 200, 250)).toBe('tooShort');
    expect(classifyTrip({ distanceM: 199, durationMs: 5 * MIN }, 200, 250)).toBe('tooShort');
    expect(classifyTrip({ distanceM: 200, durationMs: 5 * MIN }, 200, 250)).toBe('ok');
  });
  it('hides the 11 642 km trip a swapped coordinate once produced', () => {
    expect(classifyTrip({ distanceM: 11_642_405, durationMs: 148_000 }, 200, 250)).toBe('implausible');
    expect(classifyTrip({ distanceM: 5_000, durationMs: 0 }, 200, 250)).toBe('implausible');
  });
  it('keeps an ordinary journey, including a fast one on a motorway', () => {
    expect(classifyTrip({ distanceM: 9_740, durationMs: 19 * MIN }, 200, 250)).toBe('ok');
    expect(classifyTrip({ distanceM: 120_000, durationMs: 60 * MIN }, 200, 250)).toBe('ok');
  });
});
