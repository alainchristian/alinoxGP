import { describe, expect, it } from 'vitest';
import type { LiveLocationDto, VehicleDeltaDto } from '@gps/shared';
import {
  LOG_LIMIT,
  agoLabel,
  applyDelta,
  applyDeltas,
  coordinatesLabel,
  countByStatus,
  ignitionLabel,
  isReceiving,
  mergeSnapshot,
  pushLog,
  speedLabel,
  visibleRows,
  type LogEntry,
  type RowMap,
} from './monitor-model';

const T0 = Date.parse('2026-11-02T10:00:00Z');
const at = (sec: number) => new Date(T0 + sec * 1000).toISOString();

const row = (id: string, over: Partial<LiveLocationDto> = {}): LiveLocationDto => ({
  vehicleId: id, registrationNumber: `REG-${id}`, deviceId: `dev-${id}`, status: 'MOVING', latitude: -1.94, longitude: 30.06, speedKmh: 40, heading: 90, ignition: true,
  lastFixAt: at(0), lastSeenAt: at(0), lastFixInvalid: false, lastFixDelayed: false, simulated: true, ...over,
});
const delta = (id: string, over: Partial<VehicleDeltaDto> = {}): VehicleDeltaDto => {
  const { registrationNumber: _r, deviceId: _d, ...rest } = row(id);
  return { ...rest, ...over };
};
const table = (...rows: LiveLocationDto[]): RowMap => new Map(rows.map((r) => [r.vehicleId, r]));

describe('applyDelta — merge by time, never backwards', () => {
  it('applies a newer delta and keeps the registration number and device (deltas do not carry them)', () => {
    const r = applyDelta(table(row('a')), delta('a', { speedKmh: 55, lastFixAt: at(5), lastSeenAt: at(5) }));
    expect(r.applied).toBe(true);
    expect(r.rows.get('a')).toMatchObject({ speedKmh: 55, registrationNumber: 'REG-a', deviceId: 'dev-a', lastSeenAt: at(5) });
  });

  it('ignores a delta whose fix is older than the one held', () => {
    const rows = table(row('a', { lastFixAt: at(10), lastSeenAt: at(10), speedKmh: 40 }));
    const r = applyDelta(rows, delta('a', { speedKmh: 99, lastFixAt: at(5), lastSeenAt: at(11) }));
    expect(r.applied).toBe(false);
    expect(r.rows.get('a')?.speedKmh).toBe(40);
  });

  it('ignores a delta that is older by "last seen" even when the fix is equal', () => {
    const rows = table(row('a', { lastSeenAt: at(10) }));
    expect(applyDelta(rows, delta('a', { lastSeenAt: at(9) })).applied).toBe(false);
  });

  it('accepts a heartbeat (same fix, newer last seen, no usable fix) and a status change at the same instant', () => {
    const rows = table(row('a', { lastFixAt: at(10), lastSeenAt: at(10) }));
    const hb = applyDelta(rows, delta('a', { lastFixAt: at(10), lastSeenAt: at(20), lastFixInvalid: true }));
    expect(hb.rows.get('a')).toMatchObject({ lastFixInvalid: true, lastSeenAt: at(20), latitude: -1.94 });
    const same = applyDelta(rows, delta('a', { lastFixAt: at(10), lastSeenAt: at(10), status: 'OFFLINE' }));
    expect(same.rows.get('a')?.status).toBe('OFFLINE');
  });

  it('a vehicle that has never had a fix (null) accepts its first one', () => {
    const rows = table(row('a', { lastFixAt: null, latitude: null, longitude: null }));
    expect(applyDelta(rows, delta('a', { lastFixAt: at(1), lastSeenAt: at(1) })).rows.get('a')).toMatchObject({ latitude: -1.94 });
  });

  it('reports an unknown vehicle instead of inventing a row (a delta has no registration number)', () => {
    const rows = table(row('a'));
    const r = applyDelta(rows, delta('zzz'));
    expect(r).toMatchObject({ unknown: true, applied: false });
    expect(r.rows).toBe(rows);
  });

  it('never mutates the table it was given', () => {
    const rows = table(row('a'));
    const r = applyDelta(rows, delta('a', { speedKmh: 1, lastSeenAt: at(1), lastFixAt: at(1) }));
    expect(rows.get('a')?.speedKmh).toBe(40);
    expect(r.rows).not.toBe(rows);
  });
});

