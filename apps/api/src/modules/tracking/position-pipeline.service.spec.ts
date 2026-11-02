import type { Env } from '../../infrastructure/config/env';
import type { EnginePosition } from '../../integrations/gps-engine/port';
import type { DeviceRoute, DeviceRoutingService } from '../devices/device-routing.service';
import type { LiveState } from '../live-state/live-state';
import { StatusConfigService } from '../live-state/status-config.service';
import type { IngestStatsService } from './ingest-stats.service';
import { PositionPipelineService, isUsableFix } from './position-pipeline.service';

const ORG = 'org-1';
const VEHICLE = 'veh-1';
const t = (iso: string) => new Date(iso);
const tick = () => new Promise<void>((r) => setImmediate(r)); // device liveness is written off the hot path
const T0 = t('2026-11-01T10:00:00Z');
const at = (sec: number) => new Date(T0.getTime() + sec * 1000);

const position = (over: Partial<EnginePosition> = {}): EnginePosition => ({
  engineDeviceId: 7, engineId: 1, fixTime: T0, deviceTime: T0, serverTime: at(3),
  latitude: -1.9441, longitude: 30.0619, altitudeM: null, speedKmh: 37, heading: 90, accuracyM: null, valid: true, ignition: true, motion: null,
  externalPowerV: null, batteryPercent: null, satellites: null, declaredSimulated: false, protocol: 'osmand', raw: {}, ...over,
});
const route = (over: Partial<DeviceRoute> = {}): DeviceRoute => ({
  deviceId: 'dev-1', uniqueId: 'IMEI-1', isSimulated: false, ownerOrganizationId: ORG, ownerIsSandbox: false, assignment: { organizationId: ORG, vehicleId: VEHICLE }, ...over,
});

const ENV = {
  SIMULATOR_ENABLED: true, PIPELINE_DELAYED_AFTER_SEC: 120, PIPELINE_MAX_PLAUSIBLE_SPEED_KMH: 300,
  STATUS_OFFLINE_AFTER_SEC: 600, STATUS_MOVING_SPEED_KMH: 5, STATUS_IDLE_AFTER_SEC: 180, STATUS_PARKED_AFTER_SEC: 300,
} as Env;

function harness(r: DeviceRoute | null, env: Partial<Env> = {}) {
  const e = { ...ENV, ...env } as Env;
  let state: LiveState | null = null;
  const puts: { state: LiveState; persistNow: boolean }[] = [];
  const deltas: { org: string; vehicleId: string; status: string }[] = [];
  const alertCalls: { prev: LiveState | null; next: LiveState; fixTime: Date; delayed: boolean }[] = [];
  const recents: unknown[] = [];
  const counters: Record<string, number> = {};
  const device = { lastSeenAt: null as Date | null, firstSignalAt: null as Date | null };

  const tx = {
    gpsDevice: {
      findUnique: async () => ({ ...device }),
      update: async ({ data }: { data: Partial<typeof device> }) => void Object.assign(device, Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined))),
    },
  };
  const store = {
    get: async () => state,
    put: async (s: LiveState, persistNow = false) => { state = s; puts.push({ state: s, persistNow }); },
    pushRecent: async (_o: string, _v: string, sample: unknown) => void recents.push(sample),
  };
  const service = new PositionPipelineService(
    { resolve: async () => r } as unknown as DeviceRoutingService,
    { runInOrganization: async (_o: string, fn: (x: typeof tx) => unknown) => fn(tx) } as never,
    { incr: async (c: string) => void (counters[c] = (counters[c] ?? 0) + 1) } as unknown as IngestStatsService,
    store as never,
    new StatusConfigService(e),
    { queueDelta: (org: string, d: { vehicleId: string; status: string }) => void deltas.push({ org, vehicleId: d.vehicleId, status: d.status }) } as never,
    { onAcceptedFix: async (prev: LiveState | null, next: LiveState, fixTime: Date, delayed: boolean) => void alertCalls.push({ prev, next, fixTime, delayed }) } as never,
    e,
  );
  let now = at(10);
  service.clock = () => now;
  return { service, counters, puts, deltas, alertCalls, recents, device, setNow: (d: Date) => (now = d), get state() { return state!; } };
}

