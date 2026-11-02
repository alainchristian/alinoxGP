import { randomUUID } from 'node:crypto';
import { CAPABILITY_KEYS, isValidImei } from '@gps/shared';
import { addMemberAndLogin, bearer, createOrg, createTestApp, http, url, type TestCtx, type TestUser } from './helpers';

const RUN = randomUUID().slice(0, 6).toUpperCase();

/** A valid 15-digit IMEI (Luhn check digit appended) from a 14-digit body. */
function imei(seed: number): string {
  const body = String(10_000_000_000_000 + seed).slice(0, 14);
  for (let c = 0; c < 10; c++) if (isValidImei(body + c)) return body + c;
  throw new Error('no check digit');
}
let counter = Math.floor(Math.random() * 1_000_000);
const nextImei = () => imei(++counter * 7 + 1_234_567);

/** M5b: catalogue + evidence rules, onboarding, lifecycle, effective capabilities, consent, support requests, diagnostics. */
describe('Device catalogue, onboarding and diagnostics (e2e)', () => {
  let ctx: TestCtx;
  let tech: TestUser; // platform technical administrator
  let superAdmin: TestUser; // platform super administrator (consent notices)
  let A: string, B: string, S: string; // customer A, customer B, sandbox customer
  let ownerA: TestUser, ownerB: TestUser, ownerS: TestUser, viewerA: TestUser;

  const get = (u: TestUser, p: string) => http(ctx).get(url(p)).set(bearer(u));
  const post = (u: TestUser, p: string, b: object = {}) => http(ctx).post(url(p)).set(bearer(u)).send(b);
  const patch = (u: TestUser, p: string, b: object) => http(ctx).patch(url(p)).set(bearer(u)).send(b);
  const put = (u: TestUser, p: string, b: object) => http(ctx).put(url(p)).set(bearer(u)).send(b);
  const del = (u: TestUser, p: string) => http(ctx).delete(url(p)).set(bearer(u)).send({});

  /** Creates a manufacturer, a model and one variant through the platform API. Returns the ids. */
  async function makeModel(over: Record<string, unknown> = {}, variant: Record<string, unknown> = {}) {
    const maker = await post(tech, '/admin/catalogue/manufacturers', { name: `Maker ${RUN}-${randomUUID().slice(0, 5)}` });
    expect(maker.status).toBe(201);
    const model = await post(tech, '/admin/catalogue/models', { manufacturerId: maker.body.data.id, name: `Model ${randomUUID().slice(0, 5)}`, protocol: 'teltonika', enginePort: 5027, identifierType: 'IMEI', isListed: true, configurationNotes: 'Set the server and port in the configurator.', ...over });
    expect(model.status).toBe(201);
    const v = await post(tech, '/admin/catalogue/variants', { modelId: model.body.data.id, hardwareRevision: 'A', ...variant });
    expect(v.status).toBe(201);
    const variantId = v.body.data.variants[0].id as string;
    return { makerId: maker.body.data.id as string, modelId: model.body.data.id as string, variantId };
  }
  const setCap = (variantId: string, key: string, support: string) => put(tech, `/admin/catalogue/variants/${variantId}/capabilities/${key}`, { support, evidenceAttribute: key });
  const verify = (variantId: string) =>
    post(tech, `/admin/catalogue/variants/${variantId}/verifications`, { testedAt: '2026-11-01T10:00:00Z', testedByName: 'Bench tester', firmwareVersion: '1.2.3', procedure: 'Bench test, all inputs toggled', evidence: 'attribute log' });
  const register = (u: TestUser, body: Record<string, unknown>) => post(u, '/devices', body);
  const caps = async (u: TestUser, deviceId: string) => {
    const r = await get(u, `/devices/${deviceId}/capabilities`);
    expect(r.status).toBe(200);
    return Object.fromEntries((r.body.data.capabilities as { key: string; state: string; observed: string; reason: string }[]).map((c) => [c.key, c])) as Record<string, { state: string; observed: string; reason: string }>;
  };

  beforeAll(async () => {
    ctx = await createTestApp({ DEVICE_CONSENT_REQUIRED: 'true', GPS_SERVER_HOST: 'gps.example.test' });
    const platform = await ctx.system.organization.findFirstOrThrow({ where: { type: 'PLATFORM' } });
    tech = await addMemberAndLogin(ctx, platform.id, 'PLATFORM_TECHNICAL_ADMIN');
    superAdmin = await addMemberAndLogin(ctx, platform.id, 'PLATFORM_SUPER_ADMIN');
    A = (await createOrg(ctx, { name: `Cat A ${RUN}` })).id;
    B = (await createOrg(ctx, { name: `Cat B ${RUN}` })).id;
    S = (await createOrg(ctx, { name: `Cat Sandbox ${RUN}` })).id;
    await ctx.system.organization.update({ where: { id: S }, data: { isSandbox: true } });
    ownerA = await addMemberAndLogin(ctx, A, 'ORG_OWNER');
    ownerB = await addMemberAndLogin(ctx, B, 'ORG_OWNER');
    ownerS = await addMemberAndLogin(ctx, S, 'ORG_OWNER');
    viewerA = await addMemberAndLogin(ctx, A, 'VIEWER');
  }, 60_000);
  afterAll(() => ctx.close());

  /** Acknowledges the current notice (the suite boots with consent required). */
  const ack = async (u: TestUser) => ((await get(u, '/consent/current')).body.data?.id as string | undefined);

  // ---------------------------------------------------------------- catalogue

  describe('catalogue', () => {
    it('seeds ONE entry, the simulator profile: listed, supported-but-unverified, with only what the simulator delivers', async () => {
      const list = await get(ownerA, '/catalogue/models');
      expect(list.status).toBe(200);
      const sim = list.body.data.find((m: { isSimulatorProfile: boolean }) => m.isSimulatorProfile);
      expect(sim).toMatchObject({ name: 'OsmAnd simulator profile', protocol: 'osmand', isListed: true });
      expect(sim.variants).toHaveLength(1);
      expect(sim.variants[0].compatibilityStatus).toBe('SUPPORTED_UNVERIFIED');
      expect(sim.variants[0].capabilities.map((c: { key: string }) => c.key)).toEqual(['gps_tracking', 'ignition_detection', 'speed_monitoring']);
      expect(list.body.data.filter((m: { isSimulatorProfile: boolean }) => !m.isSimulatorProfile).every((m: { name: string }) => m.name.startsWith('Model'))).toBe(true);
    });

    it('platform staff manage it; customers see only listed models and never who tested what', async () => {
      const listed = await makeModel({ isListed: true });
      const hidden = await makeModel({ isListed: false });
      await verify(listed.variantId);
      const customer = (await get(ownerA, '/catalogue/models')).body.data as { id: string; variants: { verifications: unknown[] }[] }[];
      expect(customer.map((m) => m.id)).toContain(listed.modelId);
      expect(customer.map((m) => m.id)).not.toContain(hidden.modelId);
      expect(customer.find((m) => m.id === listed.modelId)!.variants[0]!.verifications).toEqual([]);
      const staff = (await get(tech, '/admin/catalogue/models')).body.data as { id: string; variants: { verifications: { testedByName: string }[] }[] }[];
      expect(staff.find((m) => m.id === listed.modelId)!.variants[0]!.verifications[0]!.testedByName).toBe('Bench tester');
      expect(staff.map((m) => m.id)).toContain(hidden.modelId);
    });

    it('only platform staff may change it', async () => {
      for (const [m, p] of [['get', '/admin/catalogue/models'], ['post', '/admin/catalogue/manufacturers'], ['post', '/admin/catalogue/models']] as const) {
        const res = await http(ctx)[m](url(p)).set(bearer(ownerA)).send({ name: 'x' });
        expect([m, p, res.status, res.body.code]).toEqual([m, p, 403, 'PERMISSION_DENIED']);
      }
      expect((await get(viewerA, '/catalogue/models')).status).toBe(200);
    });

    it('refuses duplicates and unknown capability keys', async () => {
      const name = `Dup ${RUN}`;
      expect((await post(tech, '/admin/catalogue/manufacturers', { name })).status).toBe(201);
      const dup = await post(tech, '/admin/catalogue/manufacturers', { name: ` ${name.toLowerCase()} ` });
      expect([dup.status, dup.body.code]).toEqual([409, 'MANUFACTURER_NAME_TAKEN']);
      const m = await makeModel();
      expect((await setCap(m.variantId, 'teleportation', 'SUPPORTED')).status).toBe(400);
      expect((await put(tech, `/admin/catalogue/variants/${m.variantId}/capabilities/gps_tracking`, { support: 'MAYBE' })).status).toBe(400);
    });

    it('a variant is VERIFIED only with a recorded test (database rule), and a simulator profile never', async () => {
      const m = await makeModel();
      const refused = await patch(tech, `/admin/catalogue/variants/${m.variantId}`, { compatibilityStatus: 'VERIFIED' });
      expect([refused.status, refused.body.code]).toEqual([422, 'VERIFICATION_REQUIRED']);
      const born = await post(tech, '/admin/catalogue/variants', { modelId: m.modelId, compatibilityStatus: 'VERIFIED' });
      expect([born.status, born.body.code]).toEqual([422, 'VERIFICATION_REQUIRED']);
      expect((await post(tech, `/admin/catalogue/variants/${m.variantId}/verifications`, { testedAt: '2026-11-01T10:00:00Z', testedByName: ' ', firmwareVersion: '1', procedure: 'p', evidence: 'e' })).status).toBe(400);
      expect((await verify(m.variantId)).status).toBe(201);
      const ok = await patch(tech, `/admin/catalogue/variants/${m.variantId}`, { compatibilityStatus: 'VERIFIED' });
      expect(ok.status).toBe(200);
      expect(ok.body.data.variants[0]).toMatchObject({ compatibilityStatus: 'VERIFIED', lastTestedAt: '2026-11-01T10:00:00.000Z' });

      const sim = await ctx.system.gpsDeviceVariant.findFirstOrThrow({ where: { model: { isSimulatorProfile: true } } });
      await ctx.system.variantVerification.create({ data: { variantId: sim.id, testedAt: new Date(), testedByName: 'x', firmwareVersion: '1', procedure: 'p', evidence: 'e' } });
      const simRefused = await patch(tech, `/admin/catalogue/variants/${sim.id}`, { compatibilityStatus: 'VERIFIED' });
      expect([simRefused.status, simRefused.body.code]).toEqual([422, 'SIMULATOR_PROFILE_NOT_VERIFIABLE']);
    });

    it('remote immobilization can only be marked supported on a verified variant', async () => {
      const m = await makeModel();
      const refused = await setCap(m.variantId, 'remote_immobilization', 'SUPPORTED');
      expect([refused.status, refused.body.code]).toEqual([422, 'IMMOBILIZATION_NEEDS_VERIFIED_VARIANT']);
      expect((await setCap(m.variantId, 'remote_immobilization', 'NOT_SUPPORTED')).status).toBe(200);
      await verify(m.variantId);
      await patch(tech, `/admin/catalogue/variants/${m.variantId}`, { compatibilityStatus: 'VERIFIED' });
      expect((await setCap(m.variantId, 'remote_immobilization', 'SUPPORTED')).status).toBe(200);
    });

    it('clearing a capability row returns it to unknown, not to "not supported"', async () => {
      const m = await makeModel();
      await setCap(m.variantId, 'gps_tracking', 'SUPPORTED');
      const res = await del(tech, `/admin/catalogue/variants/${m.variantId}/capabilities/gps_tracking`);
      expect(res.body.data.variants[0].capabilities).toEqual([]);
    });

    it('verification evidence is append-only for every database role', async () => {
      const m = await makeModel();
      await verify(m.variantId);
      const row = await ctx.system.variantVerification.findFirstOrThrow({ where: { variantId: m.variantId } });
      await expect(ctx.system.variantVerification.delete({ where: { id: row.id } })).rejects.toThrow();
      await expect(ctx.system.variantVerification.update({ where: { id: row.id }, data: { evidence: 'rewritten' } })).rejects.toThrow();
    });
  });

  // ---------------------------------------------------------------- onboarding

  describe('onboarding', () => {
    it('registers a device with a catalogue model: valid IMEI, consent recorded, lifecycle and history', async () => {
      const m = await makeModel();
      const id = imei(1);
      const notice = await ack(ownerA);
      expect(notice).toBeDefined();
      const res = await register(ownerA, { uniqueId: id, variantId: m.variantId, firmwareVersion: ' 1.2.3 ', serialNumber: 'SN-1', simIccid: '89250000000000000001', acknowledgedNoticeId: notice });
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({ uniqueId: id, lifecycleStatus: 'AWAITING_CONFIGURATION', displayStatus: 'Awaiting configuration', connectivity: 'NEVER_CONNECTED', firmwareVersion: '1.2.3', serialNumber: 'SN-1', simIccid: '89250000000000000001' });
      expect(res.body.data.variant.label).toContain('Model');
      const history = (await get(ownerA, `/devices/${res.body.data.id}/history`)).body.data;
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({ fromStatus: null, toStatus: 'AWAITING_CONFIGURATION', byUser: true });
      const records = (await get(ownerA, '/consent/records')).body.data as { deviceId: string; noticeVersion: number }[];
      expect(records.find((r) => r.deviceId === res.body.data.id)).toMatchObject({ noticeVersion: 1 });
    });

    it('a device without a model starts as Registered with every capability Unknown', async () => {
      const res = await register(ownerA, { uniqueId: `RAW-${RUN}-${randomUUID().slice(0, 6)}`, acknowledgedNoticeId: await ack(ownerA) });
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({ lifecycleStatus: 'REGISTERED', displayStatus: 'Registered', variant: null });
      const c = await caps(ownerA, res.body.data.id);
      expect(Object.keys(c)).toEqual([...CAPABILITY_KEYS]);
      expect(Object.values(c).every((x) => x.state === 'UNKNOWN')).toBe(true);
    });

    it('rejects an invalid IMEI for a model that uses one, with the field named', async () => {
      const m = await makeModel();
      const res = await register(ownerA, { uniqueId: '490154203237519', variantId: m.variantId, acknowledgedNoticeId: await ack(ownerA) });
      expect(res.status).toBe(400);
      expect(res.body.errors).toEqual([expect.objectContaining({ path: 'uniqueId' })]);
    });

    it('offers only listed models, and the simulator profile only with simulated identifiers', async () => {
      const hidden = await makeModel({ isListed: false });
      const notListed = await register(ownerA, { uniqueId: nextImei(), variantId: hidden.variantId, acknowledgedNoticeId: await ack(ownerA) });
      expect([notListed.status, notListed.body.code]).toEqual([422, 'VARIANT_NOT_FOUND']);

      const sim = (await get(ownerS, '/catalogue/models')).body.data.find((m: { isSimulatorProfile: boolean }) => m.isSimulatorProfile).variants[0].id as string;
      const real = await register(ownerA, { uniqueId: nextImei(), variantId: sim, acknowledgedNoticeId: await ack(ownerA) });
      expect([real.status, real.body.code]).toEqual([422, 'VARIANT_IDENTIFIER_MISMATCH']);
      const other = await makeModel({ identifierType: 'OTHER' });
      const simId = await register(ownerS, { uniqueId: `SIM-${RUN}-${randomUUID().slice(0, 4)}`, variantId: other.variantId, acknowledgedNoticeId: await ack(ownerS) });
      expect([simId.status, simId.body.code]).toEqual([422, 'VARIANT_IDENTIFIER_MISMATCH']);
    });

    it('a duplicate identifier is refused without revealing who owns it', async () => {
      const id = nextImei();
      expect((await register(ownerA, { uniqueId: id, acknowledgedNoticeId: await ack(ownerA) })).status).toBe(201);
      const dup = await register(ownerB, { uniqueId: id, acknowledgedNoticeId: await ack(ownerB) });
      expect([dup.status, dup.body.code]).toEqual([409, 'DEVICE_IDENTIFIER_UNAVAILABLE']);
      expect(JSON.stringify(dup.body)).not.toContain(`Cat A ${RUN}`);
      expect(JSON.stringify(dup.body)).not.toContain(A);
    });

    it('generates configuration instructions from the catalogue and says what it does not know', async () => {
      const m = await makeModel();
      const dev = (await register(ownerA, { uniqueId: nextImei(), variantId: m.variantId, acknowledgedNoticeId: await ack(ownerA) })).body.data;
      const cfg = (await get(ownerA, `/devices/${dev.id}/configuration`)).body.data;
      expect(cfg).toMatchObject({ identifier: dev.uniqueId, identifierType: 'IMEI', serverHost: 'gps.example.test', port: 5027, protocol: 'teltonika', notes: 'Set the server and port in the configurator.', missing: [] });

      const bare = await makeModel({ enginePort: null, configurationNotes: null });
      const dev2 = (await register(ownerA, { uniqueId: nextImei(), variantId: bare.variantId, acknowledgedNoticeId: await ack(ownerA) })).body.data;
      const cfg2 = (await get(ownerA, `/devices/${dev2.id}/configuration`)).body.data;
      expect(cfg2.port).toBeNull();
      expect(cfg2.missing).toEqual(['The catalogue does not record the port this model connects to.', 'The catalogue has no setup notes for this model.']);

      const noModel = (await register(ownerA, { uniqueId: nextImei(), acknowledgedNoticeId: await ack(ownerA) })).body.data;
      expect((await get(ownerA, `/devices/${noModel.id}/configuration`)).body.data.missing[0]).toMatch(/has not been identified/);
    });

    it('"configured" moves the device to awaiting first signal, once, and is recorded', async () => {
      const m = await makeModel();
      const dev = (await register(ownerA, { uniqueId: nextImei(), variantId: m.variantId, acknowledgedNoticeId: await ack(ownerA) })).body.data;
      const first = await post(ownerA, `/devices/${dev.id}/configured`);
      expect(first.status).toBe(200);
      expect(first.body.data).toMatchObject({ lifecycleStatus: 'AWAITING_FIRST_SIGNAL', displayStatus: 'Awaiting first GPS signal' });
      expect((await post(ownerA, `/devices/${dev.id}/configured`)).body.data.lifecycleStatus).toBe('AWAITING_FIRST_SIGNAL');
      const history = (await get(ownerA, `/devices/${dev.id}/history`)).body.data;
      expect(history.map((h: { toStatus: string }) => h.toStatus)).toEqual(['AWAITING_FIRST_SIGNAL', 'AWAITING_CONFIGURATION']);
      expect(history[0].reason).toMatch(/confirmed/);
    });

    it('a user without registration permission cannot register, confirm or identify (403)', async () => {
      const m = await makeModel();
      const dev = (await register(ownerA, { uniqueId: nextImei(), acknowledgedNoticeId: await ack(ownerA) })).body.data;
      for (const res of [await register(viewerA, { uniqueId: nextImei() }), await post(viewerA, `/devices/${dev.id}/configured`), await put(viewerA, `/devices/${dev.id}/variant`, { variantId: m.variantId })]) {
        expect([res.status, res.body.code]).toEqual([403, 'PERMISSION_DENIED']);
      }
      expect((await get(viewerA, `/devices/${dev.id}/configuration`)).status).toBe(200); // reading is allowed
    });

    it('a customer can identify the model after registering; the same rules apply', async () => {
      const m = await makeModel();
      const dev = (await register(ownerA, { uniqueId: '490154203237519'.replace(/9$/, '8'), acknowledgedNoticeId: await ack(ownerA) })).body.data;
      const done = await put(ownerA, `/devices/${dev.id}/variant`, { variantId: m.variantId, firmwareVersion: '9.9' });
      expect(done.status).toBe(200);
      expect(done.body.data).toMatchObject({ firmwareVersion: '9.9' });
      expect(done.body.data.variant).not.toBeNull();
      const bad = await register(ownerA, { uniqueId: `X-${RUN}-${randomUUID().slice(0, 5)}`, acknowledgedNoticeId: await ack(ownerA) });
      const mismatch = await put(ownerA, `/devices/${bad.body.data.id}/variant`, { variantId: m.variantId });
      expect(mismatch.status).toBe(400); // not an IMEI
      expect((await put(ownerA, `/devices/${dev.id}/variant`, { variantId: null })).body.data.variant).toBeNull();
    });

    it('end to end for a simulated device: model, consent, instructions, configured, capabilities with reasons', async () => {
      const sim = (await get(ownerS, '/catalogue/models')).body.data.find((m: { isSimulatorProfile: boolean }) => m.isSimulatorProfile).variants[0].id as string;
      const reg = await register(ownerS, { uniqueId: `SIM-${RUN}-E2E`, variantId: sim, acknowledgedNoticeId: await ack(ownerS) });
      expect(reg.status).toBe(201);
      expect(reg.body.data).toMatchObject({ isSimulated: true, lifecycleStatus: 'AWAITING_CONFIGURATION', engineSyncStatus: 'SYNCED' });
      expect(reg.body.data.variant.isSimulatorProfile).toBe(true);
      expect((await post(ownerS, `/devices/${reg.body.data.id}/configured`)).body.data.displayStatus).toBe('Awaiting first GPS signal');
      const c = await caps(ownerS, reg.body.data.id);
      // Supported by the profile, never "verified": a simulator is not hardware. No data yet, so nothing observed.
      expect(c['gps_tracking']).toMatchObject({ state: 'SUPPORTED_UNVERIFIED', observed: 'NOT_YET_REPORTED' });
      expect(c['ignition_detection']!.state).toBe('SUPPORTED_UNVERIFIED');
      expect(c['fuel_monitoring']!.state).toBe('UNKNOWN');
      expect(c['remote_immobilization']!.state).toBe('UNKNOWN');
      expect(Object.values(c).every((x) => x.reason.length > 10)).toBe(true);
    });
  });

  // ---------------------------------------------------------------- effective capabilities

  describe('effective capabilities', () => {
    it('combine the catalogue with what is observable, and immobilization is never enabled', async () => {
      const m = await makeModel();
      for (const [k, s] of [['gps_tracking', 'SUPPORTED'], ['ignition_detection', 'SUPPORTED'], ['sos_button', 'PARTIAL'], ['towing_detection', 'REQUIRES_CONFIGURATION'], ['fuel_monitoring', 'NOT_SUPPORTED'], ['battery_monitoring', 'SUPPORTED']] as const) await setCap(m.variantId, k, s);
      await verify(m.variantId);
      await patch(tech, `/admin/catalogue/variants/${m.variantId}`, { compatibilityStatus: 'VERIFIED' });
      await setCap(m.variantId, 'remote_immobilization', 'SUPPORTED'); // allowed on a verified variant ...
      const dev = (await register(ownerA, { uniqueId: nextImei(), variantId: m.variantId, acknowledgedNoticeId: await ack(ownerA) })).body.data;
      const c = await caps(ownerA, dev.id);
      expect(c['gps_tracking']!.state).toBe('VERIFIED');
      expect(c['ignition_detection']!.state).toBe('SUPPORTED_UNVERIFIED'); // depends on wiring; no verified installation
      expect(c['sos_button']!.state).toBe('PARTIAL');
      expect(c['towing_detection']!.state).toBe('REQUIRES_CONFIGURATION');
      expect(c['fuel_monitoring']!.state).toBe('NOT_SUPPORTED');
      expect(c['battery_monitoring']).toMatchObject({ state: 'VERIFIED', observed: 'NOT_OBSERVABLE' });
      expect(c['driver_identification']!.state).toBe('UNKNOWN');
      expect(c['remote_immobilization']!.state).toBe('DISABLED'); // ... but never effective
    });

    it('unsupported model: everything with a row is not supported', async () => {
      const m = await makeModel({}, { compatibilityStatus: 'UNSUPPORTED' });
      await setCap(m.variantId, 'gps_tracking', 'SUPPORTED');
      const dev = (await register(ownerA, { uniqueId: nextImei(), variantId: m.variantId, acknowledgedNoticeId: await ack(ownerA) })).body.data;
      expect((await caps(ownerA, dev.id))['gps_tracking']!.state).toBe('NOT_SUPPORTED');
    });

    it('are readable by a viewer, and another organization gets 404', async () => {
      const dev = (await register(ownerA, { uniqueId: nextImei(), acknowledgedNoticeId: await ack(ownerA) })).body.data;
      expect((await get(viewerA, `/devices/${dev.id}/capabilities`)).status).toBe(200);
      for (const p of [`/devices/${dev.id}/capabilities`, `/devices/${dev.id}/configuration`, `/devices/${dev.id}/history`]) {
        const res = await get(ownerB, p);
        expect([p, res.status, res.body.code]).toEqual([p, 404, 'DEVICE_NOT_FOUND']);
      }
      expect((await post(ownerB, `/devices/${dev.id}/configured`)).status).toBe(404);
      expect((await put(ownerB, `/devices/${dev.id}/variant`, { variantId: null })).status).toBe(404);
    });
  });

  // ---------------------------------------------------------------- consent

  describe('consent', () => {
    it('demands acknowledgement of the CURRENT notice version, records it, and a new version replaces the old', async () => {
      const v1 = await ack(ownerA);
      const missing = await register(ownerA, { uniqueId: nextImei() });
      expect([missing.status, missing.body.code]).toEqual([422, 'CONSENT_REQUIRED']);
      const wrong = await register(ownerA, { uniqueId: nextImei(), acknowledgedNoticeId: randomUUID() });
      expect([wrong.status, wrong.body.code]).toEqual([422, 'CONSENT_REQUIRED']);
      expect((await get(ownerA, '/consent/current')).body.data).toMatchObject({ isDraftWording: true });

      const draft = await post(superAdmin, '/admin/consent/notices', { title: 'Tracking notice v2', body: 'Second wording', isDraftWording: false });
      expect(draft.status).toBe(201);
      expect((await get(ownerA, '/consent/current')).body.data.id).toBe(v1); // a draft is not binding
      expect((await post(superAdmin, `/admin/consent/notices/${draft.body.data.id}/publish`)).status).toBe(201);
      expect((await get(ownerA, '/consent/current')).body.data).toMatchObject({ id: draft.body.data.id, version: 2, isDraftWording: false });
      const stale = await register(ownerA, { uniqueId: nextImei(), acknowledgedNoticeId: v1 });
      expect([stale.status, stale.body.code]).toEqual([422, 'CONSENT_REQUIRED']);
      const fresh = await register(ownerA, { uniqueId: nextImei(), acknowledgedNoticeId: draft.body.data.id });
      expect(fresh.status).toBe(201);
      const records = (await get(ownerA, '/consent/records')).body.data as { deviceId: string; noticeVersion: number }[];
      expect(records.find((r) => r.deviceId === fresh.body.data.id)!.noticeVersion).toBe(2);
      expect((await post(superAdmin, `/admin/consent/notices/${draft.body.data.id}/publish`)).status).toBe(409); // not a draft any more
    });

    it('a published notice never changes and acknowledgement records are append-only (database)', async () => {
      const current = await ctx.system.consentNotice.findFirstOrThrow({ where: { status: 'PUBLISHED' } });
      await expect(ctx.system.consentNotice.update({ where: { id: current.id }, data: { body: 'quietly rewritten' } })).rejects.toThrow(/never edited|immutable/);
      await expect(ctx.system.consentNotice.delete({ where: { id: current.id } })).rejects.toThrow();
      const rec = await ctx.system.consentRecord.findFirstOrThrow({});
      await expect(ctx.system.consentRecord.update({ where: { id: rec.id }, data: { acceptedAt: new Date() } })).rejects.toThrow();
      await expect(ctx.system.consentRecord.delete({ where: { id: rec.id } })).rejects.toThrow();
    });

    it('notice management needs the platform settings permission', async () => {
      expect((await get(tech, '/admin/consent/notices')).status).toBe(403);
      expect((await get(superAdmin, '/admin/consent/notices')).status).toBe(200);
      expect((await post(ownerA, '/admin/consent/notices', { title: 'x', body: 'y', isDraftWording: true })).status).toBe(403);
    });
  });

  // ---------------------------------------------------------------- support requests

  describe('support requests ("my device is not listed")', () => {
    it('a customer asks, sees only their own, staff see all with the organization and resolve once', async () => {
      const text = `Unlisted ${RUN}`;
      const made = await post(ownerA, '/device-support-requests', { manufacturerText: 'Acme Trackers', modelText: text, firmwareText: '2.0', notes: 'Sold locally' });
      expect(made.status).toBe(201);
      expect(made.body.data).toMatchObject({ status: 'OPEN', modelText: text });
      expect((await get(ownerA, '/device-support-requests')).body.data.map((r: { modelText: string }) => r.modelText)).toContain(text);
      expect(JSON.stringify((await get(ownerB, '/device-support-requests')).body)).not.toContain(text);
      expect((await post(viewerA, '/device-support-requests', { manufacturerText: 'x', modelText: 'y' })).status).toBe(403);
      expect((await post(ownerA, '/device-support-requests', { manufacturerText: '', modelText: 'y' })).status).toBe(400);

      const staff = await get(tech, '/admin/device-support-requests?status=OPEN&pageSize=100');
      const row = staff.body.data.find((r: { modelText: string }) => r.modelText === text);
      expect(row.organization).toMatchObject({ id: A, name: `Cat A ${RUN}` });
      expect((await get(ownerA, '/admin/device-support-requests')).status).toBe(403);
      const resolved = await post(tech, `/admin/device-support-requests/${row.id}/resolve`, { status: 'RESOLVED', resolutionNote: 'Added to the catalogue' });
      expect(resolved.body.data).toMatchObject({ status: 'RESOLVED', resolutionNote: 'Added to the catalogue' });
      expect((await post(tech, `/admin/device-support-requests/${row.id}/resolve`, { status: 'DECLINED' })).status).toBe(409);
      expect((await get(ownerA, '/device-support-requests')).body.data.find((r: { id: string }) => r.id === row.id).status).toBe('RESOLVED');
    });
  });

  // ---------------------------------------------------------------- platform diagnostics

  describe('platform device tools', () => {
    it('finds a device across organizations and explains why it is not communicating', async () => {
      const m = await makeModel({ enginePort: null });
      const dev = (await register(ownerA, { uniqueId: nextImei(), variantId: m.variantId, acknowledgedNoticeId: await ack(ownerA) })).body.data;
      const found = await get(tech, `/admin/devices?q=${dev.uniqueId}`);
      expect(found.body.data).toHaveLength(1);
      expect(found.body.data[0]).toMatchObject({ id: dev.id, organizationName: `Cat A ${RUN}`, lifecycleStatus: 'AWAITING_CONFIGURATION', awaitingFirstSignalTooLong: false });
      const diag = (await get(tech, `/admin/devices/${dev.id}/diagnostics`)).body.data;
      expect(diag.device).toMatchObject({ uniqueId: dev.uniqueId, connectivity: 'NEVER_CONNECTED', displayStatus: 'Awaiting configuration' });
      expect(diag.engine).toMatchObject({ reachable: true, known: true, syncStatus: 'SYNCED' });
      expect(diag.notes).toEqual(expect.arrayContaining(['The platform has never received data from this device.', 'The device is not installed on a vehicle, so no live state exists to observe capabilities.', 'The catalogue does not record the port this model connects to.']));
      expect(diag.history).toHaveLength(1);
      expect(diag.capabilities).toHaveLength(CAPABILITY_KEYS.length);
      expect(JSON.stringify(diag)).not.toMatch(/latitude|longitude/i); // no coordinates in diagnostics
    });

    it('only staff with the diagnose permission; customers get 403 and cannot reach other tenants through it', async () => {
      const dev = (await register(ownerA, { uniqueId: nextImei(), acknowledgedNoticeId: await ack(ownerA) })).body.data;
      for (const p of ['/admin/devices', `/admin/devices/${dev.id}/diagnostics`]) {
        const res = await get(ownerB, p);
        expect([p, res.status, res.body.code]).toEqual([p, 403, 'PERMISSION_DENIED']);
      }
      expect((await post(ownerA, `/admin/devices/${dev.id}/lifecycle`, { status: 'SUSPENDED', reason: 'x' })).status).toBe(403);
    });

    it('changes the lifecycle only along allowed transitions, with a reason, audited and recorded', async () => {
      const dev = (await register(ownerA, { uniqueId: nextImei(), acknowledgedNoticeId: await ack(ownerA) })).body.data;
      expect((await post(tech, `/admin/devices/${dev.id}/lifecycle`, { status: 'SUSPENDED' })).status).toBe(400); // reason required
      const sus = await post(tech, `/admin/devices/${dev.id}/lifecycle`, { status: 'SUSPENDED', reason: 'Unpaid invoice' });
      expect(sus.status).toBe(200);
      expect(sus.body.data.device).toMatchObject({ lifecycleStatus: 'SUSPENDED', displayStatus: 'Suspended' });
      const customerView = (await get(ownerA, `/devices/${dev.id}`)).body.data;
      expect(customerView.displayStatus).toBe('Suspended');
      const history = (await get(ownerA, `/devices/${dev.id}/history`)).body.data;
      expect(history[0]).toMatchObject({ fromStatus: 'REGISTERED', toStatus: 'SUSPENDED', reason: 'Unpaid invoice', byUser: true });
      expect((await post(tech, `/admin/devices/${dev.id}/lifecycle`, { status: 'RETIRED', reason: 'Scrapped' })).status).toBe(200);
      const final = await post(tech, `/admin/devices/${dev.id}/lifecycle`, { status: 'ACTIVE', reason: 'Oops' });
      expect([final.status, final.body.code]).toEqual([409, 'INVALID_TRANSITION']);
      const audit = await ctx.system.auditLog.findFirst({ where: { action: 'platform.device_lifecycle', targetId: dev.id }, orderBy: { at: 'desc' } });
      expect(audit).not.toBeNull();
      expect((await post(tech, `/admin/devices/${randomUUID()}/lifecycle`, { status: 'SUSPENDED', reason: 'x' })).status).toBe(404);
    });

    it('lets staff identify the model, including an unlisted one, under the same rules', async () => {
      const hidden = await makeModel({ isListed: false });
      const dev = (await register(ownerA, { uniqueId: nextImei(), acknowledgedNoticeId: await ack(ownerA) })).body.data;
      const res = await put(tech, `/admin/devices/${dev.id}/variant`, { variantId: hidden.variantId, firmwareVersion: '3.1' });
      expect(res.status).toBe(200);
      expect(res.body.data.device).toMatchObject({ firmwareVersion: '3.1' });
      expect(res.body.data.device.variantLabel).toContain('Model');
      const sim = await ctx.system.gpsDeviceVariant.findFirstOrThrow({ where: { model: { isSimulatorProfile: true } } });
      const mismatch = await put(tech, `/admin/devices/${dev.id}/variant`, { variantId: sim.id });
      expect([mismatch.status, mismatch.body.code]).toEqual([422, 'VARIANT_IDENTIFIER_MISMATCH']);
      expect((await put(tech, `/admin/devices/${dev.id}/variant`, { variantId: randomUUID() })).status).toBe(422);
    });

    it('flags a device that has waited for its first signal for more than 24 hours', async () => {
      const id = `STUCK-${RUN}-${randomUUID().slice(0, 5)}`;
      const d = await ctx.system.gpsDevice.create({ data: { uniqueId: id, ownerOrganizationId: A, currentOrganizationId: A, lifecycleStatus: 'AWAITING_FIRST_SIGNAL' } });
      await ctx.system.deviceStatusHistory.create({ data: { organizationId: A, deviceId: d.id, fromStatus: 'AWAITING_CONFIGURATION', toStatus: 'AWAITING_FIRST_SIGNAL', at: new Date(Date.now() - 30 * 3_600_000) } });
      const fresh = await ctx.system.gpsDevice.create({ data: { uniqueId: `${id}-NEW`, ownerOrganizationId: A, currentOrganizationId: A, lifecycleStatus: 'AWAITING_FIRST_SIGNAL' } });
      await ctx.system.deviceStatusHistory.create({ data: { organizationId: A, deviceId: fresh.id, fromStatus: 'AWAITING_CONFIGURATION', toStatus: 'AWAITING_FIRST_SIGNAL' } });

      const stuck = (await get(tech, '/admin/devices?stuck=true&pageSize=100')).body.data as { id: string }[];
      expect(stuck.map((x) => x.id)).toContain(d.id);
      expect(stuck.map((x) => x.id)).not.toContain(fresh.id);
      const diag = (await get(tech, `/admin/devices/${d.id}/diagnostics`)).body.data;
      expect(diag.device.awaitingFirstSignalTooLong).toBe(true);
      expect(diag.notes.some((n: string) => /more than 24 hours/.test(n))).toBe(true);
    });
  });

  // ---------------------------------------------------------------- database guarantees

  describe('database guarantees', () => {
    it('lifecycle history is append-only and tenant-isolated by row-level security', async () => {
      const dev = (await register(ownerA, { uniqueId: nextImei(), acknowledgedNoticeId: await ack(ownerA) })).body.data;
      const row = await ctx.system.deviceStatusHistory.findFirstOrThrow({ where: { deviceId: dev.id } });
      await expect(ctx.system.deviceStatusHistory.delete({ where: { id: row.id } })).rejects.toThrow();
      await expect(ctx.system.deviceStatusHistory.update({ where: { id: row.id }, data: { reason: 'x' } })).rejects.toThrow();
      // The application role sees nothing without a tenant, and nothing of A with B's tenant.
      expect(await ctx.prisma.deviceStatusHistory.count()).toBe(0);
      expect(await ctx.prisma.consentRecord.count()).toBe(0);
      expect(await ctx.prisma.deviceSupportRequest.count()).toBe(0);
      const asB = await ctx.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_org_id', ${B}, true)`;
        return [await tx.deviceStatusHistory.count({ where: { organizationId: A } }), await tx.consentRecord.count({ where: { organizationId: A } }), await tx.deviceSupportRequest.count({ where: { organizationId: A } })];
      });
      expect(asB).toEqual([0, 0, 0]);
    });

    it('a body that names another organization or a lifecycle status is ignored on registration', async () => {
      const res = await register(ownerA, { uniqueId: nextImei(), acknowledgedNoticeId: await ack(ownerA), organizationId: B, lifecycleStatus: 'ACTIVE' });
      expect(res.status).toBe(201);
      expect(res.body.data.lifecycleStatus).toBe('REGISTERED');
      const row = await ctx.system.gpsDevice.findUniqueOrThrow({ where: { id: res.body.data.id } });
      expect([row.ownerOrganizationId, row.currentOrganizationId]).toEqual([A, A]);
    });

    it('bad identifiers and SIM numbers are refused by the database too', async () => {
      await expect(ctx.system.gpsDevice.create({ data: { uniqueId: `ICC-${RUN}-1`, ownerOrganizationId: A, simIccid: '123' } })).rejects.toThrow();
      await expect(ctx.system.gpsDeviceModel.create({ data: { manufacturerId: (await ctx.system.gpsManufacturer.findFirstOrThrow()).id, name: `Port ${RUN}`, protocol: 'x', enginePort: 70000 } })).rejects.toThrow();
    });
  });
});
