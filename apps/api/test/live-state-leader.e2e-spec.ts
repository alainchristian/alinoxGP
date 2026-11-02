import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { ENV } from '../src/infrastructure/config/env';
import { TenantPrismaService } from '../src/infrastructure/prisma/prisma.service';
import { REDIS } from '../src/infrastructure/redis/redis.module';
import { parseState, type LiveState } from '../src/modules/live-state/live-state';
import { INGESTION_LEASE_KEY, LiveStateStore } from '../src/modules/live-state/live-state.store';
import { StatusConfigService } from '../src/modules/live-state/status-config.service';
import { OfflineSweeperService } from '../src/modules/tracking/offline-sweeper.service';
import { createOrg, createTestApp, type TestCtx } from './helpers';

/**
 * The ingestion leader owns the latest state in memory; Redis is written in lease-checked batches; a new leader warms up
 * from Redis; the offline sweeper reads a deadline index. Several stores share one Redis and one PostgreSQL here, exactly
 * like several API instances would — an "old leader" and a "new leader" are real, independent objects with real leases.
 */
describe('Leader-owned live state (e2e)', () => {
  let ctx: TestCtx;
  let redis: Redis;
  let tenantPrisma: TenantPrismaService;

  const makeStore = (c: TestCtx = ctx) =>
    new LiveStateStore(c.app.get<Redis>(REDIS), c.app.get(TenantPrismaService), c.app.get(StatusConfigService), c.app.get(ENV));
  const takeLease = (token: string) => redis.set(INGESTION_LEASE_KEY, token);

  interface Tenant { orgId: string; vehicleId: string; deviceId: string }
  async function tenant(name: string): Promise<Tenant> {
    const org = await createOrg(ctx, { name });
    const vehicle = await ctx.system.vehicle.create({ data: { organizationId: org.id, registrationNumber: `LD${randomUUID().slice(0, 8)}` } });
    const device = await ctx.system.gpsDevice.create({
      data: { uniqueId: `LD-${randomUUID().slice(0, 10)}`, ownerOrganizationId: org.id, currentOrganizationId: org.id, traccarDeviceId: 800_000_000 + Math.floor(Math.random() * 1_000_000) },
    });
    return { orgId: org.id, vehicleId: vehicle.id, deviceId: device.id };
  }
  const state = (t: Tenant, over: Partial<LiveState> = {}): LiveState => ({
    vehicleId: t.vehicleId, organizationId: t.orgId, deviceId: t.deviceId, latitude: -1.94, longitude: 30.06, speedKmh: 40, heading: 90, ignition: true, motion: null,
    lastFixAt: new Date(), lastSeenAt: new Date(), lastFixInvalid: false, lastFixDelayed: false, stationarySince: null, status: 'MOVING', statusChangedAt: new Date(), simulated: false, ...over,
  });
  const inRedis = async (t: Tenant) => {
    const raw = await redis.hget(`org:${t.orgId}:live`, t.vehicleId);
    return raw ? parseState(raw) : null;
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    redis = ctx.app.get<Redis>(REDIS);
    tenantPrisma = ctx.app.get(TenantPrismaService);
  }, 60_000);
  afterAll(() => ctx.close());

  it('the leader works from memory: no Redis or database round trip per position, and ONE atomic batched write to Redis', async () => {
    const t = await tenant('Memory');
    const a = makeStore();
    await takeLease('A');
    await a.becomeLeader('A');
    await a.get(t.orgId, t.vehicleId); // loads the (empty) organization once
    const evalSpy = jest.spyOn(redis, 'eval');
    const hget = jest.spyOn(redis, 'hget');
    const hgetall = jest.spyOn(redis, 'hgetall');
    const db = jest.spyOn(tenantPrisma, 'runInOrganization');
    try {
      const base = Date.now();
      for (let i = 0; i < 200; i++) {
        await a.put(state(t, { speedKmh: i, lastSeenAt: new Date(base + i * 1000), lastFixAt: new Date(base + i * 1000) }));
        expect(await a.get(t.orgId, t.vehicleId)).toMatchObject({ speedKmh: i }); // the leader sees its own writes at once
      }
      expect([hget, hgetall, db, evalSpy].map((s) => s.mock.calls.length)).toEqual([0, 0, 0, 0]);
      expect(await a.flushRedis()).toBe(true);
      expect(evalSpy).toHaveBeenCalledTimes(1); // 200 positions, one batch
      expect(await inRedis(t)).toMatchObject({ speedKmh: 199 }); // the newest value won
    } finally {
      jest.restoreAllMocks();
      await a.stepDown(false);
    }
  });

  it('an old leader cannot overwrite the new one: Redis rejects its batch, nothing is written, and it steps down', async () => {
    const t = await tenant('Stale');
    const a = makeStore();
    await takeLease('A');
    await a.becomeLeader('A');
    await a.put(state(t, { speedKmh: 10 }));
    expect(await a.flushRedis()).toBe(true);

    await takeLease('B'); // the lease passes to a new leader
    const b = makeStore();
    await b.becomeLeader('B');
    await b.put(state(t, { speedKmh: 99, lastSeenAt: new Date(Date.now() + 5000) }));
    expect(await b.flushRedis()).toBe(true);

    await a.put(state(t, { speedKmh: 11 })); // the old leader does not know yet
    expect(await a.flushRedis()).toBe(false); // ...Redis tells it
    expect(await inRedis(t)).toMatchObject({ speedKmh: 99 }); // untouched
    expect(a.isLeader).toBe(false);

    await a.put(state(t, { speedKmh: 12 })); // everything after that is refused, not written
    expect(await a.flushRedis()).toBe(true);
    expect(await inRedis(t)).toMatchObject({ speedKmh: 99 });
    await b.stepDown(false);
  });

  it('a new leader warms up with one bulk read from Redis — no database — and continues from the old leader’s state', async () => {
    const t = await tenant('Warm');
    const a = makeStore();
    await takeLease('A');
    await a.becomeLeader('A');
    await a.put(state(t, { speedKmh: 33 }));
    await a.stepDown(true); // graceful: flushes before giving up

    await takeLease('B');
    const b = makeStore();
    const db = jest.spyOn(tenantPrisma, 'runInOrganization');
    try {
      await b.becomeLeader('B');
      expect(await b.get(t.orgId, t.vehicleId)).toMatchObject({ speedKmh: 33, vehicleId: t.vehicleId });
      expect(db).not.toHaveBeenCalled();
    } finally {
      db.mockRestore();
      await b.stepDown(false);
    }
  });

  it('when Redis itself was lost, the new leader rebuilds the organization from PostgreSQL (one read) and writes it back', async () => {
    const t = await tenant('Lost');
    const a = makeStore();
    await takeLease('A');
    await a.becomeLeader('A');
    await a.put(state(t, { speedKmh: 21 }), true);
    await a.stepDown(true); // Redis AND PostgreSQL are written

    await redis.del(`org:${t.orgId}:live`); // Redis loses the organization (and its membership of the index)
    await redis.srem('gps:live:orgs', t.orgId);
    await takeLease('B');
    const b = makeStore();
    await b.becomeLeader('B');
    expect(await b.get(t.orgId, t.vehicleId)).toMatchObject({ speedKmh: 21 });
    expect(await b.flushRedis()).toBe(true);
    expect(await inRedis(t)).toMatchObject({ speedKmh: 21 }); // written back
    await b.stepDown(false);
  });

  it('PostgreSQL saves are one multi-row statement and never move a row backwards, whoever writes late', async () => {
    const t = await tenant('Monotonic');
    const newer = makeStore();
    const older = makeStore();
    const t0 = Date.now();
    await newer.put(state(t, { speedKmh: 70, lastSeenAt: new Date(t0 + 60_000) }));
    await newer.flush();
    await older.put(state(t, { speedKmh: 5, lastSeenAt: new Date(t0) })); // a slow, stale writer
    await older.flush();
    const row = await ctx.system.vehicleLiveState.findUnique({ where: { vehicleId: t.vehicleId } });
    expect(row).toMatchObject({ speedKmh: 70 }); // the stale save changed nothing
  });

  describe('deadline index', () => {
    it('scores a vehicle by the next instant its status could change, and returns it only once that has passed', async () => {
      const t = await tenant('Deadline');
      const a = makeStore();
      await takeLease('A');
      await a.becomeLeader('A');
      const now = new Date();
      // Stopped with ignition on: becomes IDLING after STATUS_IDLE_AFTER_SEC (180 s by default), long before it could go OFFLINE.
      await a.put(state(t, { speedKmh: 0, ignition: true, stationarySince: now, lastSeenAt: now, status: 'STATIONARY' }), false, now);
      await a.flushRedis();
      const due = (afterMs: number) => a.dueForReview(now.getTime() + afterMs).then((d) => d.filter((x) => x.vehicleId === t.vehicleId));
      expect(await due(179_000)).toHaveLength(0);
      expect(await due(180_000)).toHaveLength(1);

      // An already-silent vehicle has nothing left to wait for: it is not in the index at all.
      await a.put(state(t, { lastSeenAt: new Date(now.getTime() - 3_600_000), status: 'OFFLINE' }), false, now);
      expect(await due(10 * 86_400_000)).toHaveLength(0);

      // ...and a removed vehicle leaves the index.
      await a.put(state(t, { speedKmh: 50, lastSeenAt: now }), false, now);
      await a.flushRedis();
      expect(await due(10 * 86_400_000)).toHaveLength(1);
      await a.remove(t.orgId, t.vehicleId);
      expect(await due(10 * 86_400_000)).toHaveLength(0);
      await a.stepDown(false);
    });
  });

  it('a sweep of an organization with 2,000 vehicles makes ONE range query and loads no organization', async () => {
    // The earlier tests of this file left vehicles in the (suite-wide) index; start this one from an empty index and organization list.
    await redis.del('gps:live:deadlines', 'gps:live:orgs');
    const c = await createTestApp(); // its own application, so becoming leader here does not disturb the other tests
    try {
      const t = await tenant('Sweep');
      const store = c.app.get(LiveStateStore);
      const sweeper = c.app.get(OfflineSweeperService);
      const cRedis = c.app.get<Redis>(REDIS);
      await cRedis.set(INGESTION_LEASE_KEY, 'S');
      await store.becomeLeader('S');

      const t0 = new Date();
      await store.put(state(t, { lastSeenAt: t0, lastFixAt: t0, speedKmh: 50 }), false, t0); // the one that will go silent
      const farFuture = new Date(t0.getTime() + 3_600_000);
      for (let i = 0; i < 1999; i++) {
        const fake = { orgId: t.orgId, vehicleId: randomUUID(), deviceId: t.deviceId };
        await store.put(state(fake, { lastSeenAt: farFuture, lastFixAt: farFuture, speedKmh: 50 }), false, t0); // alive and well, deadlines far away
      }
      await store.flushRedis();

      const range = jest.spyOn(cRedis, 'zrangebyscore');
      const hgetall = jest.spyOn(cRedis, 'hgetall');
      const smembers = jest.spyOn(cRedis, 'smembers');
      try {
        const changed = await sweeper.sweep(new Date(t0.getTime() + 601_000)); // just past the default 600 s offline threshold
        expect(changed).toBe(1);
        expect(range).toHaveBeenCalledTimes(1);
        expect([hgetall, smembers].map((s) => s.mock.calls.length)).toEqual([0, 0]);
        expect(await store.get(t.orgId, t.vehicleId)).toMatchObject({ status: 'OFFLINE' });
      } finally {
        jest.restoreAllMocks();
      }
      await store.stepDown(false);
    } finally {
      await c.close();
    }
  }, 60_000);
});
