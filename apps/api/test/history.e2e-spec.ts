import { randomUUID } from 'node:crypto';
import { sendPosition } from '@gps/simulator';
import type { RouteDto, TripListDto } from '@gps/shared';
import { GPS_ENGINE, type GpsEnginePort } from '../src/integrations/gps-engine/port';
import {
  addMemberAndLogin,
  bearer,
  createOrg,
  createTestApp,
  ensureTestProvider,
  http,
  url,
  type TestCtx,
  type TestUser,
} from './helpers';

/**
 * Trip history and route playback against a REAL Traccar (M6a): the simulator drives a vehicle in the past, Traccar
 * stores and analyses it, and the API answers through the engine port. Also the isolation rules of history: another
 * organization's vehicle is a 404, a moved tracker never reveals the other vehicle's movements, ranges are bounded.
 */
const OSMAND = process.env['TRACCAR_OSMAND_URL'] ?? 'http://localhost:55055';
const RUN = randomUUID().slice(0, 6).toUpperCase();
const MIN = 60_000;

async function eventually<T>(fn: () => Promise<T | undefined | false | null>, what: string, timeoutMs = 40_000): Promise<T> {
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
    await new Promise((r) => setTimeout(r, 800));
  }
}

describe('Trip history and route playback (e2e, real Traccar)', () => {
  let ctx: TestCtx;
  let engine: GpsEnginePort;
  let org: { id: string };
  let owner: TestUser;
  let other: TestUser;
  let viewer: TestUser;
  let driver: TestUser;
  let vehicleA: string; // the vehicle that drove
  let vehicleB: string; // gets the same tracker after the drive
  let uniqueId: string;
  let deviceId: string;
  let tDrive: number; // start of the drive (epoch ms)
  let tSwap: number; // the tracker moves from vehicle A to vehicle B
  const created: string[] = [];

  const get = (path: string, user: TestUser, org?: string) => http(ctx).get(url(path)).set(org ? { ...bearer(user), 'X-Organization-Id': org } : bearer(user));
  const q = (from: number, to: number) => `from=${encodeURIComponent(new Date(from).toISOString())}&to=${encodeURIComponent(new Date(to).toISOString())}`;
  const route = (vehicleId: string, from: number, to: number, user = owner) => get(`/vehicles/${vehicleId}/route?${q(from, to)}`, user);
  const trips = (vehicleId: string, from: number, to: number, user = owner) => get(`/vehicles/${vehicleId}/trips?${q(from, to)}`, user);

  beforeAll(async () => {
    ctx = await createTestApp();
    engine = ctx.app.get<GpsEnginePort>(GPS_ENGINE);
    const sandbox = await createOrg(ctx, { name: `History ${RUN}` });
    await ctx.system.organization.update({ where: { id: sandbox.id }, data: { isSandbox: true } });
    org = sandbox;
    owner = await addMemberAndLogin(ctx, org.id, 'ORG_OWNER');
    viewer = await addMemberAndLogin(ctx, org.id, 'VIEWER');
    driver = await addMemberAndLogin(ctx, org.id, 'DRIVER');
    const otherOrg = await createOrg(ctx, { name: `History other ${RUN}` });
    other = await addMemberAndLogin(ctx, otherOrg.id, 'ORG_OWNER');

    vehicleA = (await ctx.system.vehicle.create({ data: { organizationId: org.id, registrationNumber: `HA${RUN}` } })).id;
    vehicleB = (await ctx.system.vehicle.create({ data: { organizationId: org.id, registrationNumber: `HB${RUN}` } })).id;
    uniqueId = `SIM-H${RUN}`;
    created.push(uniqueId);
    const dev = await http(ctx).post(url('/devices')).set(bearer(owner)).send({ uniqueId });
    expect(dev.status).toBe(201);
    deviceId = dev.body.data.id;

    // The tracker was on vehicle A for the first 14 minutes of the timeline, then on vehicle B.
    const now = Date.now();
    tDrive = now - 50 * MIN;
    tSwap = tDrive + 14 * MIN;
    await ctx.system.deviceAssignment.create({ data: { organizationId: org.id, deviceId, vehicleId: vehicleA, assignedAt: new Date(tDrive - 5 * MIN), unassignedAt: new Date(tSwap) } });
    await ctx.system.deviceAssignment.create({ data: { organizationId: org.id, deviceId, vehicleId: vehicleB, assignedAt: new Date(tSwap) } });

    // 12 minutes of driving east at 40 km/h (a fix every 36 s), then 12 minutes parked (a fix every 72 s). All in the past, in order.
    const metresPerDegreeLon = 111_320 * Math.cos((1.9441 * Math.PI) / 180);
    const step = (40 / 3.6) * 36;
    let lon = 30.0619;
    let t = tDrive;
    for (let i = 0; i < 20; i++) {
      await sendPosition(OSMAND, { id: uniqueId, latitude: -1.9441, longitude: lon, speedKmh: 40, heading: 90, ignition: true, time: t });
      lon += step / metresPerDegreeLon;
      t += 36_000;
    }
    for (let i = 0; i < 10; i++) {
      await sendPosition(OSMAND, { id: uniqueId, latitude: -1.9441, longitude: lon, speedKmh: 0, heading: 90, ignition: false, time: t });
      t += 72_000;
    }
  }, 120_000);

  afterAll(async () => {
    for (const uid of created) {
      const d = await engine.findDeviceByUniqueId(uid).catch(() => null);
      if (d) await engine.removeDevice(d).catch(() => undefined);
    }
    await ctx.close();
  }, 30_000);

  it('returns the route of the period the tracker was on the vehicle, in order, with km/h and tri-state ignition', async () => {
    const res = await eventually(async () => {
      const r = await route(vehicleA, tDrive - 10 * MIN, tSwap + 60_000);
      return r.status === 200 && (r.body.data as RouteDto).points.length >= 18 ? r : null;
    }, 'route points from Traccar');
    const data = res.body.data as RouteDto;
    expect(data.simulated).toBe(true);
    expect(data.engineUnavailable).toBe(false);
    const times = data.points.map((p) => p.t);
    expect([...times].sort()).toEqual(times);
    expect(data.points[0]).toMatchObject({ latitude: -1.9441, ignition: true });
    expect(data.points[0]!.speedKmh).toBeGreaterThan(39);
    expect(data.points[0]!.speedKmh).toBeLessThan(41);
    expect(data.points[data.points.length - 1]!.longitude).toBeGreaterThan(data.points[0]!.longitude);
    // Nothing from after the tracker left this vehicle.
    expect(Math.max(...times.map((t) => Date.parse(t)))).toBeLessThanOrEqual(tSwap);
    expect(data.window.coverage).toEqual([{ from: new Date(tDrive - 10 * MIN).toISOString().replace(/.*/, (s) => s), to: new Date(tSwap).toISOString() }].map((c) => ({ from: expect.any(String), to: c.to })));
  });

  it('a moved tracker never reveals the other vehicle’s movements (and vice versa)', async () => {
    const a = (await route(vehicleA, tDrive - 10 * MIN, tDrive + 40 * MIN)).body.data as RouteDto;
    const b = (await route(vehicleB, tDrive - 10 * MIN, tDrive + 40 * MIN)).body.data as RouteDto;
    expect(a.points.length).toBeGreaterThan(0);
    expect(b.points.length).toBeGreaterThan(0);
    expect(a.points.every((p) => Date.parse(p.t) <= tSwap)).toBe(true);
    expect(b.points.every((p) => Date.parse(p.t) >= tSwap)).toBe(true);
    expect(a.points.length + b.points.length).toBeGreaterThanOrEqual(28); // 30 sent; the fixes exactly at the swap may fall to either side
    expect(b.window.coverage).toHaveLength(1);
    expect(Date.parse(b.window.coverage[0]!.from)).toBe(tSwap);
  });

  it('lists the journey Traccar detected, with distance, speeds and a stop', async () => {
    const res = await eventually(async () => {
      const r = await trips(vehicleA, tDrive - 10 * MIN, tSwap + 60_000);
      return r.status === 200 && (r.body.data as TripListDto).trips.length >= 1 ? r : null;
    }, 'a trip detected by Traccar', 60_000);
    const data = res.body.data as TripListDto;
    const trip = data.trips[0]!;
    expect(trip.distanceKm).toBeGreaterThan(2); // 40 km/h for ~11 minutes (the swap cuts the window; the trip starts inside it)
    expect(trip.distanceKm).toBeLessThan(10);
    expect(trip.maxSpeedKmh).toBeGreaterThan(38);
    expect(trip.maxSpeedKmh).toBeLessThan(42);
    expect(trip.durationSec).toBeGreaterThan(300);
    expect(trip.start).not.toBeNull();
    expect(Date.parse(trip.startTime)).toBeGreaterThanOrEqual(tDrive - 1000);
    expect(data.engineUnavailable).toBe(false);
  });

  it('lists the parked period the engine detected, with where it was (proves the real stop-report shape is understood)', async () => {
    const res = await eventually(async () => {
      const r = await trips(vehicleB, tSwap - MIN, tDrive + 40 * MIN);
      return r.status === 200 && (r.body.data as TripListDto).stops.length >= 1 ? r : null;
    }, 'a stop detected by Traccar', 60_000);
    const stop = (res.body.data as TripListDto).stops[0]!;
    expect(stop.durationSec).toBeGreaterThan(240);
    expect(stop.place).not.toBeNull();
    expect(stop.place!.latitude).toBeCloseTo(-1.9441, 3);
    expect(Date.parse(stop.startTime)).toBeGreaterThanOrEqual(tSwap - 1000);
  });

  it('another organization’s vehicle is a 404 on both endpoints; its own vehicle without a tracker has no history, honestly', async () => {
    expect((await route(vehicleA, tDrive, tDrive + 20 * MIN, other)).status).toBe(404);
    expect((await trips(vehicleA, tDrive, tDrive + 20 * MIN, other)).status).toBe(404);
    const lonely = await ctx.system.vehicle.create({ data: { organizationId: org.id, registrationNumber: `HL${RUN}` } });
    const r = (await route(lonely.id, tDrive, tDrive + 20 * MIN)).body.data as RouteDto;
    expect(r.points).toEqual([]);
    expect(r.window.coverage).toEqual([]); // "no tracker then", not "parked"
  });

  it('permissions: a viewer may look, a driver may not see the route; unauthenticated is refused', async () => {
    expect((await route(vehicleA, tDrive, tDrive + 20 * MIN, viewer)).status).toBe(200);
    expect((await trips(vehicleA, tDrive, tDrive + 20 * MIN, viewer)).status).toBe(200);
    expect((await route(vehicleA, tDrive, tDrive + 20 * MIN, driver)).status).toBe(403);
    expect((await http(ctx).get(url(`/vehicles/${vehicleA}/route?${q(tDrive, tDrive + MIN)}`))).status).toBe(401);
  });

  it('bounds every request: too long a range, an inverted range and missing parameters are refused with a stable code', async () => {
    const tooLongRoute = await route(vehicleA, Date.now() - 9 * 86_400_000, Date.now());
    expect(tooLongRoute.status).toBe(422);
    expect(tooLongRoute.body.code).toBe('HISTORY_RANGE_TOO_LARGE');
    const tooLongTrips = await trips(vehicleA, Date.now() - 32 * 86_400_000, Date.now());
    expect(tooLongTrips.status).toBe(422);
    expect((await route(vehicleA, tDrive + MIN, tDrive)).status).toBe(400);
    expect((await get(`/vehicles/${vehicleA}/route`, owner)).status).toBe(400);
    expect((await get('/vehicles/not-a-uuid/route?from=2026-01-01&to=2026-01-02', owner)).status).toBe(400);
  });

  it('keeps history for the configured period only and says when it narrowed the range', async () => {
    const old = (await trips(vehicleA, Date.now() - 40 * 86_400_000, Date.now() - 20 * 86_400_000)).body.data as TripListDto;
    expect(old.window.clippedToHistoryPeriod).toBe(true);
    expect(old.window.historyDays).toBe(30);
    expect(Date.parse(old.window.from)).toBeGreaterThanOrEqual(Date.now() - 30 * 86_400_000 - 5000);
    const wayBack = (await route(vehicleA, Date.now() - 100 * 86_400_000, Date.now() - 95 * 86_400_000)).body.data as RouteDto;
    expect(wayBack.points).toEqual([]);
    expect(wayBack.window.clippedToHistoryPeriod).toBe(true);
    const inside = (await trips(vehicleA, tDrive, tDrive + 10 * MIN)).body.data as TripListDto;
    expect(inside.window.clippedToHistoryPeriod).toBe(false);
  });

  it('provider staff can read a customer’s history, and it is written to the customer’s access log', async () => {
    const provider = await ensureTestProvider(ctx);
    const staff = await addMemberAndLogin(ctx, provider.id, 'PROVIDER_OPERATIONS');
    // Without naming the customer the request is for the provider's own organization, where staff hold no tracking permission.
    expect((await route(vehicleA, tDrive, tDrive + 20 * MIN, staff)).status).toBe(403);
    const acting = await get(`/vehicles/${vehicleA}/route?${q(tDrive, tDrive + 20 * MIN)}`, staff, org.id);
    expect(acting.status).toBe(200);
    const log = await get(`/organizations/${org.id}/access-log`, owner);
    expect(log.body.data.some((e: { area: string }) => e.area === 'vehicles')).toBe(true);
    const tech = await addMemberAndLogin(ctx, provider.id, 'PROVIDER_TECHNICIAN');
    expect((await get(`/vehicles/${vehicleA}/route?${q(tDrive, tDrive + 20 * MIN)}`, tech, org.id)).status).toBe(403); // technicians do not see tracking data
  });
});

