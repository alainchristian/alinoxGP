import { TenantPrismaService } from '../src/infrastructure/prisma/prisma.service';
import {
  PASSWORD,
  addMember,
  addMemberAndLogin,
  bearer,
  createOrg,
  createTestApp,
  http,
  login,
  stepUp,
  tokenFromMail,
  uniqueEmail,
  url,
  type TestCtx,
  type TestUser,
} from './helpers';

/**
 * GPS-provider hierarchy (ADR-0010, gps-tenant-isolation §7). Fixture:
 *   P1 (owner, operations, operations scoped to C1, technician, finance) with customers C1, C2
 *   P2 (owner) with customer C3
 * Each customer has an owner and one vehicle.
 */
describe('Provider hierarchy (e2e)', () => {
  let ctx: TestCtx;
  let tenant: TenantPrismaService;
  let P1: string, P2: string, C1: string, C2: string, C3: string;
  let p1Owner: TestUser, p1Ops: TestUser, p1Scoped: TestUser & { memberId: string }, p1Tech: TestUser, p1Finance: TestUser, p2Owner: TestUser;
  let c1Owner: TestUser, c2Owner: TestUser, c3Owner: TestUser;
  let platformOps: TestUser;
  const vehicle: Record<string, string> = {};

  const makeProvider = async (name: string, status: 'ACTIVE' | 'PENDING_APPROVAL' = 'ACTIVE') => {
    const org = await createOrg(ctx, { name, type: 'PROVIDER' });
    await ctx.system.providerProfile.create({
      data: { organizationId: org.id, status, companyName: name, contactName: 'Owner', contactEmail: uniqueEmail('prov'), termsVersion: 'test', termsAcceptedAt: new Date() },
    });
    return org.id;
  };
  const inOrg = (user: TestUser, orgId: string) => ({ ...bearer(user), 'X-Organization-Id': orgId });
  const addVehicle = async (owner: TestUser, orgId: string, tag: string) => {
    const res = await http(ctx).post(url('/vehicles')).set(inOrg(owner, orgId)).send({ registrationNumber: `RA${tag}${Date.now() % 100000}` });
    expect(res.status).toBe(201);
    return res.body.data.id as string;
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = ctx.app.get(TenantPrismaService);

    P1 = await makeProvider('Provider One');
    P2 = await makeProvider('Provider Two');
    C1 = (await createOrg(ctx, { name: 'Customer One', parentOrganizationId: P1 })).id;
    C2 = (await createOrg(ctx, { name: 'Customer Two', parentOrganizationId: P1 })).id;
    C3 = (await createOrg(ctx, { name: 'Customer Three', parentOrganizationId: P2 })).id;

    p1Owner = await addMemberAndLogin(ctx, P1, 'PROVIDER_OWNER');
    p1Ops = await addMemberAndLogin(ctx, P1, 'PROVIDER_OPERATIONS');
    p1Scoped = await addMemberAndLogin(ctx, P1, 'PROVIDER_OPERATIONS');
    p1Tech = await addMemberAndLogin(ctx, P1, 'PROVIDER_TECHNICIAN');
    p1Finance = await addMemberAndLogin(ctx, P1, 'PROVIDER_FINANCE');
    p2Owner = await addMemberAndLogin(ctx, P2, 'PROVIDER_OWNER');
    c1Owner = await addMemberAndLogin(ctx, C1, 'ORG_OWNER');
    c2Owner = await addMemberAndLogin(ctx, C2, 'ORG_OWNER');
    c3Owner = await addMemberAndLogin(ctx, C3, 'ORG_OWNER');

    const platform = await ctx.system.organization.findFirstOrThrow({ where: { type: 'PLATFORM' } });
    platformOps = await addMemberAndLogin(ctx, platform.id, 'PLATFORM_OPERATIONS_ADMIN');

    // Limit one operations member to C1 (through the API, as the owner would).
    await stepUp(ctx, p1Owner);
    const scope = await http(ctx).put(url(`/organizations/${P1}/provider/staff/${p1Scoped.memberId}/scope`)).set(bearer(p1Owner)).send({ customerIds: [C1] });
    expect(scope.status).toBe(200);

    vehicle['C1'] = await addVehicle(c1Owner, C1, 'A');
    vehicle['C2'] = await addVehicle(c2Owner, C2, 'B');
    vehicle['C3'] = await addVehicle(c3Owner, C3, 'C');
  });
  afterAll(() => ctx.close());

  describe('registration and approval', () => {
    const TERMS = 'draft-2026-11';
    const register = (email: string) =>
      http(ctx).post(url('/providers/register')).send({ email, password: PASSWORD, companyName: `Trackers ${email.slice(0, 6)}`, contactName: 'Eve', acceptedTermsVersion: TERMS });

    it('register -> verify email -> pending approval -> approved (trial) and the owner can then create customers', async () => {
      const email = uniqueEmail('newprov');
      expect((await register(email)).status).toBe(202);
      const profile = () => ctx.system.providerProfile.findFirstOrThrow({ where: { contactEmail: email } });
      expect((await profile()).status).toBe('PENDING_VERIFICATION');
      expect((await login(ctx, email)).status).toBe(403);

      await http(ctx).post(url('/auth/verify-email')).send({ token: tokenFromMail(ctx.mail.lastTo(email)!.text) }).expect(204);
      const waiting = await profile();
      expect(waiting.status).toBe('PENDING_APPROVAL');

      // A pending provider cannot be approved by itself or by another provider.
      const owner = await login(ctx, email).then((r) => ({ accessToken: r.body.data.accessToken as string }));
      expect((await http(ctx).post(url(`/admin/providers/${waiting.organizationId}/approve`)).set(bearer(owner)).send({})).status).toBe(403);
      expect((await http(ctx).post(url(`/admin/providers/${waiting.organizationId}/approve`)).set(bearer(p2Owner)).send({})).status).toBe(403);

      await stepUp(ctx, platformOps);
      const ok = await http(ctx).post(url(`/admin/providers/${waiting.organizationId}/approve`)).set(bearer(platformOps)).send({ licenceNumber: 'RURA-1' });
      expect(ok.status).toBe(200);
      expect(ok.body.data.status).toBe('TRIAL');
      const after = await profile();
      expect(after.approvedAt).not.toBeNull();
      expect(after.licenceNumber).toBe('RURA-1');
      expect(ctx.mail.lastTo(email)!.subject).toMatch(/approved/i);

      // Approving twice is refused by the lifecycle table.
      const again = await http(ctx).post(url(`/admin/providers/${waiting.organizationId}/approve`)).set(bearer(platformOps)).send({});
      expect(again.status).toBe(409);
      expect(again.body.code).toBe('INVALID_PROVIDER_TRANSITION');
      expect(await ctx.system.auditLog.count({ where: { action: 'provider.approve', targetId: waiting.organizationId } })).toBe(1);
    });

    it('a rejected provider stays rejected; customers of an unapproved provider are sandbox only', async () => {
      const email = uniqueEmail('rejprov');
      await register(email);
      await http(ctx).post(url('/auth/verify-email')).send({ token: tokenFromMail(ctx.mail.lastTo(email)!.text) }).expect(204);
      const p = await ctx.system.providerProfile.findFirstOrThrow({ where: { contactEmail: email } });

      // Before approval the provider can already create customers, but they are sandbox organizations.
      const owner = await login(ctx, email).then((r) => ({ accessToken: r.body.data.accessToken as string }));
      const made = await http(ctx).post(url(`/organizations/${p.organizationId}/provider/customers`)).set(bearer(owner)).send({ name: 'Early customer', ownerEmail: uniqueEmail('early') });
      expect(made.status).toBe(201);
      expect(made.body.data.isSandbox).toBe(true);

      await stepUp(ctx, platformOps);
      expect((await http(ctx).post(url(`/admin/providers/${p.organizationId}/reject`)).set(bearer(platformOps)).send({ reason: 'No licence evidence' })).status).toBe(200);
      expect((await ctx.system.providerProfile.findUniqueOrThrow({ where: { organizationId: p.organizationId } })).rejectionReason).toBe('No licence evidence');
      const revive = await http(ctx).post(url(`/admin/providers/${p.organizationId}/approve`)).set(bearer(platformOps)).send({});
      expect(revive.status).toBe(409);
    });

    it('no real device can be registered in a sandbox organization (where unapproved providers work)', async () => {
      const sb = (await createOrg(ctx, { name: 'Sandbox customer', parentOrganizationId: P1 })).id;
      await ctx.system.organization.update({ where: { id: sb }, data: { isSandbox: true } });
      const owner = await addMemberAndLogin(ctx, sb, 'ORG_OWNER');
      const real = await http(ctx).post(url('/devices')).set(inOrg(owner, sb)).send({ uniqueId: `REAL-${Date.now()}` });
      expect(real.status).toBe(422);
      expect(real.body.code).toBe('REAL_DEVICE_NOT_ALLOWED_IN_SANDBOX');
      const sim = await http(ctx).post(url('/devices')).set(inOrg(owner, sb)).send({ uniqueId: `SIM-PROV-${Date.now()}` });
      expect(sim.status).toBe(201);
    });

    it('an unapproved-provider customer is real once the provider is approved (operating statuses only)', async () => {
      const made = await http(ctx).post(url(`/organizations/${P1}/provider/customers`)).set(bearer(p1Owner)).send({ name: 'Real customer', ownerEmail: uniqueEmail('real') });
      expect(made.status).toBe(201);
      expect(made.body.data.isSandbox).toBe(false);
    });
  });

  describe('API: another customer or provider is 404 at every level', () => {
    it.each([
      ['C2 owner -> C1 vehicles (same provider, other customer)', () => http(ctx).get(url('/vehicles')).set(inOrg(c2Owner, C1))],
      ['C3 owner -> C1 vehicles (other provider)', () => http(ctx).get(url('/vehicles')).set(inOrg(c3Owner, C1))],
      ['P2 owner -> C1 vehicles', () => http(ctx).get(url('/vehicles')).set(inOrg(p2Owner, C1))],
      ['P2 owner -> C1 organization', () => http(ctx).get(url(`/organizations/${C1}`)).set(bearer(p2Owner))],
      ['P2 owner -> P1 organization', () => http(ctx).get(url(`/organizations/${P1}`)).set(bearer(p2Owner))],
      ['C1 owner -> P1 organization', () => http(ctx).get(url(`/organizations/${P1}`)).set(bearer(c1Owner))],
      ['P1 staff scoped to C1 -> C2 vehicles', () => http(ctx).get(url('/vehicles')).set(inOrg(p1Scoped, C2))],
      ['P1 staff scoped to C1 -> C2 organization', () => http(ctx).get(url(`/organizations/${C2}`)).set(bearer(p1Scoped))],
      ['P1 staff -> C3 vehicles', () => http(ctx).get(url('/vehicles')).set(inOrg(p1Ops, C3))],
      ['forged X-Organization-Id of another customer', () => http(ctx).get(url('/vehicles')).set({ ...bearer(c2Owner), 'X-Organization-Id': C1 })],
      ['forged X-Organization-Id of another provider tree', () => http(ctx).get(url('/vehicles')).set({ ...bearer(p2Owner), 'X-Organization-Id': C1 })],
    ])('%s', async (_name, call) => {
      const res = await call();
      expect(res.status).toBe(404);
      expect(JSON.stringify(res.body)).not.toMatch(/Customer (One|Two|Three)|Provider (One|Two)/);
    });

    it('lists show only what each level may see', async () => {
      const names = async (user: TestUser, providerId: string) => {
        const r = await http(ctx).get(url(`/organizations/${providerId}/provider/customers`)).set(bearer(user));
        expect(r.status).toBe(200);
        return r.body.data.map((c: { name: string }) => c.name).sort();
      };
      expect(await names(p1Owner, P1)).toEqual(expect.arrayContaining(['Customer One', 'Customer Two']));
      expect(await names(p1Owner, P1)).not.toContain('Customer Three');
      expect(await names(p1Scoped, P1)).toEqual(['Customer One']);
      expect(await names(p2Owner, P2)).toEqual(['Customer Three']);
    });

    it('customer users cannot reach provider routes, and the memberships list never mixes trees', async () => {
      expect((await http(ctx).get(url(`/organizations/${C1}/provider/customers`)).set(bearer(c1Owner))).status).toBe(403);
      const mine = await http(ctx).get(url('/organizations')).set(bearer(p1Scoped));
      const ids = mine.body.data.map((m: { organization: { id: string } }) => m.organization.id);
      expect(ids).toEqual(expect.arrayContaining([P1, C1]));
      expect(ids).not.toContain(C2);
      expect(ids).not.toContain(C3);
    });
  });

  describe('provider staff acting for a customer', () => {
    it('operations see customer data and may edit vehicles, with permissions derived from the provider role', async () => {
      expect((await http(ctx).get(url('/vehicles')).set(inOrg(p1Ops, C1))).status).toBe(200);
      expect((await http(ctx).get(url('/vehicles')).set(inOrg(p1Ops, C2))).status).toBe(200);
      const made = await http(ctx).post(url('/vehicles')).set(inOrg(p1Ops, C1)).send({ registrationNumber: `RAP${Date.now() % 100000}` });
      expect(made.status).toBe(201);
      expect((await ctx.system.vehicle.findUniqueOrThrow({ where: { id: made.body.data.id } })).organizationId).toBe(C1);
    });

    it('a technician or finance user cannot read a customer’s tracking data; none can touch security or ownership', async () => {
      expect((await http(ctx).get(url('/vehicles')).set(inOrg(p1Tech, C1))).status).toBe(403);
      // Finance holds no customer-data permission at all: the customer is not even visible to them.
      expect((await http(ctx).get(url('/vehicles')).set(inOrg(p1Finance, C1))).status).toBe(404);
      const me = await http(ctx).get(url('/auth/me')).set({ ...bearer(p1Owner), 'X-Organization-Id': C1 });
      expect(me.status).toBe(200);
      for (const k of ['security.immobilize.request', 'security.restore.request', 'organization.transfer_ownership', 'roles.manage', 'organization.access_log.read']) {
        expect(me.body.data.permissions).not.toContain(k);
      }
    });

    it('every provider access is written to the access log, readable by the customer owner only', async () => {
      await http(ctx).get(url('/vehicles')).set(inOrg(p1Ops, C1)).expect(200);
      const log = await http(ctx).get(url(`/organizations/${C1}/access-log`)).set(bearer(c1Owner));
      expect(log.status).toBe(200);
      expect(log.body.data.length).toBeGreaterThan(0);
      expect(log.body.data[0]).toMatchObject({ action: 'access.customer_data', area: 'vehicles', actorOrganization: 'Your provider' });
      // Not for the provider's own staff, not for another customer.
      expect((await http(ctx).get(url(`/organizations/${C1}/access-log`)).set(bearer(p1Ops))).status).toBe(403);
      expect((await http(ctx).get(url(`/organizations/${C1}/access-log`)).set(bearer(c2Owner))).status).toBe(404);
      const other = await http(ctx).get(url(`/organizations/${C2}/access-log`)).set(bearer(c2Owner));
      expect(JSON.stringify(other.body.data)).not.toContain('Customer One');
    });
  });

  describe('database layer (RLS and consistency)', () => {
    const regs = async (run: <T>(fn: (tx: Parameters<Parameters<TenantPrismaService['run']>[0]>[0]) => Promise<T>) => Promise<T>) =>
      (await run((tx) => tx.vehicle.findMany({ select: { organizationId: true, providerId: true } }))).map((v) => `${v.organizationId}`);

    it('customer level sees exactly one organization; provider level sees its tree; nothing set sees nothing', async () => {
      expect(await regs((fn) => tenant.runInOrganization(C1, fn))).toEqual(expect.arrayContaining([C1]));
      expect(new Set(await regs((fn) => tenant.runInOrganization(C1, fn)))).toEqual(new Set([C1]));
      const p1 = new Set(await regs((fn) => tenant.runInProvider(P1, fn)));
      expect(p1.has(C1) && p1.has(C2)).toBe(true);
      expect(p1.has(C3)).toBe(false);
      expect(new Set(await regs((fn) => tenant.runInProvider(P2, fn)))).toEqual(new Set([C3]));
      expect(await ctx.prisma.vehicle.findMany()).toEqual([]); // application role, no tenant: zero rows
    });

    it('the database fills provider_id and rejects a mismatch', async () => {
      const v = await ctx.system.vehicle.findUniqueOrThrow({ where: { id: vehicle['C1']! } });
      expect(v.providerId).toBe(P1);
      await expect(
        ctx.system.vehicle.create({ data: { organizationId: C1, providerId: P2, registrationNumber: `BAD${Date.now() % 100000}` } }),
      ).rejects.toThrow(/provider_id does not match/i);
    });

    it('rejects invalid hierarchies: customer without provider, provider with parent, customer under customer', async () => {
      await expect(ctx.system.organization.create({ data: { name: 'Orphan', type: 'CUSTOMER', countryCode: 'RW', timezone: 'Africa/Kigali', currencyCode: 'RWF' } })).rejects.toThrow(/hierarchy/i);
      await expect(createOrg(ctx, { type: 'PROVIDER', parentOrganizationId: P1 })).rejects.toThrow(/hierarchy/i);
      await expect(createOrg(ctx, { type: 'CUSTOMER', parentOrganizationId: C1 })).rejects.toThrow(/hierarchy/i);
    });

    it('a staff scope can only list customers of the same provider', async () => {
      const m = await ctx.system.organizationMember.findFirstOrThrow({ where: { organizationId: P1, id: p1Scoped.memberId } });
      await expect(ctx.system.memberCustomerScope.create({ data: { organizationId: P1, memberId: m.id, customerOrganizationId: C3 } })).rejects.toThrow(/same provider/i);
    });

    it('a device can only be operated inside its own provider tree', async () => {
      const d = await ctx.system.gpsDevice.create({ data: { uniqueId: `PD-${Date.now()}`, ownerOrganizationId: P1, currentOrganizationId: C1 } });
      expect(d.providerId).toBe(P1);
      await expect(ctx.system.gpsDevice.update({ where: { id: d.id }, data: { currentOrganizationId: C3 } })).rejects.toThrow(/own provider/i);
    });
  });

  describe('provider console', () => {
    it('creates a customer and invites its owner; ids in the body are ignored; the invitation works once', async () => {
      const ownerEmail = uniqueEmail('newowner');
      const res = await http(ctx)
        .post(url(`/organizations/${P1}/provider/customers`))
        .set(bearer(p1Ops))
        .send({ name: 'Lakeside Tours', ownerEmail, organizationId: C3, parentOrganizationId: P2, providerId: P2, type: 'PLATFORM' });
      expect(res.status).toBe(201);
      const org = await ctx.system.organization.findUniqueOrThrow({ where: { id: res.body.data.id } });
      expect(org).toMatchObject({ type: 'CUSTOMER', parentOrganizationId: P1, providerId: P1 });
      expect(res.body.data.pendingInvitationCount).toBe(1);

      const mail = ctx.mail.lastTo(ownerEmail)!;
      expect(mail.subject).toMatch(/Provider One/);
      const token = tokenFromMail(mail.text);
      const accepted = await http(ctx).post(url('/invitations/accept')).send({ token, password: PASSWORD, fullName: 'Lake Owner' });
      expect(accepted.status).toBe(201);
      expect((await http(ctx).post(url('/invitations/accept')).send({ token, password: PASSWORD, fullName: 'Again' })).status).toBe(404);
      const owner = await login(ctx, ownerEmail).then((r) => ({ accessToken: r.body.data.accessToken as string }));
      expect((await http(ctx).get(url(`/organizations/${org.id}`)).set(bearer(owner))).status).toBe(200);
    });

    it('a technician cannot create customers, scoped staff cannot open other customers, other providers get 404', async () => {
      const body = { name: 'Nope', ownerEmail: uniqueEmail('nope') };
      expect((await http(ctx).post(url(`/organizations/${P1}/provider/customers`)).set(bearer(p1Tech)).send(body)).status).toBe(403);
      expect((await http(ctx).get(url(`/organizations/${P1}/provider/customers/${C2}`)).set(bearer(p1Scoped))).status).toBe(404);
      expect((await http(ctx).get(url(`/organizations/${P1}/provider/customers/${C1}`)).set(bearer(p1Scoped))).status).toBe(200);
      expect((await http(ctx).get(url(`/organizations/${P1}/provider/customers/${C1}`)).set(bearer(p2Owner))).status).toBe(404);
      expect((await http(ctx).get(url(`/organizations/${P1}/provider/customers`)).set(bearer(p2Owner))).status).toBe(404);
    });

    it('suspends and reactivates one customer without touching the others', async () => {
      await stepUp(ctx, p1Owner);
      expect((await http(ctx).post(url(`/organizations/${P1}/provider/customers/${C2}/suspend`)).set(bearer(p1Owner)).send({ reason: 'Unpaid' })).status).toBe(200);
      const blocked = await http(ctx).get(url('/vehicles')).set(inOrg(c2Owner, C2));
      expect(blocked.status).toBe(403);
      expect(blocked.body.code).toBe('ORGANIZATION_SUSPENDED');
      expect((await http(ctx).get(url('/vehicles')).set(inOrg(c1Owner, C1))).status).toBe(200);
      // Operations may not suspend.
      expect((await http(ctx).post(url(`/organizations/${P1}/provider/customers/${C1}/suspend`)).set(bearer(p1Ops)).send({})).status).toBe(403);
      expect((await http(ctx).post(url(`/organizations/${P1}/provider/customers/${C2}/reactivate`)).set(bearer(p1Owner))).status).toBe(200);
      expect((await http(ctx).get(url('/vehicles')).set(inOrg(c2Owner, C2))).status).toBe(200);
      expect(await ctx.system.auditLog.count({ where: { organizationId: C2, action: { in: ['customer.suspend', 'customer.reactivate'] } } })).toBe(2);
    });

    it('stores per-customer limits within the provider, never across providers or scopes', async () => {
      const body = { limits: [{ key: 'history_days', limitValue: 30 }, { key: 'security_features', enabled: false }] };
      const set = await http(ctx).put(url(`/organizations/${P1}/provider/customers/${C1}/limits`)).set(bearer(p1Owner)).send(body);
      expect(set.status).toBe(200);
      expect(set.body.data.find((l: { key: string }) => l.key === 'history_days')).toMatchObject({ limitValue: 30, enabled: null });
      expect(set.body.data.find((l: { key: string }) => l.key === 'security_features')).toMatchObject({ enabled: false });
      expect((await http(ctx).put(url(`/organizations/${P1}/provider/customers/${C2}/limits`)).set(bearer(p1Scoped)).send(body)).status).toBe(403); // no limits permission
      expect((await http(ctx).put(url(`/organizations/${P1}/provider/customers/${C3}/limits`)).set(bearer(p1Owner)).send(body)).status).toBe(404);
      expect((await http(ctx).put(url(`/organizations/${P1}/provider/customers/${C1}/limits`)).set(bearer(p1Owner)).send({ limits: [{ key: 'made_up' }] })).status).toBe(400);
    });

    it('staff scope changes need the owner/admin and step-up, and only touch the provider’s own staff and customers', async () => {
      const target = `/organizations/${P1}/provider/staff/${p1Scoped.memberId}/scope`;
      expect((await http(ctx).put(url(target)).set(bearer(p1Ops)).send({ customerIds: null })).status).toBe(403);
      expect((await http(ctx).put(url(target)).set(bearer(p1Owner)).send({ customerIds: [C3] })).status).toBe(404);
      const other = await addMember(ctx, P2, 'PROVIDER_OPERATIONS');
      expect((await http(ctx).put(url(`/organizations/${P1}/provider/staff/${other.member.id}/scope`)).set(bearer(p1Owner)).send({ customerIds: [C1] })).status).toBe(404);
    });
  });

  describe('suspension keeps customers neutral', () => {
    it('a suspended provider is blocked, its customers see a neutral message, and reactivation restores everything', async () => {
      const prov = await makeProvider('Suspendable');
      const cust = (await createOrg(ctx, { name: 'Their customer', parentOrganizationId: prov })).id;
      const owner = await addMemberAndLogin(ctx, prov, 'PROVIDER_OWNER');
      const custOwner = await addMemberAndLogin(ctx, cust, 'ORG_OWNER');

      await stepUp(ctx, platformOps);
      expect((await http(ctx).post(url(`/admin/providers/${prov}/suspend`)).set(bearer(platformOps)).send({ reason: 'Unpaid invoices' })).status).toBe(200);
      expect((await http(ctx).get(url(`/organizations/${prov}/provider/profile`)).set(bearer(owner))).status).toBe(403);
      const neutral = await http(ctx).get(url('/vehicles')).set(inOrg(custOwner, cust));
      expect(neutral.status).toBe(403);
      expect(neutral.body.code).toBe('SERVICE_TEMPORARILY_UNAVAILABLE');
      expect(JSON.stringify(neutral.body)).not.toMatch(/Unpaid|Suspendable/);
      // Nothing was deleted.
      expect(await ctx.system.organization.count({ where: { id: { in: [prov, cust] } } })).toBe(2);

      expect((await http(ctx).post(url(`/admin/providers/${prov}/reactivate`)).set(bearer(platformOps))).status).toBe(200);
      expect((await http(ctx).get(url('/vehicles')).set(inOrg(custOwner, cust))).status).toBe(200);
      expect((await http(ctx).get(url(`/organizations/${prov}/provider/profile`)).set(bearer(owner))).status).toBe(200);
    });
  });

  describe('branding', () => {
    it('the owner sets it; the public resolve returns display data only; unknown addresses get the neutral brand', async () => {
      const slug = `one-${Date.now() % 100000}`;
      const set = await http(ctx)
        .patch(url(`/organizations/${P1}/provider/branding`))
        .set(bearer(p1Owner))
        .send({ slug, displayName: 'Provider One Tracking', primaryColor: '#B00020', supportPhone: '+250788000000' });
      expect(set.status).toBe(200);

      const resolved = await http(ctx).get(url(`/branding/resolve?slug=${slug}`));
      expect(resolved.status).toBe(200);
      expect(resolved.body.data).toMatchObject({ displayName: 'Provider One Tracking', primaryColor: '#B00020', onPrimaryColor: '#FFFFFF', neutral: false });
      expect(Object.keys(resolved.body.data)).not.toEqual(expect.arrayContaining(['contactEmail', 'tin', 'status', 'organizationId', 'licenceNumber']));

      const unknown = await http(ctx).get(url('/branding/resolve?slug=no-such-provider'));
      const none = await http(ctx).get(url('/branding/resolve'));
      expect(unknown.status).toBe(200);
      expect(unknown.body.data).toEqual(none.body.data);
      expect(unknown.body.data.neutral).toBe(true);

      // A customer sees the branding of its own provider (never another provider's).
      expect((await http(ctx).get(url(`/organizations/${C1}/branding`)).set(bearer(c1Owner))).body.data.displayName).toBe('Provider One Tracking');
      expect((await http(ctx).get(url(`/organizations/${C3}/branding`)).set(bearer(c3Owner))).body.data.displayName).not.toBe('Provider One Tracking');
    });

    it('validates colours and slugs, refuses a taken address and non-owners', async () => {
      const patch = (user: TestUser, providerId: string, body: object) => http(ctx).patch(url(`/organizations/${providerId}/provider/branding`)).set(bearer(user)).send(body);
      expect((await patch(p1Owner, P1, { primaryColor: 'red' })).status).toBe(400);
      expect((await patch(p1Owner, P1, { slug: 'A b' })).status).toBe(400);
      const taken = (await ctx.system.providerProfile.findUniqueOrThrow({ where: { organizationId: P1 } })).slug!;
      const clash = await patch(p2Owner, P2, { slug: taken });
      expect(clash.status).toBe(409);
      expect(clash.body.code).toBe('BRANDING_SLUG_TAKEN');
      expect((await patch(p1Ops, P1, { displayName: 'Hijack' })).status).toBe(403);
      expect((await patch(p1Owner, P2, { displayName: 'Hijack' })).status).toBe(404);
    });
  });

  describe('public sign-up is for providers only', () => {
    it('the platform admin lists providers; providers and customers cannot', async () => {
      const list = await http(ctx).get(url('/admin/providers?pageSize=100')).set(bearer(platformOps));
      expect(list.status).toBe(200);
      expect(list.body.data.map((p: { companyName: string }) => p.companyName)).toEqual(expect.arrayContaining(['Provider One', 'Provider Two']));
      expect((await http(ctx).get(url('/admin/providers')).set(bearer(p1Owner))).status).toBe(403);
      expect((await http(ctx).get(url('/admin/providers')).set(bearer(c1Owner))).status).toBe(403);
    });
  });
});
