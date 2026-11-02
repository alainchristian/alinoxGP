import { randomUUID } from 'node:crypto';
import { sendPosition } from '@gps/simulator';
import { GPS_ENGINE, type GpsEnginePort } from '../src/integrations/gps-engine/port';
import { IngestStatsService } from '../src/modules/tracking/ingest-stats.service';
import { IngestionService } from '../src/modules/tracking/ingestion.service';
import {
  addMemberAndLogin,
  bearer,
  createOrg,
  createTestApp,
  http,
  url,
  type TestCtx,
  type TestUser,
} from './helpers';

/**
 * GPS pipeline end-to-end: simulator -> OsmAnd -> REAL Traccar -> WebSocket -> our ingestion -> per-tenant live
 * state -> API. Requires the dev infrastructure (`pnpm infra:up`) and TRACCAR_USER/TRACCAR_PASSWORD.
 * Traccar buffers incoming data for ~3 s to order it, so every position takes ~3-4 s to arrive; tests wait for it.
 */
const OSMAND = process.env['TRACCAR_OSMAND_URL'] ?? 'http://localhost:55055';
const RUN = randomUUID().slice(0, 6).toUpperCase();
const simId = (n: string) => `SIM-T${RUN}-${n}`;

async function eventually<T>(fn: () => Promise<T | undefined | false | null>, what: string, timeoutMs = 20_000): Promise<T> {
  const start = Date.now();
  let last: unknown;
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (e) {
      last = e;
    }
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for: ${what}${last ? ` (last error: ${String(last)})` : ''}`);
    await new Promise((r) => setTimeout(r, 400));
  }
}

describe('GPS pipeline against a real Traccar (e2e)', () => {
  let ctx: TestCtx;
  let engine: GpsEnginePort;
  let stats: IngestStatsService;
  let sandbox: { id: string };
  let owner: TestUser;
  let orgA: { id: string };
  let ownerA: TestUser;
  let orgB: { id: string };
  let ownerB: TestUser;
  let tech: TestUser;
  const createdUniqueIds: string[] = [];

  const api = {
    post: (path: string, user: TestUser, body: object = {}) => http(ctx).post(url(path)).set(bearer(user)).send(body),
    get: (path: string, user: TestUser) => http(ctx).get(url(path)).set(bearer(user)),
  };
  const send = (id: string, extra: Partial<Parameters<typeof sendPosition>[1]> = {}) =>
    sendPosition(OSMAND, { id, latitude: -1.9441, longitude: 30.0619, speedKmh: 37.04, heading: 90, ignition: true, ...extra });
  const counter = async (name: string) => (await stats.all())[name] ?? 0;

  async function newVehicleWithDevice(user: TestUser, name: string, assign = true) {
    const reg = `T${RUN}${name}`.slice(0, 18);
    const vehicle = await api.post('/vehicles', user, { registrationNumber: reg });
    expect(vehicle.status).toBe(201);
    const uniqueId = simId(name);
    createdUniqueIds.push(uniqueId);
    const device = await api.post('/devices', user, { uniqueId });
    expect(device.status).toBe(201);
    if (assign) {
      const a = await api.post(`/devices/${device.body.data.id}/assign`, user, { vehicleId: vehicle.body.data.id });
      expect(a.status).toBe(200);
    }
    return { vehicleId: vehicle.body.data.id as string, deviceId: device.body.data.id as string, uniqueId, reg };
  }
  const location = (user: TestUser, vehicleId: string) => api.get(`/tracking/vehicles/${vehicleId}/location`, user);

  beforeAll(async () => {
    ctx = await createTestApp({ INGESTION_ENABLED: 'true' });
    engine = ctx.app.get<GpsEnginePort>(GPS_ENGINE);
    stats = ctx.app.get(IngestStatsService);
    await stats.reset();

    sandbox = await createOrg(ctx, { name: `Sandbox ${RUN}` });
    await ctx.system.organization.update({ where: { id: sandbox.id }, data: { isSandbox: true } });
    owner = await addMemberAndLogin(ctx, sandbox.id, 'ORG_OWNER');
    orgA = await createOrg(ctx, { name: `Org A ${RUN}` });
    ownerA = await addMemberAndLogin(ctx, orgA.id, 'ORG_OWNER');
    orgB = await createOrg(ctx, { name: `Org B ${RUN}` });
    ownerB = await addMemberAndLogin(ctx, orgB.id, 'ORG_OWNER');
    const platform = await ctx.system.organization.findFirstOrThrow({ where: { type: 'PLATFORM' } });
    tech = await addMemberAndLogin(ctx, platform.id, 'PLATFORM_TECHNICAL_ADMIN');

    await eventually(async () => ctx.app.get(IngestionService).state.streamConnected, 'ingestion leader connected to Traccar', 30_000);
  }, 60_000);

  afterAll(async () => {
    for (const uid of createdUniqueIds) {
      const d = await engine.findDeviceByUniqueId(uid).catch(() => null);
      if (d) await engine.removeDevice(d).catch(() => undefined);
    }
    await ctx.close();
  }, 30_000);

  it('connects to the pinned Traccar and this instance is the ingestion leader', async () => {
    const health = await api.get('/admin/engine/health', tech);
    expect(health.status).toBe(200);
    expect(health.body.data.engine).toMatchObject({ reachable: true, version: '6.16.0' });
    expect(health.body.data.ingestion).toMatchObject({ enabled: true, leader: true, streamConnected: true });
  });

  describe('a registered simulated device shows up for its own organization', () => {
    let v: Awaited<ReturnType<typeof newVehicleWithDevice>>;

    it('registers the device in the platform AND in Traccar, using a neutral engine-side name', async () => {
      v = await newVehicleWithDevice(owner, 'MAIN');
      const dev = await api.get(`/devices/${v.deviceId}`, owner);
      expect(dev.body.data).toMatchObject({ uniqueId: v.uniqueId, engineSyncStatus: 'SYNCED', isSimulated: true, lifecycleStatus: 'REGISTERED', firstSignalAt: null });
      expect(dev.body.data.assignment).toMatchObject({ vehicleId: v.vehicleId, registrationNumber: v.reg });
      const inEngine = await engine.findDeviceByUniqueId(v.uniqueId);
      expect(inEngine).not.toBeNull();
      expect(inEngine!.name).toBe(v.deviceId); // our id, not a customer-chosen name
      expect(JSON.stringify(dev.body)).not.toMatch(/traccar/i); // engine ids and credentials never reach the client
    });

    it('has no location yet and says so honestly', async () => {
      const res = await location(owner, v.vehicleId);
      expect(res.body.data).toMatchObject({ location: null, reason: 'NO_DATA_YET', registrationNumber: v.reg });
    });

    it('a position sent by the simulator through real Traccar appears with correct units and tri-state values', async () => {
      expect((await send(v.uniqueId)).httpStatus).toBe(200);
      const loc = await eventually(async () => (await location(owner, v.vehicleId)).body.data.location, 'first position', 25_000);
      expect(loc).toMatchObject({ vehicleId: v.vehicleId, registrationNumber: v.reg, latitude: -1.9441, longitude: 30.0619, ignition: true, heading: 90, simulated: true, lastFixInvalid: false });
      expect(loc.speedKmh).toBeGreaterThan(36.5); // sent 37.04 km/h -> 20 kn on the wire -> 37.0 km/h out
      expect(loc.speedKmh).toBeLessThan(37.5);
      expect(new Date(loc.lastSeenAt).getTime()).toBeGreaterThan(Date.now() - 60_000);

      const list = await api.get('/tracking/positions', owner);
      expect(list.body.data.map((p: { vehicleId: string }) => p.vehicleId)).toContain(v.vehicleId);
      const dev = await eventually(async () => {
        const d = await api.get(`/devices/${v.deviceId}`, owner);
        return d.body.data.firstSignalAt && d.body.data.lastSeenAt ? d : null;
      }, 'device liveness recorded');
      expect(dev.body.data.firstSignalAt).not.toBeNull();
      // The first usable position proves the device transmits: it leaves REGISTERED by itself and the history says why.
      const active = await eventually(async () => {
        const d = await api.get(`/devices/${v.deviceId}`, owner);
        return d.body.data.lifecycleStatus === 'ACTIVE' ? d : null;
      }, 'device activated by its first signal');
      expect(active.body.data.displayStatus).toBe('Online');
      const history = await api.get(`/devices/${v.deviceId}/history`, owner);
      expect(history.body.data.map((h: { toStatus: string }) => h.toStatus)).toEqual(['ACTIVE', 'REGISTERED']);
      expect(history.body.data[0]).toMatchObject({ fromStatus: 'REGISTERED', byUser: false, reason: 'First GPS signal received' });
    }, 40_000);

    it('"ignition not reported" stays null and is never turned into false', async () => {
      await send(v.uniqueId, { ignition: undefined, time: Date.now() + 5_000, latitude: -1.9445, longitude: 30.0625 });
      const loc = await eventually(async () => {
        const l = (await location(owner, v.vehicleId)).body.data.location;
        return l?.latitude === -1.9445 ? l : null;
      }, 'position without ignition', 25_000);
      expect(loc.ignition).toBeNull();
    }, 40_000);

    it('(0,0) is only a heartbeat: the marker does not jump and the fix is flagged invalid', async () => {
      const before = (await location(owner, v.vehicleId)).body.data.location;
      await send(v.uniqueId, { latitude: 0, longitude: 0, time: Date.now() + 8_000 });
      const after = await eventually(async () => {
        const l = (await location(owner, v.vehicleId)).body.data.location;
        return l?.lastFixInvalid ? l : null;
      }, 'invalid-fix heartbeat', 25_000);
      expect(after.latitude).toBe(before.latitude);
      expect(after.longitude).toBe(before.longitude);
      expect(after.lastFixAt).toBe(before.lastFixAt);
      expect(await counter('heartbeat_invalid')).toBeGreaterThanOrEqual(1);
    }, 40_000);

    it('a position older than the latest never moves the vehicle backwards (out-of-order)', async () => {
      const before = (await location(owner, v.vehicleId)).body.data.location;
      const ooo = await counter('ignored_out_of_order');
      // Traccar stores it (history) but does not push it as "latest"; backfill/re-delivery is also harmless:
      await send(v.uniqueId, { latitude: -1.9, longitude: 30.0, time: Date.now() - 20 * 60_000 });
      await new Promise((r) => setTimeout(r, 5_000));
      const after = (await location(owner, v.vehicleId)).body.data.location;
      expect(after.latitude).toBe(before.latitude);
      expect(after.longitude).toBe(before.longitude);
      expect(await counter('ignored_out_of_order')).toBeGreaterThanOrEqual(ooo);
    }, 30_000);

    it('a fix with a timestamp far in the future is dropped by the engine and does NOT freeze the live feed', async () => {
      await send(v.uniqueId, { latitude: -1.95, longitude: 30.07, time: Date.now() + 2 * 3_600_000 });
      // A normal later position must still arrive (with the default 24 h tolerance it would be silently lost).
      await send(v.uniqueId, { latitude: -1.9462, longitude: 30.0631, time: Date.now() + 12_000 });
      const loc = await eventually(async () => {
        const l = (await location(owner, v.vehicleId)).body.data.location;
        return l?.latitude === -1.9462 ? l : null;
      }, 'position after a future-dated one', 30_000);
      expect(loc.longitude).toBe(30.0631);
    }, 45_000);
  });

  describe('devices that must not reach any tenant', () => {
    it('an unmapped device (known to Traccar, not to the platform) is dropped and counted — never stored', async () => {
      const uid = simId('UNMAPPED');
      createdUniqueIds.push(uid);
      await engine.registerDevice({ uniqueId: uid, name: 'rogue' });
      const before = await counter('dropped_unmapped');
      await send(uid);
      await eventually(async () => (await counter('dropped_unmapped')) > before, 'unmapped counter', 25_000);
      // Nothing in our database refers to it: not a device, not a vehicle state.
      expect(await ctx.system.gpsDevice.count({ where: { uniqueId: uid } })).toBe(0);
      expect(await ctx.system.vehicleLiveState.count({ where: { vehicle: { registrationNumber: uid } } })).toBe(0);
    }, 40_000);

    it('a registered but unassigned device only records that it is alive (onboarding signal)', async () => {
      const v = await newVehicleWithDevice(owner, 'FREE', false);
      const before = await counter('unassigned_device');
      await send(v.uniqueId);
      await eventually(async () => (await counter('unassigned_device')) > before, 'unassigned counter', 25_000);
      const dev = await eventually(async () => {
        const d = await api.get(`/devices/${v.deviceId}`, owner);
        return d.body.data.firstSignalAt ? d : null;
      }, 'first signal recorded');
      expect(dev.body.data.assignment).toBeNull();
      expect((await location(owner, v.vehicleId)).body.data).toMatchObject({ location: null, reason: 'NO_DEVICE' });
    }, 40_000);

    it('a REAL device that claims to be simulated is blocked (simulated flag is never trusted from the wire alone)', async () => {
      const reg = await api.post('/vehicles', ownerA, { registrationNumber: `R${RUN}REAL` });
      const uniqueId = `REAL${RUN}-1`;
      createdUniqueIds.push(uniqueId);
      const dev = await api.post('/devices', ownerA, { uniqueId });
      expect(dev.status).toBe(201);
      expect((await api.post(`/devices/${dev.body.data.id}/assign`, ownerA, { vehicleId: reg.body.data.id })).status).toBe(200);
      const wire = (extra: string, offsetSec = 0) =>
        fetch(`${OSMAND}/?id=${uniqueId}&lat=${extra}&speed=0&timestamp=${Math.floor(Date.now() / 1000) + offsetSec}`);

      // A genuine position is accepted ...
      await wire('-1.9441&lon=30.0619');
      await eventually(async () => (await location(ownerA, reg.body.data.id)).body.data.location, 'genuine position', 25_000);
      // ... one that declares itself simulated (as only the simulator does) is not.
      const blocked = await counter('blocked_simulated');
      await wire('-1.9500&lon=30.0700&simulated=true', 6);
      await eventually(async () => (await counter('blocked_simulated')) > blocked, 'blocked counter', 25_000);
      expect((await location(ownerA, reg.body.data.id)).body.data.location.latitude).toBe(-1.9441);
    }, 60_000);
  });

  describe('tenant isolation of GPS data and devices', () => {
    let v: Awaited<ReturnType<typeof newVehicleWithDevice>>;
    beforeAll(async () => {
      v = await newVehicleWithDevice(owner, 'ISO');
      await send(v.uniqueId);
      await eventually(async () => (await location(owner, v.vehicleId)).body.data.location, 'iso position', 25_000);
    }, 45_000);

    it("another organization cannot see the vehicle, its location or its device (404, no data)", async () => {
      for (const other of [ownerA, ownerB]) {
        expect((await location(other, v.vehicleId)).status).toBe(404);
        expect((await api.get(`/vehicles/${v.vehicleId}`, other)).status).toBe(404);
        const dev = await api.get(`/devices/${v.deviceId}`, other);
        expect(dev.status).toBe(404);
        expect(dev.body.code).toBe('DEVICE_NOT_FOUND');
        expect(JSON.stringify((await api.get('/tracking/positions', other)).body)).not.toContain(v.vehicleId);
        expect((await api.get('/devices', other)).body.data.map((d: { id: string }) => d.id)).not.toContain(v.deviceId);
      }
    });

    it('cannot assign or unassign another organization’s device, or use its vehicle', async () => {
      const mine = await api.post('/vehicles', ownerA, { registrationNumber: `A${RUN}X` });
      expect((await api.post(`/devices/${v.deviceId}/assign`, ownerA, { vehicleId: mine.body.data.id })).status).toBe(404);
      expect((await api.post(`/devices/${v.deviceId}/unassign`, ownerA)).status).toBe(404);
      const myDevice = await api.post('/devices', ownerA, { uniqueId: `A${RUN}-IMEI-1` });
      expect(myDevice.status).toBe(201);
      expect((await api.post(`/devices/${myDevice.body.data.id}/assign`, ownerA, { vehicleId: v.vehicleId })).status).toBe(404);
      // still assigned to the original vehicle
      expect((await api.get(`/devices/${v.deviceId}`, owner)).body.data.assignment.vehicleId).toBe(v.vehicleId);
    });

    it('registering an identifier that already exists elsewhere gives a generic conflict that reveals nothing', async () => {
      // A normal (non-simulated) identifier: simulated ids hit their own, earlier, 422 in non-sandbox organizations.
      const taken = `TAKEN${RUN}-IMEI`;
      createdUniqueIds.push(taken);
      const first = await api.post('/devices', owner, { uniqueId: taken });
      expect(first.status).toBe(201);
      const dup = await api.post('/devices', ownerB, { uniqueId: taken });
      expect(dup.status).toBe(409);
      expect(dup.body.code).toBe('DEVICE_IDENTIFIER_UNAVAILABLE');
      expect(JSON.stringify(dup.body)).not.toMatch(new RegExp(`${sandbox.id}|Sandbox|${first.body.data.id}`));
      const audit = await ctx.system.auditLog.findFirst({ where: { action: 'device.register_conflict', organizationId: orgB.id } });
      expect(audit).not.toBeNull(); // technical administrators can see the attempt
    });

    it('simulated devices cannot be registered by a non-sandbox organization', async () => {
      const res = await api.post('/devices', ownerA, { uniqueId: simId('NOPE') });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('SIMULATED_DEVICE_NOT_ALLOWED');
    });

    it('permissions are enforced: a viewer cannot register devices or create vehicles', async () => {
      const viewer = await addMemberAndLogin(ctx, sandbox.id, 'VIEWER');
      expect((await api.post('/devices', viewer, { uniqueId: simId('V') })).status).toBe(403);
      expect((await api.post('/vehicles', viewer, { registrationNumber: 'ZZZ' })).status).toBe(403);
      expect((await api.get('/devices', viewer)).status).toBe(200);
    });
  });

  describe('reassignment keeps live data correct', () => {
    it('unassigning clears the vehicle’s live state; reassigning routes new positions to the new vehicle only', async () => {
      const first = await newVehicleWithDevice(owner, 'RE1');
      await send(first.uniqueId);
      await eventually(async () => (await location(owner, first.vehicleId)).body.data.location, 'RE1 position', 25_000);

      const un = await api.post(`/devices/${first.deviceId}/unassign`, owner, { reason: 'moved' });
      expect(un.status).toBe(200);
      expect((await location(owner, first.vehicleId)).body.data).toMatchObject({ location: null, reason: 'NO_DEVICE' });

      const second = await api.post('/vehicles', owner, { registrationNumber: `T${RUN}RE2` });
      expect((await api.post(`/devices/${first.deviceId}/assign`, owner, { vehicleId: second.body.data.id })).status).toBe(200);
      await send(first.uniqueId, { latitude: -1.9500, longitude: 30.0700, time: Date.now() + 5_000 });
      const loc = await eventually(async () => (await location(owner, second.body.data.id)).body.data.location, 'RE2 position', 25_000);
      expect(loc.latitude).toBe(-1.95);
      expect((await location(owner, first.vehicleId)).body.data.location).toBeNull();

      // History is preserved: two assignment rows, the first one closed.
      const rows = await ctx.system.deviceAssignment.findMany({ where: { deviceId: first.deviceId }, orderBy: { assignedAt: 'asc' } });
      expect(rows).toHaveLength(2);
      expect(rows[0]!.unassignedAt).not.toBeNull();
      expect(rows[1]!.unassignedAt).toBeNull();
    }, 70_000);

    it('refuses to double-assign a device or a vehicle and to delete a vehicle that carries a device', async () => {
      const a = await newVehicleWithDevice(owner, 'DBL');
      const other = await api.post('/vehicles', owner, { registrationNumber: `T${RUN}DB2` });
      const dupDevice = await api.post(`/devices/${a.deviceId}/assign`, owner, { vehicleId: other.body.data.id });
      expect(dupDevice.status).toBe(409);
      expect(dupDevice.body.code).toBe('DEVICE_ALREADY_ASSIGNED');
      const d2 = await api.post('/devices', owner, { uniqueId: simId('DBL2') });
      createdUniqueIds.push(simId('DBL2'));
      const dupVehicle = await api.post(`/devices/${d2.body.data.id}/assign`, owner, { vehicleId: a.vehicleId });
      expect(dupVehicle.status).toBe(409);
      expect(dupVehicle.body.code).toBe('VEHICLE_ALREADY_HAS_DEVICE');
      const del = await http(ctx).delete(url(`/vehicles/${a.vehicleId}`)).set(bearer(owner));
      expect(del.status).toBe(409);
      expect(del.body.code).toBe('VEHICLE_HAS_DEVICE');
    }, 30_000);

    it('vehicle registration numbers are unique per organization, case-insensitively, but not across organizations', async () => {
      const reg = `T${RUN}CASE`;
      expect((await api.post('/vehicles', owner, { registrationNumber: reg })).status).toBe(201);
      const dup = await api.post('/vehicles', owner, { registrationNumber: reg.toLowerCase() });
      expect(dup.status).toBe(409);
      expect(dup.body.code).toBe('VEHICLE_REGISTRATION_TAKEN');
      expect((await api.post('/vehicles', ownerA, { registrationNumber: reg })).status).toBe(201);
    });
  });

  describe('platform administration of the engine integration', () => {
    it('customers cannot read engine diagnostics; technical administrators can, and it exposes no customer data', async () => {
      expect((await api.get('/admin/engine/health', owner)).status).toBe(403);
      expect((await api.post('/admin/engine/reconcile', owner)).status).toBe(403);
      const health = await api.get('/admin/engine/health', tech);
      expect(health.status).toBe(200);
      expect(health.body.data.stats.accepted).toBeGreaterThan(0);
      expect(health.body.data.devices.simulated).toBeGreaterThan(0);
      expect(JSON.stringify(health.body)).not.toMatch(/latitude|longitude|-1\.94/);
    });

    it('reconciliation reports devices unknown to the platform but NEVER deletes them, and registers pending ones', async () => {
      const rogue = simId('ROGUE');
      createdUniqueIds.push(rogue);
      await engine.registerDevice({ uniqueId: rogue, name: 'rogue-2' });

      // A device registered while the engine was unreachable stays PENDING (registration is not lost).
      const down = await createTestApp({ TRACCAR_URL: 'http://127.0.0.1:1' });
      const pendingId = simId('PEND');
      createdUniqueIds.push(pendingId);
      const created = await http(down).post(url('/devices')).set(bearer(owner)).send({ uniqueId: pendingId });
      expect(created.status).toBe(201);
      expect(created.body.data.engineSyncStatus).toBe('PENDING');
      expect((await http(down).get(url('/vehicles')).set(bearer(owner))).status).toBe(200); // the rest of the app keeps working
      const health = await http(down).get(url('/admin/engine/health')).set(bearer(tech));
      expect(health.body.data.engine.reachable).toBe(false);
      await down.close();

      const report = await api.post('/admin/engine/reconcile', tech);
      expect(report.status).toBe(200);
      expect(report.body.data.repaired).toContain(pendingId);
      expect(report.body.data.unknownToPlatform.map((d: { uniqueId: string }) => d.uniqueId)).toContain(rogue);
      expect(await engine.findDeviceByUniqueId(rogue)).not.toBeNull(); // not deleted
      expect(await engine.findDeviceByUniqueId(pendingId)).not.toBeNull(); // now registered
      const synced = await ctx.system.gpsDevice.findUniqueOrThrow({ where: { uniqueId: pendingId } });
      expect(synced.engineSyncStatus).toBe('SYNCED');
      expect(synced.traccarDeviceId).not.toBeNull();
    }, 60_000);

    it('registration is idempotent in the engine: re-syncing an already registered device changes nothing', async () => {
      const v = await newVehicleWithDevice(owner, 'IDEM', false);
      const before = await ctx.system.gpsDevice.findUniqueOrThrow({ where: { id: v.deviceId } });
      const again = await api.post(`/devices/${v.deviceId}/sync`, owner);
      expect(again.status).toBe(200);
      expect(again.body.data.engineSyncStatus).toBe('SYNCED');
      const after = await ctx.system.gpsDevice.findUniqueOrThrow({ where: { id: v.deviceId } });
      expect(after.traccarDeviceId).toBe(before.traccarDeviceId);
      const all = (await engine.listDevices()).filter((d) => d.uniqueId === v.uniqueId);
      expect(all).toHaveLength(1);
    }, 30_000);
  });

  describe('single consumer and failover', () => {
    it('a second API instance does not consume while the first leads, and takes over (with backfill) when it stops', async () => {
      const second = await createTestApp({ INGESTION_ENABLED: 'true' });
      try {
        await new Promise((r) => setTimeout(r, 6_500)); // > one election tick
        expect(second.app.get(IngestionService).state.leader).toBe(false);
        expect(ctx.app.get(IngestionService).state.leader).toBe(true);

        // A vehicle that exists BEFORE the failover.
        const gapVeh = await http(ctx).post(url('/vehicles')).set(bearer(owner)).send({ registrationNumber: `T${RUN}GAP` });
        const gapUid = simId('GAP');
        createdUniqueIds.push(gapUid);
        const gapDev = await http(ctx).post(url('/devices')).set(bearer(owner)).send({ uniqueId: gapUid });
        await http(ctx).post(url(`/devices/${gapDev.body.data.id}/assign`)).set(bearer(owner)).send({ vehicleId: gapVeh.body.data.id });

        // Fail over: the leader shuts down gracefully (releases the lease)...
        await ctx.close();
        // ...and a position arrives while NO instance is consuming. It must not be lost.
        await send(gapUid, { latitude: -1.9470, longitude: 30.0640 });
        await eventually(async () => second.app.get(IngestionService).state.leader && second.app.get(IngestionService).state.streamConnected, 'second instance became leader', 25_000);

        // Nothing was lost: the position from the gap is visible through the new leader (backfill or stream, whichever delivered it)...
        const gapLoc = await eventually(async () => (await http(second).get(url(`/tracking/vehicles/${gapVeh.body.data.id}/location`)).set(bearer(owner))).body.data.location, 'the position sent during the leadership gap', 30_000);
        expect(gapLoc.latitude).toBe(-1.9470);

        // ...and live positions flow through the new leader.
        const v = { vehicleId: gapVeh.body.data.id as string, uid: gapUid };
        await send(v.uid, { latitude: -1.9477, longitude: 30.0644 });
        const loc = await eventually(async () => {
          const l = (await http(second).get(url(`/tracking/vehicles/${v.vehicleId}/location`)).set(bearer(owner))).body.data.location;
          return l?.latitude === -1.9477 ? l : null; // wait for the LIVE position, not the one from the gap
        }, 'live position via the new leader', 30_000);
        expect(loc.latitude).toBe(-1.9477);
      } finally {
        await second.close();
        // `ctx` is already closed; afterAll closes it again safely.
        ctx = await createTestApp();
        engine = ctx.app.get<GpsEnginePort>(GPS_ENGINE);
      }
    }, 90_000);
  });
});