describe('History when the tracking engine is unreachable (e2e)', () => {
  let ctx: TestCtx;
  beforeAll(async () => {
    ctx = await createTestApp({ TRACCAR_URL: 'http://127.0.0.1:1', INGESTION_ENABLED: 'false', WORKERS_ENABLED: 'false' });
  });
  afterAll(() => ctx.close());

  it('answers 200 with an explicit "unknown" flag instead of an empty history that looks like nothing happened', async () => {
    const org = await createOrg(ctx, { name: `Down ${RUN}` });
    const owner = await addMemberAndLogin(ctx, org.id, 'ORG_OWNER');
    const vehicle = await ctx.system.vehicle.create({ data: { organizationId: org.id, registrationNumber: `HD${RUN}` } });
    const device = await ctx.system.gpsDevice.create({ data: { uniqueId: `DOWN-${RUN}`, ownerOrganizationId: org.id, currentOrganizationId: org.id, traccarDeviceId: 987_654 } });
    await ctx.system.deviceAssignment.create({ data: { organizationId: org.id, deviceId: device.id, vehicleId: vehicle.id, assignedAt: new Date(Date.now() - 3600_000) } });
    const from = new Date(Date.now() - 1800_000).toISOString();
    const to = new Date().toISOString();
    const r = await http(ctx).get(url(`/vehicles/${vehicle.id}/route?from=${from}&to=${to}`)).set(bearer(owner));
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ engineUnavailable: true, points: [] });
    const t = await http(ctx).get(url(`/vehicles/${vehicle.id}/trips?from=${from}&to=${to}`)).set(bearer(owner));
    expect(t.body.data).toMatchObject({ engineUnavailable: true, trips: [], stops: [] });
  });
});
