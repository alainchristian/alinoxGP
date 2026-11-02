import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { backoffDelay } from './traccar.stream';
import { KNOTS_TO_KMH, toEngineDevice, toEnginePosition, triState } from './traccar.mapper';
import { traccarDeviceSchema, traccarPositionSchema, traccarSocketFrameSchema } from './traccar.schemas';

const fixture = <T>(name: string): T => JSON.parse(readFileSync(join(__dirname, '../../../../test/fixtures/traccar', name), 'utf8')) as T;

/** These tests run against responses RECORDED from the pinned Traccar (test/fixtures/traccar/capture.cjs). */
describe('Traccar mapper (recorded fixtures)', () => {
  const history = fixture<unknown[]>('positions-history.json').map((p) => traccarPositionSchema.parse(p));
  const behaviour = fixture<{ case: string; params: { speed?: number }; storedInHistory: boolean }[]>('osmand-behaviour.json');

  it('the fixtures were captured from the version we pin', () => {
    expect(fixture<{ version: string }>('server.json').version).toBe('6.16.0');
  });

  it('every recorded position parses and every recorded device parses', () => {
    expect(history.length).toBeGreaterThan(5);
    for (const d of fixture<unknown[]>('device-after-positions.json')) expect(traccarDeviceSchema.safeParse(d).success).toBe(true);
    expect(traccarDeviceSchema.parse(fixture('device-created.json')).uniqueId).toBe('FIXTURE-1');
  });

  it('converts knots to km/h (OsmAnd `speed=20` is stored by Traccar as 20 knots)', () => {
    // Recorded fact: OsmAnd's speed parameter passes through unchanged and is interpreted as knots.
    const sent20 = history.find((p) => p.speed === 20)!;
    expect(sent20).toBeDefined();
    expect(toEnginePosition(sent20).speedKmh).toBe(37); // 20 kn * 1.852 = 37.04 -> 37.0
    const sent10 = history.find((p) => p.speed === 10)!;
    expect(toEnginePosition(sent10).speedKmh).toBe(18.5);
    expect(KNOTS_TO_KMH).toBe(1.852);
    expect(behaviour.find((c) => c.case.startsWith('B'))?.params.speed).toBe(10);
  });

  it('keeps ignition tri-state: reported true, reported false, and NOT reported (null, never false)', () => {
    const mapped = history.map(toEnginePosition);
    expect(mapped.some((p) => p.ignition === true)).toBe(true);
    expect(mapped.some((p) => p.ignition === false)).toBe(true);
    const unreported = history.filter((p) => p.attributes['ignition'] === undefined).map(toEnginePosition);
    expect(unreported.length).toBeGreaterThan(0);
    for (const p of unreported) expect(p.ignition).toBeNull();
  });

  it('maps power, satellites, battery and the self-declared simulated flag', () => {
    const custom = toEnginePosition(history.find((p) => p.attributes['power'] === 12.4)!);
    expect(custom.externalPowerV).toBe(12.4);
    expect(custom.satellites).toBe(9);
    expect(custom.declaredSimulated).toBe(true);
    const first = toEnginePosition(history.find((p) => p.attributes['batteryLevel'] === 90)!);
    expect(first.batteryPercent).toBe(90);
    expect(first.declaredSimulated).toBe(false);
  });

  it('returns UTC dates and keeps fix, device and server times distinct', () => {
    const p = toEnginePosition(history[0]!);
    expect(p.fixTime).toBeInstanceOf(Date);
    expect(Number.isNaN(p.fixTime.getTime())).toBe(false);
    expect(p.serverTime.getTime()).toBeGreaterThanOrEqual(p.fixTime.getTime() - 1000);
  });

  it('records what Traccar does with bad input so the pipeline can be built around it', () => {
    const stored = (prefix: string) => behaviour.find((c) => c.case.startsWith(prefix))!.storedInHistory;
    expect(stored('F')).toBe(true); // (0,0) IS stored as a valid position -> our pipeline must reject it
    expect(stored('E')).toBe(false); // latitude 95: connection closed, nothing stored
    expect(stored('I')).toBe(false); // +2 h in the future: dropped by filter.future=600
    expect(stored('J')).toBe(false); // +30 min: dropped
    expect(stored('H')).toBe(true); // older than the latest fix: stored (history) but never pushed as latest
    expect(stored('L')).toBe(true); // exact duplicate: stored (no engine-side dedupe)
  });

  it('a trip including a swapped lat/lon point shows why implausible jumps must be filtered', () => {
    const trips = fixture<{ distance: number }[]>('report-trips.json');
    expect(trips[0]!.distance).toBeGreaterThan(1_000_000); // metres: > 1000 km from a handful of Kigali-area points
  });

  it('device mapping normalises engine status and tolerates unknown values', () => {
    const base = traccarDeviceSchema.parse(fixture('device-created.json'));
    expect(toEngineDevice({ ...base, status: 'online' }).engineStatus).toBe('online');
    expect(toEngineDevice({ ...base, status: 'weird' }).engineStatus).toBe('unknown');
    expect(toEngineDevice({ ...base, status: null }).engineStatus).toBe('unknown');
  });
});

describe('WebSocket frames (recorded)', () => {
  const frames = fixture<unknown[]>('ws-messages.json');
  it('are separate envelopes of positions or devices and all validate', () => {
    expect(frames.length).toBeGreaterThan(3);
    for (const f of frames) expect(traccarSocketFrameSchema.safeParse(f).success).toBe(true);
    const kinds = new Set(frames.flatMap((f) => Object.keys(f as object)));
    expect(kinds).toEqual(new Set(['positions', 'devices']));
  });
  it('positions in frames parse with the same schema as REST', () => {
    for (const f of frames as { positions?: unknown[] }[]) for (const p of f.positions ?? []) expect(traccarPositionSchema.safeParse(p).success).toBe(true);
  });
});

describe('triState', () => {
  it.each([[true, true], [false, false], ['true', true], ['false', false], [undefined, null], [null, null], [1, null], ['yes', null], [0, null]])('%p -> %p', (input, expected) => {
    expect(triState(input)).toBe(expected);
  });
});

describe('reconnect backoff', () => {
  it('grows exponentially with jitter and is capped at 30 s', () => {
    const lo = () => 0;
    const hi = () => 0.999999;
    expect(backoffDelay(0, lo)).toBe(500);
    expect(backoffDelay(0, hi)).toBeLessThanOrEqual(1000);
    expect(backoffDelay(3, hi)).toBeLessThanOrEqual(8000);
    for (let attempt = 8; attempt < 20; attempt++) expect(backoffDelay(attempt, hi)).toBeLessThanOrEqual(30_000);
    expect(backoffDelay(30, lo)).toBe(15_000);
  });
});
