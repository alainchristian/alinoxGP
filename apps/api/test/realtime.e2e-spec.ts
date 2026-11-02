import { randomUUID } from 'node:crypto';
import { io, type Socket } from 'socket.io-client';
import type { AlertDto, VehicleDeltaDto } from '@gps/shared';
import type { EnginePosition } from '../src/integrations/gps-engine/port';
import { AlertService } from '../src/modules/alerts/alert.service';
import { FanoutService } from '../src/modules/realtime/fanout.service';
import Redis from 'ioredis';
import { REDIS } from '../src/infrastructure/redis/redis.module';
import { ENGINE_STATUS_KEY, SOCKET_PATH } from '../src/modules/realtime/realtime.gateway';
import { PositionPipelineService } from '../src/modules/tracking/position-pipeline.service';
import { addMemberAndLogin, bearer, createOrg, createTestApp, http, signIn, stepUp, url, type TestCtx, type TestUser } from './helpers';

/**
 * The live feed must never cross tenants (gps-tenant-isolation §5). Positions are fed straight into the pipeline
 * (no Traccar needed) with devices that exist only in our database, so these tests are fast and deterministic.
 */
describe('Real-time feed: authentication and tenant isolation (e2e)', () => {
  let ctx: TestCtx;
  let baseUrl: string;
  let pipeline: PositionPipelineService;
  let fanout: FanoutService;
  let alerts: AlertService;
  const sockets: Socket[] = [];

  interface Tenant { orgId: string; owner: TestUser; vehicleId: string; engineId: number }
  let A: Tenant, B: Tenant;

  const position = (engineDeviceId: number, over: Partial<EnginePosition> = {}): EnginePosition => {
    const now = new Date();
    return {
      engineDeviceId, engineId: 1, fixTime: now, deviceTime: now, serverTime: now, latitude: -1.9441, longitude: 30.0619, altitudeM: null, speedKmh: 40, heading: 90,
      accuracyM: null, valid: true, ignition: true, motion: null, externalPowerV: null, batteryPercent: null, satellites: null, declaredSimulated: false, protocol: 'test', raw: {}, ...over,
    };
  };

  async function makeTenant(name: string): Promise<Tenant> {
    const org = await createOrg(ctx, { name });
    const owner = await addMemberAndLogin(ctx, org.id, 'ORG_OWNER');
    const vehicle = await ctx.system.vehicle.create({ data: { organizationId: org.id, registrationNumber: `R${randomUUID().slice(0, 8)}` } });
    const engineId = 700_000_000 + Math.floor(Math.random() * 1_000_000);
    const device = await ctx.system.gpsDevice.create({ data: { uniqueId: `RT-${randomUUID().slice(0, 10)}`, ownerOrganizationId: org.id, currentOrganizationId: org.id, traccarDeviceId: engineId } });
    await ctx.system.deviceAssignment.create({ data: { organizationId: org.id, deviceId: device.id, vehicleId: vehicle.id } });
    return { orgId: org.id, owner, vehicleId: vehicle.id, engineId };
  }

  const connect = (token: string, organizationId: string): Promise<Socket> =>
    new Promise((resolve, reject) => {
      const s = io(baseUrl, { path: SOCKET_PATH, transports: ['websocket'], auth: { token, organizationId }, reconnection: false });
      sockets.push(s);
      s.on('connect', () => resolve(s));
      s.on('connect_error', (e) => reject(new Error(e.message)));
    });
  const refused = (token: string | undefined, organizationId: string | undefined) => connect(token as string, organizationId as string).then(() => 'connected', (e: Error) => e.message);
  const collect = (s: Socket) => {
    const out = { deltas: [] as VehicleDeltaDto[], batches: 0, alerts: [] as AlertDto[], engine: [] as boolean[] };
    s.on('vehicle:delta', (m: { vehicles: VehicleDeltaDto[] }) => { out.batches++; out.deltas.push(...m.vehicles); });
    s.on('alert:new', (a: AlertDto) => out.alerts.push(a));
    s.on('engine:status', (e: { connected: boolean }) => out.engine.push(e.connected));
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

  beforeAll(async () => {
    ctx = await createTestApp({ SOCKET_REVALIDATE_SEC: '1', FANOUT_FLUSH_MS: '60000' }); // flush manually: deterministic
    await ctx.app.listen(0);
    baseUrl = `http://127.0.0.1:${(ctx.app.getHttpServer().address() as { port: number }).port}`;
    pipeline = ctx.app.get(PositionPipelineService);
    fanout = ctx.app.get(FanoutService);
    alerts = ctx.app.get(AlertService);
    A = await makeTenant('RT Org A');
    B = await makeTenant('RT Org B');
  }, 60_000);

  afterAll(async () => {
    for (const s of sockets) s.disconnect();
    await ctx.close();
  });

  describe('handshake', () => {
    it('refuses connections without credentials, with garbage, and with an expired/foreign token', async () => {
      expect(await refused(undefined, undefined)).toBe('unauthorized');
      expect(await refused('not-a-token', A.orgId)).toBe('unauthorized');
      expect(await refused(A.owner.accessToken, 'not-a-uuid')).toBe('unauthorized');
      expect(await refused(A.owner.accessToken + 'x', A.orgId)).toBe('unauthorized');
    });

    it('refuses a user asking for an organization they do not belong to — with the same answer as a missing one', async () => {
      const forged = await refused(A.owner.accessToken, B.orgId);
      const missing = await refused(A.owner.accessToken, randomUUID());
      expect(forged).toBe('not_found');
      expect(missing).toBe(forged); // no way to tell "exists but not yours" from "does not exist"
    });

    it('refuses a member who lacks the live-tracking permission', async () => {
      const role = await ctx.system.role.create({ data: { scope: 'ORGANIZATION', key: `NO_LIVE_${Date.now()}`, name: 'No live', isSystem: false } });
      const { user, member, email } = await (await import('./helpers')).addMember(ctx, A.orgId, 'VIEWER');
      void user;
      await ctx.system.memberRole.deleteMany({ where: { memberId: member.id } });
      await ctx.system.memberRole.create({ data: { organizationId: A.orgId, memberId: member.id, roleId: role.id } });
      const u = await signIn(ctx, email);
      expect(await refused(u.accessToken, A.orgId)).toBe('forbidden');
    });

    it('refuses a token whose session was logged out', async () => {
      const u = await addMemberAndLogin(ctx, A.orgId, 'VIEWER');
      expect((await http(ctx).post(url('/auth/logout')).set(bearer(u))).status).toBe(204);
      expect(await refused(u.accessToken, A.orgId)).toBe('unauthorized');
    });

    it('accepts a valid member', async () => {
      const s = await connect(A.owner.accessToken, A.orgId);
      expect(s.connected).toBe(true);
    });
  });

  describe('tenant isolation of the feed', () => {
    it('each organization receives only its own vehicles, alerts and nothing of the other', async () => {
      const sa = collect(await connect(A.owner.accessToken, A.orgId));
      const sb = collect(await connect(B.owner.accessToken, B.orgId));
      await pipeline.process(position(A.engineId, { latitude: -1.9441 }));
      await pipeline.process(position(B.engineId, { latitude: -1.9999 }));
      fanout.flush();
      await until(() => sa.deltas.length >= 1 && sb.deltas.length >= 1);
      await settle();
      expect(sa.deltas.map((d) => d.vehicleId)).toEqual([A.vehicleId]);
      expect(sb.deltas.map((d) => d.vehicleId)).toEqual([B.vehicleId]);
      expect(sa.deltas[0]!.latitude).toBe(-1.9441);
      expect(sb.deltas[0]!.latitude).toBe(-1.9999);
      expect(JSON.stringify(sa.deltas)).not.toContain(B.vehicleId);

      const rule = await ctx.system.alertRule.create({ data: { organizationId: A.orgId, type: 'DEVICE_OFFLINE', cooldownSeconds: 0 } });
      await alerts.raise({ organizationId: A.orgId, vehicleId: A.vehicleId, rule, startedAt: new Date(), latitude: null, longitude: null, simulated: false, delayed: false });
      await until(() => sa.alerts.length >= 1);
      await settle();
      expect(sa.alerts).toHaveLength(1);
      expect(sb.alerts).toHaveLength(0);
    });

    it('a vehicle subscription works for own vehicles only and delivers unthrottled single-vehicle updates', async () => {
      const s = await connect(A.owner.accessToken, A.orgId);
      const got = collect(s);
      const own = await new Promise<{ ok: boolean; error?: string }>((r) => s.emit('subscribe:vehicle', { vehicleId: A.vehicleId }, r));
      const foreign = await new Promise<{ ok: boolean; error?: string }>((r) => s.emit('subscribe:vehicle', { vehicleId: B.vehicleId }, r));
      const junk = await new Promise<{ ok: boolean; error?: string }>((r) => s.emit('subscribe:vehicle', { vehicleId: 'x' }, r));
      expect(own).toEqual({ ok: true });
      expect(foreign).toEqual({ ok: false, error: 'not_found' });
      expect(junk).toEqual({ ok: false, error: 'not_found' });

      // A realistic step (~55 m in 2 s, i.e. ~100 km/h): a bigger hop would rightly be refused as an implausible jump.
      await pipeline.process(position(A.engineId, { latitude: -1.9446, fixTime: new Date(Date.now() + 2000) })); // newest fix
      await until(() => got.deltas.some((d) => d.latitude === -1.9446)); // arrives immediately, before any batch flush
      await pipeline.process(position(B.engineId, { latitude: -1.9990, fixTime: new Date(Date.now() + 2000) }));
      fanout.flush();
      await settle();
      expect(got.deltas.some((d) => d.vehicleId === B.vehicleId)).toBe(false);
    });

    it('engine connectivity (no tenant data) reaches everyone', async () => {
      const sa = collect(await connect(A.owner.accessToken, A.orgId));
      const sb = collect(await connect(B.owner.accessToken, B.orgId));
      fanout.emitEngineStatus(false);
      await until(() => sa.engine.length >= 1 && sb.engine.length >= 1);
      expect(sa.engine[0]).toBe(false);
    });
  });

  describe('coalescing', () => {
    it('many updates in a window become ONE batch carrying only the newest state per vehicle', async () => {
      const t = await makeTenant('RT Coalesce');
      const s = collect(await connect(t.owner.accessToken, t.orgId));
      const base = Date.now();
      for (let i = 0; i < 40; i++) await pipeline.process(position(t.engineId, { latitude: -1.9 - i * 0.0001, fixTime: new Date(base + i * 1000), serverTime: new Date(base + i * 1000), speedKmh: 30 }));
      fanout.flush();
      await until(() => s.batches >= 1);
      await settle();
      expect(s.batches).toBe(1);
      expect(s.deltas).toHaveLength(1);
      expect(s.deltas[0]!.latitude).toBeCloseTo(-1.9 - 39 * 0.0001, 6);
    });
  });

  describe('sockets are re-validated', () => {
    it('a revoked session is disconnected shortly after, without the client doing anything', async () => {
      const u = await addMemberAndLogin(ctx, A.orgId, 'VIEWER');
      const s = await connect(u.accessToken, A.orgId);
      let closed = false;
      s.on('disconnect', () => (closed = true));
      expect((await http(ctx).post(url('/auth/logout')).set(bearer(u))).status).toBe(204);
      await until(() => closed, 6000);
      expect(s.connected).toBe(false);
    });

    it('a member who is removed from the organization is disconnected', async () => {
      const u = await addMemberAndLogin(ctx, A.orgId, 'VIEWER');
      const s = await connect(u.accessToken, A.orgId);
      let closed = false;
      s.on('disconnect', () => (closed = true));
      await stepUp(ctx, A.owner);
      expect((await http(ctx).delete(url(`/organizations/${A.orgId}/members/${u.memberId}`)).set(bearer(A.owner))).status).toBe(204);
      await until(() => closed, 6000);
    });
  });

  describe('engine status', () => {
    const redis = () => ctx.app.get<Redis>(REDIS);
    /** Waits until the remembered status (written without waiting by the fan-out) is the one just announced. */
    const remembered = async (connected: boolean) => {
      for (let i = 0; i < 100; i++) {
        const raw = await redis().get(ENGINE_STATUS_KEY);
        if (raw && (JSON.parse(raw) as { connected: boolean }).connected === connected) return;
        await settle(30);
      }
      throw new Error('the engine status was not remembered');
    };
    const last = (xs: boolean[]) => xs[xs.length - 1];

    it('tells a client that connects LATER whether the tracking engine is up, instead of leaving it waiting for the next change', async () => {
      const early = collect(await connect(A.owner.accessToken, A.orgId));
      fanout.emitEngineStatus(false);
      await remembered(false);
      await until(() => last(early.engine) === false);

      const late = collect(await connect(A.owner.accessToken, A.orgId)); // connects after the announcement
      await until(() => late.engine.length > 0);
      expect(last(late.engine)).toBe(false);

      fanout.emitEngineStatus(true);
      await remembered(true);
      const later = collect(await connect(A.owner.accessToken, A.orgId));
      await until(() => later.engine.length > 0);
      expect(last(later.engine)).toBe(true); // the newest value, not the first one
    });
  });
});