describe('isUsableFix', () => {
  it.each([
    [{ valid: true, latitude: -1.9, longitude: 30.1 }, true],
    [{ valid: false, latitude: -1.9, longitude: 30.1 }, false],
    [{ valid: true, latitude: 0, longitude: 0 }, false],
    [{ valid: true, latitude: 0, longitude: 30 }, true],
    [{ valid: true, latitude: 90.0001, longitude: 0 }, false],
    [{ valid: true, latitude: -91, longitude: 0 }, false],
    [{ valid: true, latitude: 0, longitude: 180.5 }, false],
    [{ valid: true, latitude: NaN, longitude: 1 }, false],
    [{ valid: true, latitude: 1, longitude: Infinity }, false],
  ])('%j -> %s', (p, expected) => expect(isUsableFix(p)).toBe(expected));
});

describe('PositionPipelineService', () => {
  describe('routing and guards', () => {
    it('drops positions of devices the platform does not know, and counts them', async () => {
      const h = harness(null);
      await h.service.process(position());
      expect(h.counters).toEqual({ dropped_unmapped: 1 });
      expect(h.puts).toHaveLength(0);
    });

    it('a registered device without a vehicle only records liveness (and its first usable signal)', async () => {
      const h = harness(route({ assignment: null }));
      await h.service.process(position());
      await tick();
      expect(h.puts).toHaveLength(0);
      expect(h.device.firstSignalAt).toEqual(at(3));
      expect(h.counters).toEqual({ unassigned_device: 1 });
    });

    it.each([
      ['simulated device of a sandbox organization', route({ isSimulated: true, ownerIsSandbox: true }), {}, true, true],
      ['simulated device whose organization is not a sandbox', route({ isSimulated: true, ownerIsSandbox: false }), {}, true, false],
      ['simulated device while the simulator is disabled', route({ isSimulated: true, ownerIsSandbox: true }), { SIMULATOR_ENABLED: false }, true, false],
      ['real device claiming to be simulated', route({ isSimulated: false }), {}, true, false],
      ['real device behaving normally', route({ isSimulated: false }), { SIMULATOR_ENABLED: false }, false, true],
    ])('%s', async (_n, r, env, declared, allowed) => {
      const h = harness(r, env as Partial<Env>);
      await h.service.process(position({ declaredSimulated: declared }));
      expect(h.puts.length > 0).toBe(allowed);
      if (!allowed) expect(h.counters).toEqual({ blocked_simulated: 1 });
      if (allowed && r.isSimulated) expect(h.state.simulated).toBe(true);
    });
  });

  describe('accepting a fix', () => {
    it('stores tri-state values as received, derives status, keeps a recent sample and queues a delta', async () => {
      const h = harness(route());
      await h.service.process(position({ ignition: null, speedKmh: null, motion: null }));
      expect(h.state).toMatchObject({ latitude: -1.9441, ignition: null, speedKmh: null, lastFixInvalid: false, lastFixDelayed: false, simulated: false });
      expect(h.deltas).toEqual([{ org: ORG, vehicleId: VEHICLE, status: h.state.status }]);
      expect(h.recents).toHaveLength(1);
      expect(h.counters).toEqual({ accepted: 1 });
      expect(h.alertCalls).toHaveLength(1);
      expect(h.alertCalls[0]!.prev).toBeNull();
    });

    it('derives MOVING from a fast fix and persists immediately only when the status changes', async () => {
      const h = harness(route());
      await h.service.process(position({ speedKmh: 40 }));
      expect(h.state.status).toBe('MOVING');
      expect(h.puts[0]!.persistNow).toBe(true); // first position
      await h.service.process(position({ fixTime: at(5), serverTime: at(8), speedKmh: 42 }));
      expect(h.puts[1]!.persistNow).toBe(false); // same status: coalesced write-through
      await h.service.process(position({ fixTime: at(10), serverTime: at(13), speedKmh: 0, ignition: false }));
      expect(h.state.status).toBe('PARKED');
      expect(h.puts[2]!.persistNow).toBe(true);
    });
  });

  describe('classifying a fix that must not move the vehicle', () => {
    it('older or equal fixes never regress the state; an exact repeat is a duplicate; liveness still advances', async () => {
      const h = harness(route());
      await h.service.process(position({ fixTime: at(300), serverTime: at(303), latitude: -1.95 }));
      await h.service.process(position({ fixTime: at(100), serverTime: at(400), latitude: -1.90 })); // older fix, newer arrival
      await h.service.process(position({ fixTime: at(300), serverTime: at(500), latitude: -1.99 })); // equal time, other place
      await h.service.process(position({ fixTime: at(300), serverTime: at(600), latitude: -1.95 })); // exact repeat
      expect(h.state).toMatchObject({ latitude: -1.95, lastFixAt: at(300) });
      expect(h.state.lastSeenAt).toEqual(at(600));
      expect(h.counters).toEqual({ accepted: 1, ignored_out_of_order: 2, duplicate: 1 });
      expect(h.alertCalls).toHaveLength(1); // alerts only for accepted fixes
    });

    it('lastSeenAt never moves backwards (backfilled old arrivals cannot make a vehicle look offline)', async () => {
      const h = harness(route());
      await h.service.process(position({ serverTime: at(1000), fixTime: at(999) }));
      await h.service.process(position({ serverTime: at(10), fixTime: at(9) }), 'backfill');
      expect(h.state.lastSeenAt).toEqual(at(1000));
      expect(h.counters['backfilled']).toBe(1);
    });

    it('an unusable fix is a heartbeat: coordinates stay, the flag is set, the next good fix clears it', async () => {
      const h = harness(route());
      await h.service.process(position());
      await h.service.process(position({ fixTime: at(60), latitude: 0, longitude: 0, serverTime: at(63) }));
      expect(h.state).toMatchObject({ latitude: -1.9441, longitude: 30.0619, lastFixInvalid: true, lastFixAt: T0, lastSeenAt: at(63) });
      await h.service.process(position({ fixTime: at(120), latitude: -1.95, serverTime: at(123) }));
      expect(h.state).toMatchObject({ latitude: -1.95, lastFixInvalid: false });
      expect(h.counters).toEqual({ accepted: 2, heartbeat_invalid: 1 });
    });

    it('a device whose FIRST message is invalid has a state without coordinates, and no "first signal"', async () => {
      const h = harness(route());
      await h.service.process(position({ valid: false }));
      await tick();
      expect(h.state).toMatchObject({ lastFixInvalid: true, latitude: null, longitude: null, lastFixAt: null });
      expect(h.device.firstSignalAt).toBeNull();
    });
  });

  describe('delayed data and clock skew', () => {
    it('a fix recorded long before it arrived is accepted as the latest but flagged delayed, and alerts are told', async () => {
      const h = harness(route());
      await h.service.process(position({ fixTime: at(0), serverTime: at(300) })); // 300 s late (> 120 s)
      expect(h.state.lastFixDelayed).toBe(true);
      expect(h.counters).toMatchObject({ accepted: 1, delayed_fix: 1 });
      expect(h.alertCalls[0]!.delayed).toBe(true);
      await h.service.process(position({ fixTime: at(299), serverTime: at(301) })); // fresh again
      expect(h.state.lastFixDelayed).toBe(false);
    });

    it('a fix from the future is clamped to its arrival time and counted', async () => {
      const h = harness(route());
      await h.service.process(position({ fixTime: at(600), serverTime: at(3) })); // claims +597 s
      expect(h.state.lastFixAt).toEqual(at(3));
      expect(h.counters).toMatchObject({ clock_skew: 1, accepted: 1 });
    });
  });

  describe('implausible jumps', () => {
    const far = (sec: number, lat = 30.07, lon = -1.95) => position({ fixTime: at(sec), serverTime: at(sec + 3), latitude: lat, longitude: lon }); // swapped lat/lon

    it('a teleport is not applied to the marker, but the device counts as alive and the fix is flagged', async () => {
      const h = harness(route());
      await h.service.process(position());
      await h.service.process(far(10));
      expect(h.state).toMatchObject({ latitude: -1.9441, longitude: 30.0619, lastFixInvalid: true, lastSeenAt: at(13) });
      expect(h.counters).toMatchObject({ accepted: 1, implausible_jump: 1 });
      expect(h.alertCalls).toHaveLength(1);
    });

    it('ordinary GPS noise over a short interval is never a jump', async () => {
      const h = harness(route());
      await h.service.process(position());
      await h.service.process(position({ fixTime: at(1), serverTime: at(4), latitude: -1.94415, longitude: 30.06195 })); // ~7 m in 1 s
      expect(h.counters).toEqual({ accepted: 2 });
    });

    it('if the FIRST fix was the outlier, three consistent far-away fixes become the new truth (no permanent lock-out)', async () => {
      const h = harness(route());
      await h.service.process(position({ latitude: 30.07, longitude: -1.95 })); // wrong baseline
      await h.service.process(position({ fixTime: at(10), serverTime: at(13), latitude: -1.9441, longitude: 30.0619 }));
      await h.service.process(position({ fixTime: at(20), serverTime: at(23), latitude: -1.9442, longitude: 30.0620 }));
      expect(h.state.latitude).toBe(30.07); // still suspicious after two
      await h.service.process(position({ fixTime: at(30), serverTime: at(33), latitude: -1.9443, longitude: 30.0621 }));
      expect(h.state).toMatchObject({ latitude: -1.9443, lastFixInvalid: false });
      expect(h.counters).toMatchObject({ jump_rebaselined: 1 });
    });

    it('a single outlier between good fixes does not trigger a re-baseline', async () => {
      const h = harness(route());
      await h.service.process(position());
      await h.service.process(far(10));
      await h.service.process(position({ fixTime: at(20), serverTime: at(23), latitude: -1.9445, longitude: 30.0625 })); // back on track
      expect(h.state).toMatchObject({ latitude: -1.9445, lastFixInvalid: false });
      expect(h.counters['jump_rebaselined']).toBeUndefined();
    });
  });

  describe('stationarity and status over time (injectable clock)', () => {
    it('moving clears stationarySince; a stop sets it once and keeps the original start', async () => {
      const h = harness(route());
      await h.service.process(position({ speedKmh: 40 }));
      expect(h.state.stationarySince).toBeNull();
      await h.service.process(position({ fixTime: at(10), serverTime: at(13), speedKmh: 0 }));
      expect(h.state.stationarySince).toEqual(at(10));
      await h.service.process(position({ fixTime: at(40), serverTime: at(43), speedKmh: 1 }));
      expect(h.state.stationarySince).toEqual(at(10)); // unchanged while the stop continues
      await h.service.process(position({ fixTime: at(50), serverTime: at(53), speedKmh: 30 }));
      expect(h.state.stationarySince).toBeNull();
    });

    it('MOVING -> STATIONARY -> IDLING as the stop gets longer (ignition on)', async () => {
      const h = harness(route());
      h.setNow(at(3));
      await h.service.process(position({ speedKmh: 40, ignition: true }));
      expect(h.state.status).toBe('MOVING');
      h.setNow(at(15));
      await h.service.process(position({ fixTime: at(10), serverTime: at(13), speedKmh: 0, ignition: true }));
      expect(h.state.status).toBe('STATIONARY'); // brief stop
      h.setNow(at(200));
      await h.service.process(position({ fixTime: at(195), serverTime: at(198), speedKmh: 0, ignition: true }));
      expect(h.state.status).toBe('IDLING'); // stopped for 185 s >= 180 s
      h.setNow(at(220));
      await h.service.process(position({ fixTime: at(215), serverTime: at(218), speedKmh: 0, ignition: false }));
      expect(h.state.status).toBe('PARKED');
    });

    it('a status change is time-stamped, an unchanged status keeps its original change time', async () => {
      const h = harness(route());
      h.setNow(at(10));
      await h.service.process(position({ speedKmh: 40 }));
      const changedAt = h.state.statusChangedAt;
      h.setNow(at(20));
      await h.service.process(position({ fixTime: at(10), serverTime: at(13), speedKmh: 41 }));
      expect(h.state.statusChangedAt).toEqual(changedAt);
    });
  });

  describe('serialisation', () => {
    it('runExclusive runs jobs strictly one after another, even when an earlier one is slow, and survives a failing job', async () => {
      const h = harness(route());
      const order: string[] = [];
      const slow = h.service.runExclusive(async () => { await new Promise((r) => setTimeout(r, 40)); order.push('slow'); });
      const failing = h.service.runExclusive(async () => { order.push('failing'); throw new Error('boom'); });
      const last = h.service.runExclusive(async () => void order.push('last'));
      await expect(failing).rejects.toThrow('boom');
      await Promise.all([slow, last]);
      expect(order).toEqual(['slow', 'failing', 'last']);
    });
  });
});
