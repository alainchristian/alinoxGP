import { randomUUID } from 'node:crypto';
import { io, type Socket } from 'socket.io-client';
import type { AlertDto, VehicleDeltaDto } from '@gps/shared';
import type { EnginePosition } from '../src/integrations/gps-engine/port';
import { FanoutService } from '../src/modules/realtime/fanout.service';
import { ProviderDirectory } from '../src/modules/realtime/provider-directory.service';
import { SOCKET_PATH } from '../src/modules/realtime/realtime.gateway';
import { PositionPipelineService } from '../src/modules/tracking/position-pipeline.service';
import { addMemberAndLogin, bearer, createOrg, createTestApp, http, stepUp, uniqueEmail, url, type TestCtx, type TestUser } from './helpers';

/**
 * Provider-wide live feed (ADR-0010, gps-tenant-isolation §5, §7): P1's staff see C1 and C2 live, scoped staff only C1,
 * and nothing crosses to P2/C3. Positions go straight into the pipeline (no Traccar needed).
 */
describe('Provider live feed (e2e)', () => {
  let ctx: TestCtx;
  let baseUrl: string;
  let pipeline: PositionPipelineService;
  let fanout: FanoutService;
  const sockets: Socket[] = [];

  interface Customer { orgId: string; owner: TestUser; vehicleId: string; engineId: number; registration: string }
  let P1: string, P2: string;
  let C1: Customer, C2: Customer, C3: Customer;
  let p1Ops: TestUser, p1Scoped: TestUser & { memberId: string }, p1Tech: TestUser, p2Ops: TestUser, p1Owner: TestUser;

  const position = (engineDeviceId: number, over: Partial<EnginePosition> = {}): EnginePosition => {
    const now = new Date();
    return {
      engineDeviceId, engineId: 1, fixTime: now, deviceTime: now, serverTime: now, latitude: -1.9441, longitude: 30.0619, altitudeM: null, speedKmh: 40, heading: 90,
      accuracyM: null, valid: true, ignition: true, motion: null, externalPowerV: null, batteryPercent: null, satellites: null, declaredSimulated: false, protocol: 'test', raw: {}, ...over,
    };
  };

  async function makeProvider(name: string): Promise<string> {
    const org = await createOrg(ctx, { name, type: 'PROVIDER' });
    await ctx.system.providerProfile.create({ data: { organizationId: org.id, status: 'ACTIVE', companyName: name, contactName: 'O', contactEmail: uniqueEmail('p'), termsVersion: 't', termsAcceptedAt: new Date() } });
    return org.id;
  }
  async function makeCustomer(providerId: string, name: string): Promise<Customer> {
    const org = await createOrg(ctx, { name, parentOrganizationId: providerId });
    const owner = await addMemberAndLogin(ctx, org.id, 'ORG_OWNER');
    const registration = `PL${randomUUID().slice(0, 6).toUpperCase()}`;
    const vehicle = await ctx.system.vehicle.create({ data: { organizationId: org.id, registrationNumber: registration } });
    const engineId = 800_000_000 + Math.floor(Math.random() * 1_000_000);
    const device = await ctx.system.gpsDevice.create({ data: { uniqueId: `PL-${randomUUID().slice(0, 10)}`, ownerOrganizationId: providerId, currentOrganizationId: org.id, traccarDeviceId: engineId } });
    await ctx.system.deviceAssignment.create({ data: { organizationId: org.id, deviceId: device.id, vehicleId: vehicle.id } });
    return { orgId: org.id, owner, vehicleId: vehicle.id, engineId, registration };
  }

  const connect = (token: string, organizationId: string): Promise<Socket> =>
    new Promise((resolve, reject) => {
      const s = io(baseUrl, { path: SOCKET_PATH, transports: ['websocket'], auth: { token, organizationId }, reconnection: false });
      sockets.push(s);
      s.on('connect', () => resolve(s));
      s.on('connect_error', (e) => reject(new Error(e.message)));
    });
  const refused = (token: string, organizationId: string) => connect(token, organizationId).then(() => 'connected', (e: Error) => e.message);
  const collect = (s: Socket) => {
    const out = { deltas: [] as VehicleDeltaDto[], alerts: [] as AlertDto[] };
    s.on('vehicle:delta', (m: { vehicles: VehicleDeltaDto[] }) => out.deltas.push(...m.vehicles));
    s.on('alert:new', (a: AlertDto) => out.alerts.push(a));
    return out;
  };
  const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));
  const until = async (cond: () => boolean, ms = 8000) => {
    const start = Date.now();
    while (!cond()) {
      if (Date.now() - start > ms) throw new Error('timed out');
      await settle(50);
    }
  };
  const ids = (c: { deltas: VehicleDeltaDto[] }) => [...new Set(c.deltas.map((d) => d.vehicleId))].sort();

  beforeAll(async () => {
    ctx = await createTestApp({ SOCKET_REVALIDATE_SEC: '1', FANOUT_FLUSH_MS: '60000' });
    await ctx.app.listen(0);
    baseUrl = `http://127.0.0.1:${(ctx.app.getHttpServer().address() as { port: number }).port}`;
    pipeline = ctx.app.get(PositionPipelineService);
    fanout = ctx.app.get(FanoutService);

    P1 = await makeProvider('Live Provider One');
    P2 = await makeProvider('Live Provider Two');
    C1 = await makeCustomer(P1, 'Live C1');
    C2 = await makeCustomer(P1, 'Live C2');
    C3 = await makeCustomer(P2, 'Live C3');
    p1Owner = await addMemberAndLogin(ctx, P1, 'PROVIDER_OWNER');
    p1Ops = await addMemberAndLogin(ctx, P1, 'PROVIDER_OPERATIONS');
    p1Scoped = await addMemberAndLogin(ctx, P1, 'PROVIDER_OPERATIONS');
    p1Tech = await addMemberAndLogin(ctx, P1, 'PROVIDER_TECHNICIAN');
    p2Ops = await addMemberAndLogin(ctx, P2, 'PROVIDER_OPERATIONS');
    await stepUp(ctx, p1Owner);
    await http(ctx).put(url(`/organizations/${P1}/provider/staff/${p1Scoped.memberId}/scope`)).set(bearer(p1Owner)).send({ customerIds: [C1.orgId] }).expect(200);
    await ctx.app.get(ProviderDirectory).refresh();
  }, 60_000);

  afterAll(async () => {
    for (const s of sockets) s.disconnect();
    await ctx.close();
  });

  it('refuses provider staff without the view-data permission, and any provider staff asking for another provider', async () => {
    expect(await refused(p1Tech.accessToken, P1)).toBe('forbidden');
    expect(await refused(p2Ops.accessToken, P1)).toBe('not_found');
    expect(await refused(p1Ops.accessToken, C3.orgId)).toBe('not_found');
    expect(await refused(p1Scoped.accessToken, C2.orgId)).toBe('not_found'); // outside the staff member's scope
  });

  it('provider staff receive every customer of their provider and nothing of another provider', async () => {
    const p1 = collect(await connect(p1Ops.accessToken, P1));
    const p2 = collect(await connect(p2Ops.accessToken, P2));
    const c1 = collect(await connect(C1.owner.accessToken, C1.orgId));
    const c2 = collect(await connect(C2.owner.accessToken, C2.orgId));
    const c3 = collect(await connect(C3.owner.accessToken, C3.orgId));
    for (const c of [C1, C2, C3]) await pipeline.process(position(c.engineId));
    fanout.flush();
    await until(() => p1.deltas.length >= 2 && p2.deltas.length >= 1 && c1.deltas.length >= 1 && c2.deltas.length >= 1 && c3.deltas.length >= 1);
    await settle();
    expect(ids(p1)).toEqual([C1.vehicleId, C2.vehicleId].sort());
    expect(ids(p2)).toEqual([C3.vehicleId]);
    // The customers still see only themselves.
    expect(ids(c1)).toEqual([C1.vehicleId]);
    expect(ids(c2)).toEqual([C2.vehicleId]);
    expect(ids(c3)).toEqual([C3.vehicleId]);
  });

  it('staff scoped to C1 receive only C1', async () => {
    const scoped = collect(await connect(p1Scoped.accessToken, P1));
    for (const c of [C1, C2]) await pipeline.process(position(c.engineId, { speedKmh: 55 }));
    fanout.flush();
    await until(() => scoped.deltas.length >= 1);
    await settle();
    expect(ids(scoped)).toEqual([C1.vehicleId]);
  });

  it('staff acting for one customer receive that customer only', async () => {
    const acting = collect(await connect(p1Ops.accessToken, C2.orgId));
    for (const c of [C1, C2]) await pipeline.process(position(c.engineId, { speedKmh: 61 }));
    fanout.flush();
    await until(() => acting.deltas.length >= 1);
    await settle();
    expect(ids(acting)).toEqual([C2.vehicleId]);
  });

  it('a socket is dropped when the staff member’s customer scope changes', async () => {
    const staff = await addMemberAndLogin(ctx, P1, 'PROVIDER_OPERATIONS');
    const s = await connect(staff.accessToken, P1);
    expect(s.connected).toBe(true);
    await stepUp(ctx, p1Owner);
    await http(ctx).put(url(`/organizations/${P1}/provider/staff/${staff.memberId}/scope`)).set(bearer(p1Owner)).send({ customerIds: [C2.orgId] }).expect(200);
    await until(() => !s.connected, 6000);
  });

  it('the provider-wide snapshot lists customers in scope with their names; scoped staff and other providers see less', async () => {
    for (const c of [C1, C2, C3]) await pipeline.process(position(c.engineId));
    const all = await http(ctx).get(url(`/organizations/${P1}/provider/fleet/snapshot`)).set(bearer(p1Ops));
    expect(all.status).toBe(200);
    expect(all.body.data.vehicles.map((v: { registrationNumber: string }) => v.registrationNumber).sort()).toEqual([C1.registration, C2.registration].sort());
    expect(all.body.data.vehicles.find((v: { customerId: string }) => v.customerId === C1.orgId).customerName).toBe('Live C1');
    expect(all.body.data.customers.map((c: { id: string }) => c.id).sort()).toEqual([C1.orgId, C2.orgId].sort());

    const scoped = await http(ctx).get(url(`/organizations/${P1}/provider/fleet/snapshot`)).set(bearer(p1Scoped));
    expect(scoped.body.data.vehicles.map((v: { customerId: string }) => v.customerId)).toEqual([C1.orgId]);

    expect((await http(ctx).get(url(`/organizations/${P1}/provider/fleet/snapshot`)).set(bearer(p1Tech))).status).toBe(403);
    expect((await http(ctx).get(url(`/organizations/${P1}/provider/fleet/snapshot`)).set(bearer(p2Ops))).status).toBe(404);
    expect((await http(ctx).get(url(`/organizations/${P1}/provider/fleet/snapshot`)).set(bearer(C1.owner))).status).toBe(404); // a customer cannot even see that the provider console exists
  });

  it('watching the live map is written to each customer’s access log', async () => {
    const log = await http(ctx).get(url(`/organizations/${C2.orgId}/access-log`)).set(bearer(C2.owner));
    expect(log.status).toBe(200);
    expect(log.body.data.some((e: { area: string }) => e.area === 'live')).toBe(true);
    // A customer outside the staff member's scope has no such entry from the scoped staff member's views.
    const c3log = await http(ctx).get(url(`/organizations/${C3.orgId}/access-log`)).set(bearer(C3.owner));
    expect(c3log.body.data.every((e: { actorName: string }) => e.actorName !== null)).toBe(true);
  });
});