describe('applyDeltas / mergeSnapshot', () => {
  it('applies a batch in order and flags unknown vehicles', () => {
    const r = applyDeltas(table(row('a'), row('b')), [delta('a', { speedKmh: 1, lastSeenAt: at(1), lastFixAt: at(1) }), delta('b', { speedKmh: 2, lastSeenAt: at(1), lastFixAt: at(1) }), delta('new')]);
    expect(r.applied).toBe(2);
    expect(r.unknown).toBe(true);
    expect([r.rows.get('a')?.speedKmh, r.rows.get('b')?.speedKmh]).toEqual([1, 2]);
  });

  it('a snapshot replaces the table, but a pushed message newer than the snapshot is kept', () => {
    const held = table(row('a', { speedKmh: 77, lastSeenAt: at(30), lastFixAt: at(30) }), row('gone'));
    const merged = mergeSnapshot(held, [row('a', { speedKmh: 40, lastSeenAt: at(10), lastFixAt: at(10) }), row('b')]);
    expect(merged.get('a')).toMatchObject({ speedKmh: 77, registrationNumber: 'REG-a' });
    expect(merged.has('b')).toBe(true);
    expect(merged.has('gone')).toBe(false); // no longer in the organization's list
  });
});

describe('counting, filtering, sorting', () => {
  const rows = table(row('10', { registrationNumber: 'F00010', status: 'PARKED' }), row('2', { registrationNumber: 'F00002' }), row('3', { registrationNumber: 'RAB 123 C', status: 'OFFLINE' }));

  it('counts every status, including zero', () => {
    expect(countByStatus(rows)).toEqual({ NO_DATA: 0, OFFLINE: 1, MOVING: 1, IDLING: 0, PARKED: 1, STATIONARY: 0 });
  });

  it('sorts registrations naturally (2 before 10)', () => {
    expect(visibleRows(rows, { status: null, query: '' }).map((r) => r.registrationNumber)).toEqual(['F00002', 'F00010', 'RAB 123 C']);
    expect(visibleRows(table(row('1', { registrationNumber: 'A2' }), row('2', { registrationNumber: 'A10' })), { status: null, query: '' }).map((r) => r.registrationNumber)).toEqual(['A2', 'A10']);
  });

  it('filters by status and by a case-insensitive part of the registration', () => {
    expect(visibleRows(rows, { status: 'PARKED', query: '' }).map((r) => r.vehicleId)).toEqual(['10']);
    expect(visibleRows(rows, { status: null, query: 'rab' }).map((r) => r.vehicleId)).toEqual(['3']);
    expect(visibleRows(rows, { status: 'PARKED', query: 'rab' })).toEqual([]);
    expect(visibleRows(rows, { status: null, query: '  f000 ' })).toHaveLength(2); // surrounding spaces are ignored
  });
});

describe('labels — unknown stays unknown', () => {
  it('ignition: null is Unknown, never Off', () => {
    expect([ignitionLabel(true), ignitionLabel(false), ignitionLabel(null)]).toEqual(['On', 'Off', 'Unknown']);
  });
  it('speed and coordinates: null is a dash, never 0', () => {
    expect(speedLabel(null)).toBe('—');
    expect(speedLabel(0)).toBe('0.0');
    expect(speedLabel(37.46)).toBe('37.5');
    expect(coordinatesLabel(null, 30)).toBe('—');
    expect(coordinatesLabel(-1.94412, 30.06191)).toBe('-1.94412, 30.06191');
  });
  it.each([
    [null, '—'],
    [0, 'just now'],
    [12, '12 s ago'],
    [59, '59 s ago'],
    [60, '1 min ago'],
    [3599, '59 min ago'],
    [7200, '2 h ago'],
    [3 * 86400, '3 d ago'],
  ])('ago(%s s) -> %s', (sec, expected) => {
    expect(agoLabel(sec === null ? null : at(-sec), T0)).toBe(expected);
  });
  it('a time slightly in the future (clock skew between machines) shows as just now, not negative', () => {
    expect(agoLabel(at(2), T0)).toBe('just now');
  });
  it('"receiving" means the last message is seconds old', () => {
    expect(isReceiving(at(-3), T0)).toBe(true);
    expect(isReceiving(at(-30), T0)).toBe(false);
  });
});

describe('event log', () => {
  it('keeps the newest first and is bounded', () => {
    let log: LogEntry[] = [];
    for (let i = 0; i < LOG_LIMIT + 10; i++) log = pushLog(log, 'delta', `event ${i}`, T0 + i);
    expect(log).toHaveLength(LOG_LIMIT);
    expect(log[0]?.text).toBe(`event ${LOG_LIMIT + 9}`);
    expect(new Set(log.map((e) => e.id)).size).toBe(LOG_LIMIT); // ids are unique (React keys)
  });
});
