import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { METHOD_METADATA } from '@nestjs/common/constants';
import { P, ROLE_KEYS, SYSTEM_ROLES, type PermissionKey } from '@gps/shared';
import {
  IS_AUTHENTICATED,
  IS_PUBLIC,
  NO_TENANT,
  REQUIRED_PERMISSIONS,
} from '../src/common/decorators';
import {
  addMember,
  addMemberAndLogin,
  bearer,
  createTestApp,
  http,
  registerUser,
  stepUp,
  uniqueEmail,
  url,
  type TestCtx,
  type TestUser,
} from './helpers';

describe('Permissions, roles and step-up (e2e)', () => {
  let ctx: TestCtx;
  let owner: TestUser & { organizationId?: string };
  let org: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    owner = await registerUser(ctx, { organizationName: 'Perm Org' });
    org = owner.organizationId!;
  });
  afterAll(() => ctx.close());

  const customerRoles = SYSTEM_ROLES.filter((r) => r.scope === 'ORGANIZATION');
  const has = (roleKey: string, p: PermissionKey) => SYSTEM_ROLES.find((r) => r.key === roleKey)!.permissions.includes(p);

  describe('default role matrix — each role gets exactly what its bundle grants', () => {
    it.each(customerRoles.map((r) => [r.key]))('%s', async (roleKey) => {
      // Exactly one owner per organization (DB-enforced), so the owner row uses the real owner.
      const user = roleKey === ROLE_KEYS.ORG_OWNER ? owner : await addMemberAndLogin(ctx, org, roleKey);

      const members =await http(ctx).get(url(`/organizations/${org}/members`)).set(bearer(user));
      expect(members.status).toBe(has(roleKey, P.USERS_READ) ? 200 : 403);

      const roles = await http(ctx).get(url(`/organizations/${org}/roles`)).set(bearer(user));
      expect(roles.status).toBe(has(roleKey, P.ROLES_READ) ? 200 : 403);

      const read = await http(ctx).get(url(`/organizations/${org}`)).set(bearer(user));
      expect(read.status).toBe(has(roleKey, P.ORGANIZATION_READ) ? 200 : 403);

      const patch = await http(ctx).patch(url(`/organizations/${org}`)).set(bearer(user)).send({ locale: 'en' });
      expect(patch.status).toBe(has(roleKey, P.ORGANIZATION_UPDATE) ? 200 : 403);

      const invite = await http(ctx).post(url(`/organizations/${org}/invitations`)).set(bearer(user)).send({ email: uniqueEmail(), roleKey: ROLE_KEYS.VIEWER });
      // Viewer bundle is a subset of Owner/Admin permissions, so a permitted inviter may grant it.
      expect(invite.status).toBe(has(roleKey, P.USERS_INVITE) ? 201 : 403);
      if (invite.status === 403) expect(invite.body.code).toBe('PERMISSION_DENIED');
    });

    it('the Fleet Manager has no immobilize/restore permission (spec §7 example)', () => {
      expect(has(ROLE_KEYS.FLEET_MANAGER, P.SECURITY_IMMOBILIZE_REQUEST)).toBe(false);
      expect(has(ROLE_KEYS.FLEET_MANAGER, P.SECURITY_RESTORE_REQUEST)).toBe(false);
      expect(has(ROLE_KEYS.SECURITY_MANAGER, P.SECURITY_IMMOBILIZE_REQUEST)).toBe(true);
    });

    it('/auth/me reports the effective permissions of the active membership', async () => {
      const user = await addMemberAndLogin(ctx, org, ROLE_KEYS.SECURITY_MANAGER);
      const me = await http(ctx).get(url('/auth/me')).set(bearer(user));
      expect(me.body.data.activeOrganizationId).toBe(org);
      expect(new Set(me.body.data.permissions)).toEqual(new Set(SYSTEM_ROLES.find((r) => r.key === ROLE_KEYS.SECURITY_MANAGER)!.permissions));
    });
  });

  describe('granting roles', () => {
    it('refuses roles that cannot be assigned or do not exist in this organization type', async () => {
      await stepUp(ctx, owner);
      const asOwner = await http(ctx).post(url(`/organizations/${org}/invitations`)).set(bearer(owner)).send({ email: uniqueEmail(), roleKey: ROLE_KEYS.ORG_OWNER });
      expect(asOwner.status).toBe(403);
      expect(asOwner.body.code).toBe('ROLE_NOT_ASSIGNABLE');
      const platform = await http(ctx).post(url(`/organizations/${org}/invitations`)).set(bearer(owner)).send({ email: uniqueEmail(), roleKey: ROLE_KEYS.PLATFORM_SUPER_ADMIN });
      expect(platform.status).toBe(404);
      const unknown = await http(ctx).post(url(`/organizations/${org}/invitations`)).set(bearer(owner)).send({ email: uniqueEmail(), roleKey: 'NOT_A_ROLE' });
      expect(unknown.status).toBe(404);
    });

    it('prevents privilege escalation: you cannot grant permissions you do not hold', async () => {
      // A custom role that may invite people but holds nothing else.
      const inviteOnly = await ctx.system.role.create({ data: { scope: 'ORGANIZATION', key: `INVITE_ONLY_${Date.now()}`, name: 'Invite only', isSystem: false } });
      const perm = await ctx.system.permission.findUniqueOrThrow({ where: { key: P.USERS_INVITE } });
      await ctx.system.rolePermission.create({ data: { roleId: inviteOnly.id, permissionId: perm.id } });
      const { user, member, email } = await addMember(ctx, org, ROLE_KEYS.VIEWER);
      void user;
      await ctx.system.memberRole.deleteMany({ where: { memberId: member.id } });
      await ctx.system.memberRole.create({ data: { organizationId: org, memberId: member.id, roleId: inviteOnly.id } });
      const { signIn } = await import('./helpers');
      const inviter = await signIn(ctx, email);

      const res = await http(ctx).post(url(`/organizations/${org}/invitations`)).set(bearer(inviter)).send({ email: uniqueEmail(), roleKey: ROLE_KEYS.FLEET_MANAGER });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('ROLE_EXCEEDS_YOUR_PERMISSIONS');
    });
  });

  describe('step-up authentication and member changes', () => {
    it('requires a fresh step-up for role changes; expires after 5 minutes', async () => {
      const target = await addMemberAndLogin(ctx, org, ROLE_KEYS.VIEWER);
      const fresh = await registerUser(ctx, { organizationName: 'Step Org' });
      const targetInFresh = await addMemberAndLogin(ctx, fresh.organizationId!, ROLE_KEYS.VIEWER);

      const noStepUp = await http(ctx).patch(url(`/organizations/${fresh.organizationId}/members/${targetInFresh.memberId}`)).set(bearer(fresh)).send({ roleKeys: [ROLE_KEYS.FLEET_MANAGER] });
      expect(noStepUp.status).toBe(403);
      expect(noStepUp.body.code).toBe('STEP_UP_REQUIRED');

      await stepUp(ctx, fresh);
      const ok = await http(ctx).patch(url(`/organizations/${fresh.organizationId}/members/${targetInFresh.memberId}`)).set(bearer(fresh)).send({ roleKeys: [ROLE_KEYS.FLEET_MANAGER] });
      expect(ok.status).toBe(200);
      expect(ok.body.data.roleKeys).toEqual([ROLE_KEYS.FLEET_MANAGER]);

      await ctx.system.session.updateMany({ where: { userId: fresh.id }, data: { stepUpAt: new Date(Date.now() - 6 * 60_000) } });
      const stale = await http(ctx).patch(url(`/organizations/${fresh.organizationId}/members/${targetInFresh.memberId}`)).set(bearer(fresh)).send({ roleKeys: [ROLE_KEYS.VIEWER] });
      expect(stale.body.code).toBe('STEP_UP_REQUIRED');
      void target;
    });

    it('a role change takes effect on the very next request (permission cache is invalidated)', async () => {
      const boss = await registerUser(ctx, { organizationName: 'Cache Org' });
      const o = boss.organizationId!;
      const member = await addMemberAndLogin(ctx, o, ROLE_KEYS.VIEWER);
      expect((await http(ctx).get(url(`/organizations/${o}/members`)).set(bearer(member))).status).toBe(403); // primes the cache

      await stepUp(ctx, boss);
      const up = await http(ctx).patch(url(`/organizations/${o}/members/${member.memberId}`)).set(bearer(boss)).send({ roleKeys: [ROLE_KEYS.ORG_ADMIN] });
      expect(up.status).toBe(200);
      expect((await http(ctx).get(url(`/organizations/${o}/members`)).set(bearer(member))).status).toBe(200);

      const down = await http(ctx).patch(url(`/organizations/${o}/members/${member.memberId}`)).set(bearer(boss)).send({ roleKeys: [ROLE_KEYS.VIEWER] });
      expect(down.status).toBe(200);
      expect((await http(ctx).get(url(`/organizations/${o}/members`)).set(bearer(member))).status).toBe(403);
    });

    it('suspending or removing a member locks them out immediately (404, not data)', async () => {
      const boss = await registerUser(ctx, { organizationName: 'Lockout Org' });
      const o = boss.organizationId!;
      const m1 = await addMemberAndLogin(ctx, o, ROLE_KEYS.ORG_ADMIN);
      const m2 = await addMemberAndLogin(ctx, o, ROLE_KEYS.ORG_ADMIN);
      await stepUp(ctx, boss);

      expect((await http(ctx).patch(url(`/organizations/${o}/members/${m1.memberId}`)).set(bearer(boss)).send({ status: 'SUSPENDED' })).status).toBe(200);
      expect((await http(ctx).get(url(`/organizations/${o}/members`)).set(bearer(m1))).status).toBe(404);

      expect((await http(ctx).delete(url(`/organizations/${o}/members/${m2.memberId}`)).set(bearer(boss))).status).toBe(204);
      expect((await http(ctx).get(url(`/organizations/${o}/members`)).set(bearer(m2))).status).toBe(404);
    });

    it('protects the owner and forbids self-modification', async () => {
      const boss = await registerUser(ctx, { organizationName: 'Guard Org' });
      const o = boss.organizationId!;
      const admin = await addMemberAndLogin(ctx, o, ROLE_KEYS.ORG_ADMIN);
      const ownerMember = await ctx.system.organizationMember.findFirstOrThrow({ where: { organizationId: o, userId: boss.id } });
      await stepUp(ctx, admin);

      const hitOwner = await http(ctx).delete(url(`/organizations/${o}/members/${ownerMember.id}`)).set(bearer(admin));
      expect(hitOwner.status).toBe(403);
      expect(hitOwner.body.code).toBe('OWNER_PROTECTED');
      const self = await http(ctx).patch(url(`/organizations/${o}/members/${admin.memberId}`)).set(bearer(admin)).send({ roleKeys: [ROLE_KEYS.ORG_OWNER] });
      expect(self.status).toBe(403);
      expect(self.body.code).toBe('CANNOT_MODIFY_SELF');
    });
  });

  describe('invitations', () => {
    it('rejects expired and revoked invitations and duplicate members', async () => {
      const boss = await registerUser(ctx, { organizationName: 'Invite Org' });
      const o = boss.organizationId!;
      const emailA = uniqueEmail('exp');
      const emailB = uniqueEmail('rev');
      await http(ctx).post(url(`/organizations/${o}/invitations`)).set(bearer(boss)).send({ email: emailA, roleKey: ROLE_KEYS.VIEWER });
      const revokeMe = await http(ctx).post(url(`/organizations/${o}/invitations`)).set(bearer(boss)).send({ email: emailB, roleKey: ROLE_KEYS.VIEWER });
      const tokenA = /token=([\w-]+)/.exec(ctx.mail.lastTo(emailA)!.text)![1]!;
      const tokenB = /token=([\w-]+)/.exec(ctx.mail.lastTo(emailB)!.text)![1]!;

      await ctx.system.invitation.updateMany({ where: { email: emailA }, data: { expiresAt: new Date(Date.now() - 1000) } });
      expect((await http(ctx).post(url('/invitations/lookup')).send({ token: tokenA })).status).toBe(404);

      expect((await http(ctx).delete(url(`/organizations/${o}/invitations/${revokeMe.body.data.id}`)).set(bearer(boss))).status).toBe(204);
      expect((await http(ctx).post(url('/invitations/accept')).send({ token: tokenB, password: 'Correct-Horse-Battery-9', fullName: 'X' })).status).toBe(404);

      const dup = await http(ctx).post(url(`/organizations/${o}/invitations`)).set(bearer(boss)).send({ email: boss.email, roleKey: ROLE_KEYS.VIEWER });
      expect(dup.status).toBe(409);
      expect(dup.body.code).toBe('ALREADY_MEMBER');
    });

    it('re-inviting the same address revokes the earlier invitation', async () => {
      const boss = await registerUser(ctx, { organizationName: 'Reinvite Org' });
      const o = boss.organizationId!;
      const email = uniqueEmail('again');
      await http(ctx).post(url(`/organizations/${o}/invitations`)).set(bearer(boss)).send({ email, roleKey: ROLE_KEYS.VIEWER });
      const first = /token=([\w-]+)/.exec(ctx.mail.lastTo(email)!.text)![1]!;
      await http(ctx).post(url(`/organizations/${o}/invitations`)).set(bearer(boss)).send({ email, roleKey: ROLE_KEYS.VIEWER });
      expect((await http(ctx).post(url('/invitations/lookup')).send({ token: first })).status).toBe(404);
      const pending = await http(ctx).get(url(`/organizations/${o}/invitations`)).set(bearer(boss));
      expect(pending.body.data).toHaveLength(1);
    });
  });

  describe('route inventory', () => {
    it('every route is explicitly public, authenticated, tenant-free or permission-guarded (fails closed)', () => {
      const discovery = ctx.app.get(DiscoveryService);
      const scanner = new MetadataScanner();
      const reflector = ctx.app.get(Reflector);
      const unguarded: string[] = [];
      let routes = 0;
      for (const wrapper of discovery.getControllers()) {
        const instance = wrapper.instance as object | undefined;
        if (!instance) continue;
        const proto = Object.getPrototypeOf(instance) as object;
        for (const name of scanner.getAllMethodNames(proto)) {
          const handler = (proto as Record<string, unknown>)[name] as (...a: unknown[]) => unknown;
          if (Reflect.getMetadata(METHOD_METADATA, handler) === undefined) continue;
          routes++;
          const targets = [handler, wrapper.metatype as object];
          const declared =
            reflector.getAllAndOverride(IS_PUBLIC, targets as never) ||
            reflector.getAllAndOverride(IS_AUTHENTICATED, targets as never) ||
            reflector.getAllAndOverride(NO_TENANT, targets as never) ||
            (reflector.getAllAndOverride<string[]>(REQUIRED_PERMISSIONS, targets as never)?.length ?? 0) > 0;
          if (!declared) unguarded.push(`${(wrapper.metatype as { name: string }).name}.${name}`);
        }
      }
      expect(routes).toBeGreaterThan(25);
      expect(unguarded).toEqual([]);
    });
  });
});
