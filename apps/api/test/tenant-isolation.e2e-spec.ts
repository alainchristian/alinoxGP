import { randomUUID } from 'node:crypto';
import { TenantPrismaService } from '../src/infrastructure/prisma/prisma.service';
import {
  addMember,
  addMemberAndLogin,
  bearer,
  createOrg,
  createTestApp,
  http,
  PASSWORD,
  registerUser,
  stepUp,
  uniqueEmail,
  url,
  type TestCtx,
  type TestUser,
} from './helpers';

/**
 * Mandatory tenant-isolation suite (skill gps-tenant-isolation §7).
 * Fixture: Org A and Org B (self-registered owners), Reseller R1 -> child C1, Reseller R2 -> child C2.
 */
describe('Tenant isolation (e2e)', () => {
  let ctx: TestCtx;
  let tenant: TenantPrismaService;
  let ownerA: TestUser & { organizationId?: string };
  let ownerB: TestUser & { organizationId?: string };
  let A: string;
  let B: string;
  let R1: string, C1: string, R2: string, C2: string;
  let r1Admin: TestUser, r2Admin: TestUser, c1Owner: TestUser, c2Owner: TestUser;
  let memberOfA: { memberId: string; email: string };
  let invitationOfA: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = ctx.app.get(TenantPrismaService);

    ownerA = await registerUser(ctx, { organizationName: 'Org A' });
    ownerB = await registerUser(ctx, { organizationName: 'Org B' });
    A = ownerA.organizationId!;
    B = ownerB.organizationId!;

    R1 = (await createOrg(ctx, { name: 'Reseller 1', type: 'RESELLER' })).id;
    R2 = (await createOrg(ctx, { name: 'Reseller 2', type: 'RESELLER' })).id;
    C1 = (await createOrg(ctx, { name: 'Customer 1', parentOrganizationId: R1 })).id;
    C2 = (await createOrg(ctx, { name: 'Customer 2', parentOrganizationId: R2 })).id;
    r1Admin = await addMemberAndLogin(ctx, R1, 'RESELLER_ADMIN');
    r2Admin = await addMemberAndLogin(ctx, R2, 'RESELLER_ADMIN');
    c1Owner = await addMemberAndLogin(ctx, C1, 'ORG_OWNER');
    c2Owner = await addMemberAndLogin(ctx, C2, 'ORG_OWNER');

    const viewer = await addMember(ctx, A, 'VIEWER');
    memberOfA = { memberId: viewer.member.id, email: viewer.email };
    await stepUp(ctx, ownerA);
    const inv = await http(ctx).post(url(`/organizations/${A}/invitations`)).set(bearer(ownerA)).send({ email: uniqueEmail('pending'), roleKey: 'VIEWER' });
    expect(inv.status).toBe(201);
    invitationOfA = inv.body.data.id;
  });
  afterAll(() => ctx.close());

  describe('API: another tenant’s resources are 404, never 403 and never data', () => {
    const asB = () => bearer(ownerB);

    it.each([
      ['GET org', () => http(ctx).get(url(`/organizations/${A}`)).set(asB())],
      ['PATCH org', () => http(ctx).patch(url(`/organizations/${A}`)).set(asB()).send({ name: 'Hijacked' })],
      ['GET members', () => http(ctx).get(url(`/organizations/${A}/members`)).set(asB())],
      ['GET invitations', () => http(ctx).get(url(`/organizations/${A}/invitations`)).set(asB())],
      ['POST invitation', () => http(ctx).post(url(`/organizations/${A}/invitations`)).set(asB()).send({ email: uniqueEmail(), roleKey: 'VIEWER' })],
      ['DELETE invitation', () => http(ctx).delete(url(`/organizations/${A}/invitations/${invitationOfA}`)).set(asB())],
      ['PATCH member', () => http(ctx).patch(url(`/organizations/${A}/members/${memberOfA.memberId}`)).set(asB()).send({ status: 'SUSPENDED' })],
      ['DELETE member', () => http(ctx).delete(url(`/organizations/${A}/members/${memberOfA.memberId}`)).set(asB())],
      ['GET roles', () => http(ctx).get(url(`/organizations/${A}/roles`)).set(asB())],
    ])('%s of Org A by an Org B user -> 404', async (_name, call) => {
      const res = await call();
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('ORGANIZATION_NOT_FOUND');
      expect(JSON.stringify(res.body)).not.toContain('Org A');
    });

    it('Org A’s data was not changed by those attempts', async () => {
      const org = await ctx.system.organization.findUniqueOrThrow({ where: { id: A } });
      expect(org.name).toBe('Org A');
      expect(await ctx.system.organizationMember.count({ where: { id: memberOfA.memberId } })).toBe(1);
      expect(await ctx.system.invitation.count({ where: { id: invitationOfA, revokedAt: null } })).toBe(1);
    });

    it('using Org A’s member / invitation ids inside Org B’s own path finds nothing', async () => {
      await stepUp(ctx, ownerB);
      const m = await http(ctx).patch(url(`/organizations/${B}/members/${memberOfA.memberId}`)).set(asB()).send({ status: 'SUSPENDED' });
      expect(m.status).toBe(404);
      expect(m.body.code).toBe('MEMBER_NOT_FOUND');
      const i = await http(ctx).delete(url(`/organizations/${B}/invitations/${invitationOfA}`)).set(asB());
      expect(i.status).toBe(404);
      expect(i.body.code).toBe('INVITATION_NOT_FOUND');
    });

    it('list endpoints return none of Org A’s records to Org B', async () => {
      const members = await http(ctx).get(url(`/organizations/${B}/members`)).set(asB());
      expect(members.status).toBe(200);
      const emails = members.body.data.map((m: { email: string }) => m.email);
      expect(emails).toEqual([ownerB.email]);
      expect(JSON.stringify(members.body)).not.toContain(memberOfA.email);

      const mine = await http(ctx).get(url('/organizations')).set(asB());
      expect(mine.body.data.map((m: { organization: { id: string } }) => m.organization.id)).toEqual([B]);

      const invs = await http(ctx).get(url(`/organizations/${B}/invitations`)).set(asB());
      expect(invs.body.data).toEqual([]);
    });

    it('a forged X-Organization-Id never widens access', async () => {
      // Header conflicting with the path is rejected.
      const mismatch = await http(ctx).get(url(`/organizations/${B}/members`)).set(asB()).set('X-Organization-Id', A);
      expect(mismatch.status).toBe(400);
      expect(mismatch.body.code).toBe('ORGANIZATION_MISMATCH');
      // Header for a non-member org does not become the active organization.
      const me = await http(ctx).get(url('/auth/me')).set(asB()).set('X-Organization-Id', A);
      expect(me.body.data.activeOrganizationId).toBeNull();
      expect(me.body.data.permissions).toEqual([]);
      // Malformed ids are 404, not 500.
      const junk = await http(ctx).get(url('/organizations/not-a-uuid/members')).set(asB());
      expect(junk.status).toBe(404);
    });

    it('a tenant id in the body is ignored', async () => {
      await stepUp(ctx, ownerB);
      const res = await http(ctx)
        .post(url(`/organizations/${B}/invitations`))
        .set(asB())
        .send({ email: uniqueEmail('inbody'), roleKey: 'VIEWER', organizationId: A });
      expect(res.status).toBe(201);
      const stored = await ctx.system.invitation.findUniqueOrThrow({ where: { id: res.body.data.id } });
      expect(stored.organizationId).toBe(B);

      const created = await http(ctx).post(url('/organizations')).set(asB()).send({ name: 'Mine', organizationId: A, parentOrganizationId: A, type: 'PLATFORM' });
      expect(created.status).toBe(201);
      expect(created.body.data.type).toBe('CUSTOMER');
      expect(created.body.data.parentOrganizationId).toBeNull();
    });

    it('unauthenticated requests never reach tenant data', async () => {
      expect((await http(ctx).get(url(`/organizations/${A}/members`))).status).toBe(401);
    });
  });

  describe('Database: row-level security', () => {
    it('with no tenant context the app role sees zero rows of every tenant table', async () => {
      expect(await ctx.prisma.organizationMember.count()).toBe(0);
      expect(await ctx.prisma.invitation.count()).toBe(0);
      expect(await ctx.prisma.memberRole.count()).toBe(0);
      expect(await ctx.prisma.auditLog.count()).toBe(0);
      expect(await ctx.prisma.organization.count()).toBe(0);
      // ...while the rows do exist.
      expect(await ctx.system.organizationMember.count()).toBeGreaterThan(0);
    });

    it('with app.current_org_id = A only Org A rows are visible; B sees only B', async () => {
      const a = await tenant.runInOrganization(A, (tx) => tx.organizationMember.findMany());
      expect(a.length).toBeGreaterThan(0);
      expect(new Set(a.map((m) => m.organizationId))).toEqual(new Set([A]));
      const b = await tenant.runInOrganization(B, (tx) => tx.organizationMember.findMany());
      expect(new Set(b.map((m) => m.organizationId))).toEqual(new Set([B]));
      const orgs = await tenant.runInOrganization(A, (tx) => tx.organization.findMany());
      expect(orgs.map((o) => o.id)).toEqual([A]);
    });

    it('the tenant setting is transaction-local: it does not leak to the next use of a pooled connection', async () => {
      await tenant.runInOrganization(A, (tx) => tx.organizationMember.count());
      for (let i = 0; i < 20; i++) expect(await ctx.prisma.organizationMember.count()).toBe(0);
      const setting = await ctx.prisma.$queryRaw<{ v: string | null }[]>`SELECT current_setting('app.current_org_id', true) AS v`;
      expect([null, '']).toContain(setting[0]!.v);
    });

    it('concurrent requests for different tenants never see each other’s rows', async () => {
      const jobs = Array.from({ length: 40 }, (_, i) => {
        const org = i % 2 === 0 ? A : B;
        return tenant.runInOrganization(org, async (tx) => {
          await new Promise((r) => setTimeout(r, Math.random() * 15));
          const rows = await tx.organizationMember.findMany();
          return { org, orgs: new Set(rows.map((r) => r.organizationId)) };
        });
      });
      for (const r of await Promise.all(jobs)) expect(r.orgs).toEqual(new Set([r.org]));
    });

    it('WITH CHECK blocks writing a row for another tenant', async () => {
      const user = await ctx.users.create({ email: uniqueEmail(), passwordHash: 'x', fullName: 'x' });
      await expect(
        tenant.runInOrganization(B, (tx) => tx.organizationMember.create({ data: { organizationId: A, userId: user.id } })),
      ).rejects.toThrow();
      expect(await ctx.system.organizationMember.count({ where: { userId: user.id } })).toBe(0);
    });

    it('composite foreign key makes a cross-tenant role grant impossible even for the system role', async () => {
      const role = await ctx.system.role.findUniqueOrThrow({ where: { key: 'VIEWER' } });
      await expect(
        ctx.system.memberRole.create({ data: { organizationId: B, memberId: memberOfA.memberId, roleId: role.id } }),
      ).rejects.toThrow(/foreign key/i);
    });

    it('every table that has an organization_id column has RLS enabled and forced', async () => {
      const rows = await ctx.system.$queryRaw<{ table: string; rls: boolean; forced: boolean }[]>`
        SELECT c.relname AS "table", c.relrowsecurity AS rls, c.relforcerowsecurity AS forced
        FROM pg_attribute a
        JOIN pg_class c ON c.oid = a.attrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE a.attname = 'organization_id' AND n.nspname = 'public' AND c.relkind = 'r' AND NOT a.attisdropped`;
      expect(rows.length).toBeGreaterThanOrEqual(4);
      const unprotected = rows.filter((r) => !r.rls || !r.forced).map((r) => r.table);
      expect(unprotected).toEqual([]);
      const orgs = await ctx.system.$queryRaw<{ rls: boolean; forced: boolean }[]>`
        SELECT relrowsecurity AS rls, relforcerowsecurity AS forced FROM pg_class WHERE relname = 'organizations'`;
      expect(orgs[0]).toEqual({ rls: true, forced: true });
    });

    it('the application role is neither a superuser, the owner, nor able to bypass RLS', async () => {
      const r = await ctx.prisma.$queryRaw<{ super: boolean; bypass: boolean; owner: boolean }[]>`
        SELECT r.rolsuper AS super, r.rolbypassrls AS bypass,
               EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'organization_members' AND tableowner = current_user) AS owner
        FROM pg_roles r WHERE r.rolname = current_user`;
      expect(r[0]).toEqual({ super: false, bypass: false, owner: false });
    });
  });

  describe('Reseller hierarchy', () => {
    it('R1 sees its child C1 (and not C2); C1 and R2 cannot see R1', async () => {
      const mine = await http(ctx).get(url('/organizations')).set(bearer(r1Admin));
      const byRelation = mine.body.data.map((m: { organization: { id: string }; relation: string }) => [m.organization.id, m.relation]);
      expect(byRelation).toEqual(expect.arrayContaining([[R1, 'MEMBER'], [C1, 'CHILD']]));
      expect(byRelation.map((x: string[]) => x[0])).not.toContain(C2);

      expect((await http(ctx).get(url(`/organizations/${C1}`)).set(bearer(r1Admin))).status).toBe(200);
      expect((await http(ctx).get(url(`/organizations/${C2}`)).set(bearer(r1Admin))).status).toBe(404);
      expect((await http(ctx).get(url(`/organizations/${C1}/members`)).set(bearer(r2Admin))).status).toBe(404);
      expect((await http(ctx).get(url(`/organizations/${R1}`)).set(bearer(c1Owner))).status).toBe(404);
      expect((await http(ctx).get(url(`/organizations/${C2}`)).set(bearer(c1Owner))).status).toBe(404);
      expect((await http(ctx).get(url(`/organizations/${R1}`)).set(bearer(r2Admin))).status).toBe(404);
      expect((await http(ctx).get(url(`/organizations/${C2}`)).set(bearer(c2Owner))).status).toBe(200);
    });

    it('a reseller acting for a child customer is read-only', async () => {
      const read = await http(ctx).get(url(`/organizations/${C1}/members`)).set(bearer(r1Admin));
      expect(read.status).toBe(200);
      expect(read.body.data.map((m: { email: string }) => m.email)).toEqual([c1Owner.email]);

      await stepUp(ctx, r1Admin);
      const patch = await http(ctx).patch(url(`/organizations/${C1}`)).set(bearer(r1Admin)).send({ name: 'Taken over' });
      expect(patch.status).toBe(403);
      const invite = await http(ctx).post(url(`/organizations/${C1}/invitations`)).set(bearer(r1Admin)).send({ email: uniqueEmail(), roleKey: 'VIEWER' });
      expect(invite.status).toBe(403);
      expect((await ctx.system.organization.findUniqueOrThrow({ where: { id: C1 } })).name).toBe('Customer 1');
    });

    it('the database rejects invalid hierarchies (only RESELLER -> CUSTOMER, one level)', async () => {
      await expect(createOrg(ctx, { type: 'CUSTOMER', parentOrganizationId: A })).rejects.toThrow(/hierarchy/i);
      await expect(createOrg(ctx, { type: 'RESELLER', parentOrganizationId: R1 })).rejects.toThrow(/hierarchy/i);
      await expect(createOrg(ctx, { type: 'CUSTOMER', parentOrganizationId: C1 })).rejects.toThrow(/hierarchy/i);
    });
  });

  describe('Database invariants', () => {
    it('allows exactly one Organization Owner per organization', async () => {
      const ownerRole = await ctx.system.role.findUniqueOrThrow({ where: { key: 'ORG_OWNER' } });
      const second = await addMember(ctx, A, 'VIEWER');
      await expect(
        ctx.system.memberRole.create({ data: { organizationId: A, memberId: second.member.id, roleId: ownerRole.id } }),
      ).rejects.toThrow(/already has an owner/i);
    });

    it('a role can only be granted inside an organization of the matching type', async () => {
      const platformRole = await ctx.system.role.findUniqueOrThrow({ where: { key: 'PLATFORM_SUPER_ADMIN' } });
      const m = await addMember(ctx, A, 'VIEWER');
      await expect(
        ctx.system.memberRole.create({ data: { organizationId: A, memberId: m.member.id, roleId: platformRole.id } }),
      ).rejects.toThrow(/cannot be granted/i);
    });

    it('audit_logs is append-only for every role', async () => {
      const row = await ctx.system.auditLog.create({ data: { action: 'test.append_only', organizationId: A } });
      await expect(ctx.system.auditLog.update({ where: { id: row.id }, data: { action: 'tampered' } })).rejects.toThrow();
      await expect(ctx.system.auditLog.delete({ where: { id: row.id } })).rejects.toThrow();
      await expect(tenant.runInOrganization(A, (tx) => tx.auditLog.update({ where: { id: row.id }, data: { action: 'tampered' } }))).rejects.toThrow();
      await expect(tenant.runInOrganization(A, (tx) => tx.auditLog.deleteMany({ where: { id: row.id } }))).rejects.toThrow();
      await expect(ctx.system.$executeRaw`TRUNCATE audit_logs`).rejects.toThrow();
      expect((await ctx.system.auditLog.findUniqueOrThrow({ where: { id: row.id } })).action).toBe('test.append_only');
    });

    it('audit rows of one tenant are invisible to another', async () => {
      const marker = `marker-${randomUUID()}`;
      await ctx.system.auditLog.create({ data: { action: marker, organizationId: A } });
      const seenByB = await tenant.runInOrganization(B, (tx) => tx.auditLog.findMany({ where: { action: marker } }));
      const seenByA = await tenant.runInOrganization(A, (tx) => tx.auditLog.findMany({ where: { action: marker } }));
      expect(seenByB).toHaveLength(0);
      expect(seenByA).toHaveLength(1);
    });
  });

  describe('Invitations cannot be used to cross tenants', () => {
    it('an invitation for Org A accepted by a user adds them to A only, once', async () => {
      await stepUp(ctx, ownerA);
      const email = uniqueEmail('joiner');
      const inv = await http(ctx).post(url(`/organizations/${A}/invitations`)).set(bearer(ownerA)).send({ email, roleKey: 'FLEET_MANAGER' });
      expect(inv.status).toBe(201);
      const mail = ctx.mail.lastTo(email)!;
      const token = /token=([\w-]+)/.exec(mail.text)![1]!;

      const lookup = await http(ctx).post(url('/invitations/lookup')).send({ token });
      expect(lookup.body.data).toMatchObject({ organizationName: 'Org A', email, accountExists: false });

      const accept = await http(ctx).post(url('/invitations/accept')).send({ token, password: PASSWORD, fullName: 'Joiner' });
      expect(accept.status).toBe(201);
      expect(accept.body.data.organizationId).toBe(A);
      expect((await http(ctx).post(url('/invitations/accept')).send({ token, password: PASSWORD, fullName: 'Joiner' })).status).toBe(404);

      const joiner = await ctx.system.user.findUniqueOrThrow({ where: { email } });
      const memberships = await ctx.system.organizationMember.findMany({ where: { userId: joiner.id } });
      expect(memberships.map((m) => m.organizationId)).toEqual([A]);
    });

    it('an existing account can only accept an invitation addressed to its own email', async () => {
      await stepUp(ctx, ownerA);
      const target = await registerUser(ctx);
      const inv = await http(ctx).post(url(`/organizations/${A}/invitations`)).set(bearer(ownerA)).send({ email: target.email, roleKey: 'VIEWER' });
      expect(inv.status).toBe(201);
      const token = /token=([\w-]+)/.exec(ctx.mail.lastTo(target.email)!.text)![1]!;

      const wrongUser = await http(ctx).post(url('/invitations/accept-existing')).set(bearer(ownerB)).send({ token });
      expect(wrongUser.status).toBe(404);
      const ok = await http(ctx).post(url('/invitations/accept-existing')).set(bearer(target)).send({ token });
      expect(ok.status).toBe(200);
    });
  });
});
