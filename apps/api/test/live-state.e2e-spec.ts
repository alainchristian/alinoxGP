import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import type { EnginePosition } from '../src/integrations/gps-engine/port';
import { LiveStateStore } from '../src/modules/live-state/live-state.store';
import { TenantPrismaService } from '../src/infrastructure/prisma/prisma.service';
import { REDIS } from '../src/infrastructure/redis/redis.module';
import { OfflineSweeperService } from '../src/modules/tracking/offline-sweeper.service';
import { PositionPipelineService } from '../src/modules/tracking/position-pipeline.service';
import { addMemberAndLogin, bearer, createOrg, createTestApp, http, stepUp, url, type TestCtx, type TestUser } from './helpers';

/** Live-state store, offline sweeper, summary/status endpoints and alert-rule API — database + Redis, no Traccar. */
describe('Live state, status and alerts (e2e)', () => {
  let ctx: TestCtx;
  let store: LiveStateStore;
  let pipeline: PositionPipelineService;
  let sweeper: OfflineSweeperService;
  let redis: Redis;

  interface Tenant { orgId: string; owner: TestUser; vehicleId: string; deviceId: string; engineId: number }
  const position = (engineDeviceId: number, over: Partial<EnginePosition> = {}): EnginePosition => {
    const now = new Date();
    return {
      engineDeviceId, engineId: 1, fixTime: now, deviceTime: now, serverTime: now, latitude: -1.9441, longitude: 30.0619, altitudeM: null, speedKmh: 40, heading: 90,
      accuracyM: null, valid: true, ignition: true, motion: null, externalPowerV: null, batteryPercent: null, satellites: null, declaredSimulated: false, protocol: 'test', raw: {}, ...over,
    };
  };
  async function tenant(name: string, withDevice = true): Promise<Tenant> {
    const org = await createOrg(ctx, { name });
    const owner = await addMemberAndLogin(ctx, org.id, 'ORG_OWNER');
    const vehicle = await ctx.system.vehicle.create({ data: { organizationId: org.id, registrationNumber: `L${randomUUID().slice(0, 8)}` } });
    const engineId = 600_000_000 + Math.floor(Math.random() * 1_000_000);
    const device = await ctx.system.gpsDevice.create({ data: { uniqueId: `LS-${randomUUID().slice(0, 10)}`, ownerOrganizationId: org.id, currentOrganizationId: org.id, traccarDeviceId: engineId } });
    if (withDevice) await ctx.system.deviceAssignment.create({ data: { organizationId: org.id, deviceId: device.id, vehicleId: vehicle.id } });
    return { orgId: org.id, owner, vehicleId: vehicle.id, deviceId: device.id, engineId };
  }
  const get = (path: string, u: TestUser) => http(ctx).get(url(path)).set(bearer(u));

  beforeAll(async () => {
    ctx = await createTestApp({ STATUS_OFFLINE_AFTER_SEC: '15', STATUS_IDLE_AFTER_SEC: '6', STATUS_PARKED_AFTER_SEC: '10' });
    store = ctx.app.get(LiveStateStore);
    pipeline = ctx.app.get(PositionPipelineService);
    sweeper = ctx.app.get(OfflineSweeperService);
    redis = ctx.app.get<Redis>(REDIS);
  }, 60_000);
  afterAll(() => ctx.close());

  describe('store', () => {
    it('keeps keys tenant-prefixed and never returns one organization’s vehicle for another organization', async () => {
      const a = await tenant('Store A');
      const b = await tenant('Store B');
      await pipeline.process(position(a.engineId));
      expect(await store.get(a.orgId, a.vehicleId)).not.toBeNull();
      expect(await store.get(b.orgId, a.vehicleId)).toBeNull(); // right vehicle id, wrong organization
      expect((await store.list(b.orgId)).map((s) => s.vehicleId)).not.toContain(a.vehicleId);
      const prefix = process.env['REDIS_KEY_PREFIX'] ?? ''; // ioredis does not prefix KEYS patterns, and returns full key names
      const keys = await redis.keys(`${prefix}org:${a.orgId}:*`);
      expect(keys.length).toBeGreaterThan(0);
      expect(keys.every((k) => k.startsWith(`${prefix}org:${a.orgId}:`))).toBe(true);
    });

    it('writes status changes through to PostgreSQL immediately, and plain updates only when flushed', async () => {
      const t = await tenant('Store WT');
      await pipeline.process(position(t.engineId, { speedKmh: 40 })); // first position + status change => write-through scheduled at once
      await store.flush(); // (production does not wait for it; the test does)
      const first = await ctx.system.vehicleLiveState.findUnique({ where: { vehicleId: t.vehicleId } });
      expect(first).toMatchObject({ status: 'MOVING', latitude: -1.9441 });

      await pipeline.process(position(t.engineId, { speedKmh: 41, latitude: -1.9443, fixTime: new Date(Date.now() + 1000) })); // same status
      const stale = await ctx.system.vehicleLiveState.findUnique({ where: { vehicleId: t.vehicleId } });
      expect(stale!.latitude).toBe(-1.9441); // not yet written through (coalesced)
      await store.flush();
      const fresh = await ctx.system.vehicleLiveState.findUnique({ where: { vehicleId: t.vehicleId } });
      expect(fresh!.latitude).toBe(-1.9443);
    });

    it('survives loss of Redis: state is rebuilt from PostgreSQL on the next read', async () => {
      const t = await tenant('Store Loss');
      await pipeline.process(position(t.engineId));
      await store.flush();
      await redis.del(`org:${t.orgId}:live`); // simulate a Redis flush / restart
      const back = await store.get(t.orgId, t.vehicleId);
      expect(back).toMatchObject({ vehicleId: t.vehicleId, latitude: -1.9441, ignition: true });
      expect((await get('/tracking/positions', t.owner)).body.data).toHaveLength(1);
      await redis.del(`org:${t.orgId}:live`);
      expect((await store.list(t.orgId)).map((s) => s.vehicleId)).toEqual([t.vehicleId]); // list rehydrates too
    });

    it('writes a large batch through in chunks, including columns that are entirely unknown (regression: one row-by-row transaction timed out at ~1,000 vehicles)', async () => {
      const org = await createOrg(ctx, { name: 'Bulk flush' });
      const N = 300; // > the 250-row chunk size, so two statements
      const tag = randomUUID().slice(0, 8);
      await ctx.system.vehicle.createMany({ data: Array.from({ length: N }, (_, i) => ({ organizationId: org.id, registrationNumber: `B${tag}${i}` })) });
      const vehicles = await ctx.system.vehicle.findMany({ where: { organizationId: org.id }, select: { id: true } });
      const base = 700_000_000 + Math.floor(Math.random() * 1_000_000);
      await ctx.system.gpsDevice.createMany({
        data: vehicles.map((v, i) => ({ uniqueId: `BF-${tag}-${i}`, ownerOrganizationId: org.id, currentOrganizationId: org.id, traccarDeviceId: base + i })),
      });
      const devices = await ctx.system.gpsDevice.findMany({ where: { ownerOrganizationId: org.id }, select: { id: true } });
      const now = new Date();
      for (let i = 0; i < N; i++) {
        await store.put({
          vehicleId: vehicles[i]!.id, organizationId: org.id, deviceId: devices[i]!.id, latitude: -1.94 + i * 1e-5, longitude: 30.06, speedKmh: 0, heading: null,
          ignition: null, motion: null, // unknown for EVERY row: Prisma binds an all-null array as integer[]
          lastFixAt: now, lastSeenAt: now, lastFixInvalid: false, lastFixDelayed: false, stationarySince: null, status: 'STATIONARY', statusChangedAt: null, simulated: false,
        });
      }
      try {
        await store.flush();
        const rows = await ctx.system.vehicleLiveState.findMany({ where: { organizationId: org.id } });
        expect(rows).toHaveLength(N);
        expect(rows.every((r) => r.ignition === null && r.motion === null && r.status === 'STATIONARY')).toBe(true);
      } finally {
        // These devices have no engine counterpart: left behind, the reconciliation test would try to register all of them in Traccar.
        await store.resetForTests(org.id);
        await ctx.system.vehicleLiveState.deleteMany({ where: { organizationId: org.id } });
        await ctx.system.gpsDevice.deleteMany({ where: { ownerOrganizationId: org.id } });
        await ctx.system.vehicle.deleteMany({ where: { organizationId: org.id } });
      }
    }, 60_000);

    it('a Redis miss for a new vehicle does not query PostgreSQL when the organization already has live state; only a lost hash is rehydrated, in one bulk read', async () => {
      const t = await tenant('Store NoDb');
      await pipeline.process(position(t.engineId)); // the organization's hash now exists
      await store.flush();
      const tenantPrisma = ctx.app.get(TenantPrismaService);
      const spy = jest.spyOn(tenantPrisma, 'runInOrganization');
      try {
        expect(await store.get(t.orgId, randomUUID())).toBeNull(); // a vehicle with no state yet (e.g. its first position)
        expect(spy).not.toHaveBeenCalled();

        await redis.del(`org:${t.orgId}:live`); // Redis lost the organization
        expect(await store.get(t.orgId, t.vehicleId)).toMatchObject({ vehicleId: t.vehicleId });
        expect(spy).toHaveBeenCalledTimes(1); // one bulk read, not one per vehicle
      } finally {
        spy.mockRestore();
      }
    });

    it('keeps only the 20 most recent samples per vehicle (ring buffer), newest first, and drops them on unassign', async () => {
      const t = await tenant('Ring');
      const base = Date.now();
      for (let i = 0; i < 25; i++) await pipeline.process(position(t.engineId, { latitude: -1.9 - i * 0.00005, fixTime: new Date(base + i * 1000), serverTime: new Date(base + i * 1000) }));
      const recent = await store.recent(t.orgId, t.vehicleId);
      expect(recent).toHaveLength(20);
      expect(recent[0]!.lat).toBeCloseTo(-1.9 - 24 * 0.00005, 6);
      expect(recent[19]!.lat).toBeCloseTo(-1.9 - 5 * 0.00005, 6);
      expect((await http(ctx).post(url(`/devices/${t.deviceId}/unassign`)).set(bearer(t.owner)).send({})).status).toBe(200);
      expect(await store.recent(t.orgId, t.vehicleId)).toEqual([]);
      expect(await store.get(t.orgId, t.vehicleId)).toBeNull();
      expect((await get(`/tracking/vehicles/${t.vehicleId}/location`, t.owner)).body.data).toMatchObject({ location: null, reason: 'NO_DEVICE' });
    });
  });

  describe('offline sweeper (injected clock)', () => {
    it('turns a silent vehicle OFFLINE exactly once, raises one alert only when a rule exists, and never touches fresh vehicles', async () => {
      const t = await tenant('Sweep');
      const fresh = await tenant('Sweep fresh');
      await ctx.system.alertRule.create({ data: { organizationId: t.orgId, type: 'DEVICE_OFFLINE', cooldownSeconds: 0 } });
      await pipeline.process(position(t.engineId));
      await pipeline.process(position(fresh.engineId));
      // (The sweep is global — leftovers from other test runs in the shared Redis may legitimately change — so assert on OUR vehicles.)
      await sweeper.sweep(new Date(Date.now() + 5_000)); // 5 s of silence is far below the 15 s threshold
      expect((await store.get(t.orgId, t.vehicleId))!.status).toBe('MOVING');

      const later = new Date(Date.now() + 60_000); // 60 s of silence for both... but `fresh` hears again right before the sweep
      await pipeline.process(position(fresh.engineId, { fixTime: new Date(Date.now() + 59_000), serverTime: new Date(Date.now() + 59_000) }));
      const changed = await sweeper.sweep(later);
      expect(changed).toBeGreaterThanOrEqual(1);
      expect((await store.get(t.orgId, t.vehicleId))!.status).toBe('OFFLINE');
      expect((await store.get(fresh.orgId, fresh.vehicleId))!.status).not.toBe('OFFLINE');
      expect(await sweeper.sweep(later)).toBe(0); // idempotent: already offline

      const alertsA = await get(`/alerts?vehicleId=${t.vehicleId}`, t.owner);
      expect(alertsA.body.data.map((a: { type: string }) => a.type)).toEqual(['DEVICE_OFFLINE']);
      expect((await get(`/alerts?vehicleId=${fresh.vehicleId}`, fresh.owner)).body.data).toEqual([]); // no rule, no alert
      await store.flush();
      const persisted = await ctx.system.vehicleLiveState.findUnique({ where: { vehicleId: t.vehicleId } });
      expect(persisted!.status).toBe('OFFLINE'); // written through straight away (not on the periodic timer)
    });

    it('a message arriving after an offline sweep brings the vehicle back (and the sweeper never overwrites a newer position)', async () => {
      const t = await tenant('Sweep race');
      await pipeline.process(position(t.engineId));
      const pastTimeout = new Date(Date.now() + 60_000);
      // Sweep and a fresh position race for the same vehicle; whichever runs, the NEW position must survive.
      await Promise.all([
        sweeper.sweep(pastTimeout),
        pipeline.process(position(t.engineId, { latitude: -1.9446, fixTime: new Date(Date.now() + 61_000), serverTime: new Date(Date.now() + 61_000) })),
      ]);
      const s = (await store.get(t.orgId, t.vehicleId))!;
      expect(s.latitude).toBe(-1.9446);
      expect(s.lastSeenAt.getTime()).toBeGreaterThan(Date.now() + 50_000);
    });
  });

  describe('endpoints', () => {
    it('summary counts vehicles with the shared status function, counting assigned-but-silent vehicles as NO_DATA', async () => {
      const t = await tenant('Summary');
      const extraVehicle = await ctx.system.vehicle.create({ data: { organizationId: t.orgId, registrationNumber: `X${randomUUID().slice(0, 6)}` } });
      const extraDevice = await ctx.system.gpsDevice.create({ data: { uniqueId: `LS-${randomUUID().slice(0, 10)}`, ownerOrganizationId: t.orgId, currentOrganizationId: t.orgId } });
      await ctx.system.deviceAssignment.create({ data: { organizationId: t.orgId, deviceId: extraDevice.id, vehicleId: extraVehicle.id } });
      await pipeline.process(position(t.engineId, { speedKmh: 40 }));
      const res = await get('/tracking/summary', t.owner);
      expect(res.body.data.byStatus).toMatchObject({ MOVING: 1, NO_DATA: 1, OFFLINE: 0, IDLING: 0, PARKED: 0, STATIONARY: 0 });
      expect(res.body.data.total).toBe(2);
    });

    it('status-config exposes the thresholds in force', async () => {
      const t = await tenant('Config');
      const res = await get('/tracking/status-config', t.owner);
      expect(res.body.data.thresholds).toEqual({ offlineAfterSec: 15, movingSpeedKmh: 5, idleAfterSec: 6, parkedAfterSec: 10 });
      expect((await http(ctx).get(url('/tracking/status-config'))).status).toBe(401);
    });

    it('positions are paginated, newest first, and read status is derived at request time (OFFLINE even before the sweeper runs)', async () => {
      const t = await tenant('Pages');
      await pipeline.process(position(t.engineId));
      const stale = await store.get(t.orgId, t.vehicleId);
      await store.put({ ...stale!, lastSeenAt: new Date(Date.now() - 60_000), status: 'MOVING' }); // silent for 60 s, stored status still MOVING
      const res = await get('/tracking/positions?page=1&pageSize=1', t.owner);
      expect(res.body.meta).toMatchObject({ page: 1, pageSize: 1, total: 1 });
      expect(res.body.data[0].status).toBe('OFFLINE');
    });
  });

  describe('alert rules and alerts API', () => {
    it('validates rules: overspeed needs a limit, other types take no parameters, cooldown is bounded', async () => {
      const t = await tenant('Rules');
      const post = (b: object) => http(ctx).post(url('/alert-rules')).set(bearer(t.owner)).send(b);
      expect((await post({ type: 'OVERSPEED' })).status).toBe(400);
      expect((await post({ type: 'OVERSPEED', params: { speedLimitKmh: 2 } })).status).toBe(400);
      expect((await post({ type: 'IGNITION_ON', params: { speedLimitKmh: 60 } })).status).toBe(400);
      expect((await post({ type: 'DEVICE_OFFLINE', cooldownSeconds: 999_999 })).status).toBe(400);
      expect((await post({ type: 'GEOFENCE_ENTER' })).status).toBe(400);
      const ok = await post({ type: 'OVERSPEED', params: { speedLimitKmh: 80 } });
      expect(ok.status).toBe(201);
      expect(ok.body.data).toMatchObject({ type: 'OVERSPEED', params: { speedLimitKmh: 80, minDurationSec: 10 }, severity: 'WARNING', cooldownSeconds: 300, enabled: true });
    });

    it('the database also refuses an overspeed rule without a limit', async () => {
      const t = await tenant('Rules DB');
      await expect(ctx.system.alertRule.create({ data: { organizationId: t.orgId, type: 'OVERSPEED', params: {} } })).rejects.toThrow(/overspeed_has_limit|check/i);
    });

    it('rules and alerts are tenant-scoped; permissions are enforced; acknowledging records who and is idempotent', async () => {
      const a = await tenant('Rules A');
      const b = await tenant('Rules B');
      const rule = await http(ctx).post(url('/alert-rules')).set(bearer(a.owner)).send({ type: 'DEVICE_OFFLINE', cooldownSeconds: 0 });
      expect(rule.status).toBe(201);
      expect((await get('/alert-rules', b.owner)).body.data).toEqual([]);
      expect((await http(ctx).patch(url(`/alert-rules/${rule.body.data.id}`)).set(bearer(b.owner)).send({ enabled: false })).status).toBe(404);
      expect((await http(ctx).delete(url(`/alert-rules/${rule.body.data.id}`)).set(bearer(b.owner))).status).toBe(404);

      const viewer = await addMemberAndLogin(ctx, a.orgId, 'VIEWER');
      expect((await http(ctx).post(url('/alert-rules')).set(bearer(viewer)).send({ type: 'IGNITION_ON' })).status).toBe(403);
      expect((await get('/alert-rules', viewer)).status).toBe(200); // read is allowed (alerts.read)

      const ruleRow = await ctx.system.alertRule.findUniqueOrThrow({ where: { id: rule.body.data.id } });
      const alert = await ctx.system.alert.create({ data: { organizationId: a.orgId, vehicleId: a.vehicleId, ruleId: ruleRow.id, type: 'DEVICE_OFFLINE', severity: 'WARNING', startedAt: new Date() } });
      expect((await get('/alerts', b.owner)).body.data).toEqual([]);
      expect((await http(ctx).patch(url(`/alerts/${alert.id}/acknowledge`)).set(bearer(b.owner))).status).toBe(404);
      expect((await http(ctx).patch(url(`/alerts/${alert.id}/acknowledge`)).set(bearer(viewer))).status).toBe(403);
      const ack1 = await http(ctx).patch(url(`/alerts/${alert.id}/acknowledge`)).set(bearer(a.owner));
      expect(ack1.status).toBe(200);
      const ack2 = await http(ctx).patch(url(`/alerts/${alert.id}/acknowledge`)).set(bearer(a.owner));
      expect(ack2.body.data.acknowledgedAt).toBe(ack1.body.data.acknowledgedAt);
      const row = await ctx.system.alert.findUniqueOrThrow({ where: { id: alert.id } });
      expect(row.acknowledgedBy).toBe(a.owner.id);

      await stepUp(ctx, a.owner);
      expect((await http(ctx).delete(url(`/alert-rules/${rule.body.data.id}`)).set(bearer(a.owner))).status).toBe(204);
      expect(await ctx.system.alert.count({ where: { id: alert.id } })).toBe(1); // history kept; only the rule link is cleared
    });
  });

  describe('fleet snapshot (starting point of the live map)', () => {
    it('returns every vehicle of the organization in one response, ordered by registration number, and nothing of another organization', async () => {
      const a = await tenant('Snap A');
      const b = await tenant('Snap B');
      await pipeline.process(position(a.engineId, { latitude: -1.9441 }));
      await pipeline.process(position(b.engineId, { latitude: -1.9999 }));
      const res = await get('/tracking/snapshot', a.owner);
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ total: 1, truncated: false });
      expect(res.body.data.vehicles).toHaveLength(1);
      expect(res.body.data.vehicles[0]).toMatchObject({ vehicleId: a.vehicleId, latitude: -1.9441, simulated: false });
      expect(JSON.stringify(res.body)).not.toContain(b.vehicleId); // another tenant's vehicle is simply not there
    });

    it('requires the live-tracking permission', async () => {
      const t = await tenant('Snap Perm');
      const role = await ctx.system.role.create({ data: { scope: 'ORGANIZATION', key: `NO_LIVE_SNAP_${Date.now()}`, name: 'No live', isSystem: false } });
      const viewer = await addMemberAndLogin(ctx, t.orgId, role.key);
      expect((await get('/tracking/snapshot', viewer)).status).toBe(403);
    });

    it('says when it was cut at the configured limit instead of silently dropping vehicles', async () => {
      const capped = await createTestApp({ TRACKING_SNAPSHOT_LIMIT: '1' });
      try {
        const t = await tenant('Snap Cap');
        const second = await ctx.system.vehicle.create({ data: { organizationId: t.orgId, registrationNumber: `ZZ${randomUUID().slice(0, 6)}` } });
        const device2 = await ctx.system.gpsDevice.create({ data: { uniqueId: `LS-${randomUUID().slice(0, 10)}`, ownerOrganizationId: t.orgId, currentOrganizationId: t.orgId, traccarDeviceId: 610_000_000 + Math.floor(Math.random() * 1_000_000) } });
        await ctx.system.deviceAssignment.create({ data: { organizationId: t.orgId, deviceId: device2.id, vehicleId: second.id } });
        await pipeline.process(position(t.engineId));
        await pipeline.process(position(device2.traccarDeviceId!));
        const res = await http(capped).get(url('/tracking/snapshot')).set(bearer(t.owner));
        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ total: 2, truncated: true });
        expect(res.body.data.vehicles).toHaveLength(1);
      } finally {
        await capped.close();
      }
    }, 60_000);
  });
});
