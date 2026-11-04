import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { OrganizationType } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { API_PREFIX, configureApp } from '../src/app.setup';
import { PrismaService, SystemPrismaService } from '../src/infrastructure/prisma/prisma.service';
import { DevEmailAdapter } from '../src/modules/messaging/dev-email.adapter';
import { UsersService } from '../src/modules/users/users.service';

export const PASSWORD = 'Correct-Horse-Battery-9';

/** Apps currently open in THIS test file (Jest gives every file its own module registry). */
let openApps = 0;
/** When this test file started: everything the file registered since then is removed once its last app closes. */
const fileStartedAt = new Date();

export interface TestCtx {
  app: INestApplication;
  system: SystemPrismaService;
  prisma: PrismaService;
  mail: DevEmailAdapter;
  users: UsersService;
  close(): Promise<void>;
}

/**
 * Boots the real application. `env` overrides apply only while the app is being created (configuration is read
 * at boot), e.g. `{ INGESTION_ENABLED: 'true' }` or `{ TRACCAR_URL: 'http://127.0.0.1:1' }` for an unreachable engine.
 */
export async function createTestApp(env: Record<string, string> = {}): Promise<TestCtx> {
  const previous: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    previous[k] = process.env[k];
    process.env[k] = v;
  }
  let app: INestApplication;
  try {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ bufferLogs: false });
    configureApp(app);
    await app.init();
  } finally {
    for (const [k, v] of Object.entries(previous)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
  openApps++;
  return {
    app,
    system: app.get(SystemPrismaService),
    prisma: app.get(PrismaService),
    mail: app.get(DevEmailAdapter),
    users: app.get(UsersService),
    close: async () => {
      const system = app.get(SystemPrismaService);
      // Engine devices registered by this file (found before the app — and its database connections — goes away).
      const created = await system.gpsDevice.findMany({ where: { createdAt: { gte: fileStartedAt } }, select: { uniqueId: true } }).catch(() => []);
      const prefix = process.env['REDIS_KEY_PREFIX'] ?? '';
      await app.close();
      // The suite's key namespace (which includes the ingestion lease and live state) is shared by every app of the file:
      // only the LAST one to close may wipe it, or closing a secondary instance would pull the lease from the primary.
      openApps = Math.max(0, openApps - 1);
      if (openApps === 0) {
        await removeEngineDevices(created.map((d) => d.uniqueId));
        await removeRedisKeys(prefix);
      }
    },
  };
}

/** Deletes devices a suite registered in the TEST Traccar, so they do not accumulate or slow later runs. Never throws. */
async function removeEngineDevices(uniqueIds: string[]): Promise<void> {
  const { TRACCAR_URL: base, TRACCAR_USER: user, TRACCAR_PASSWORD: password } = process.env;
  if (!base || !user || !password || uniqueIds.length === 0) return;
  try {
    const login = await fetch(`${base}/api/session`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ email: user, password }) });
    if (!login.ok) return;
    const cookie = login.headers.get('set-cookie')!.split(';')[0]!;
    const ours = new Set(uniqueIds);
    const devices = (await (await fetch(`${base}/api/devices`, { headers: { cookie, accept: 'application/json' } })).json()) as { id: number; uniqueId: string }[];
    const targets = devices.filter((d) => ours.has(d.uniqueId));
    for (let i = 0; i < targets.length; i += 20) await Promise.all(targets.slice(i, i + 20).map((d) => fetch(`${base}/api/devices/${d.id}`, { method: 'DELETE', headers: { cookie } })));
  } catch {
    /* best effort: the next run's global setup wipes the engine anyway */
  }
}

/** Removes every Redis key of this suite (its key prefix). A fresh connection without keyPrefix, so the pattern is literal. */
async function removeRedisKeys(prefix: string): Promise<void> {
  if (!prefix || !process.env['REDIS_URL']) return;
  const redis = new Redis(process.env['REDIS_URL']);
  try {
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 500);
      cursor = next;
      if (keys.length > 0) await redis.del(...keys);
    } while (cursor !== '0');
  } catch {
    /* best effort */
  } finally {
    redis.disconnect();
  }
}

export const http = (ctx: TestCtx) => request(ctx.app.getHttpServer());
export const url = (path: string) => `/${API_PREFIX}${path}`;
export const uniqueEmail = (tag = 'user') => `${tag}-${randomUUID().slice(0, 8)}@example.test`;

export interface TestUser {
  id: string;
  email: string;
  password: string;
  accessToken: string;
  refreshCookie: string;
}

export const bearer = (u: Pick<TestUser, 'accessToken'>) => ({ Authorization: `Bearer ${u.accessToken}` });

function extractToken(text: string): string {
  const m = /token=([\w-]+)/.exec(text);
  if (!m?.[1]) throw new Error(`No token in email:\n${text}`);
  return m[1];
}

export async function login(ctx: TestCtx, email: string, password = PASSWORD, totpCode?: string) {
  const res = await http(ctx).post(url('/auth/login')).send({ email, password, totpCode });
  return res;
}

/**
 * A verified user, signed in. With `organizationName` the user is the Owner of a new CUSTOMER organization of the
 * shared test provider. End customers cannot sign up publicly (spec Module 1), so this is a database fixture; the public
 * provider registration flow has its own tests (see providers.e2e-spec.ts).
 */
export async function registerUser(
  ctx: TestCtx,
  opts: { email?: string; organizationName?: string; fullName?: string } = {},
): Promise<TestUser & { organizationId?: string }> {
  const email = opts.email ?? uniqueEmail();
  const user = await ctx.users.create({
    email,
    passwordHash: await ctx.users.hashPassword(PASSWORD),
    fullName: opts.fullName ?? 'Test User',
    emailVerified: true,
  });
  if (opts.organizationName) {
    const org = await createOrg(ctx, { name: opts.organizationName, type: 'CUSTOMER' });
    const role = await ctx.system.role.findUniqueOrThrow({ where: { key: 'ORG_OWNER' } });
    const member = await ctx.system.organizationMember.create({ data: { organizationId: org.id, userId: user.id } });
    await ctx.system.memberRole.create({ data: { organizationId: org.id, memberId: member.id, roleId: role.id } });
  }
  return signIn(ctx, email);
}

const testProviders = new WeakMap<TestCtx, Promise<{ id: string }>>();
/** The provider that owns customers created by fixtures that do not name one (one per test app). */
export function ensureTestProvider(ctx: TestCtx): Promise<{ id: string }> {
  let p = testProviders.get(ctx);
  if (!p) {
    p = (async () => {
      const org = await ctx.system.organization.create({
        data: { name: `Test provider ${randomUUID().slice(0, 6)}`, type: 'PROVIDER', countryCode: 'RW', timezone: 'Africa/Kigali', currencyCode: 'RWF' },
      });
      await ctx.system.providerProfile.create({
        data: { organizationId: org.id, status: 'ACTIVE', companyName: org.name, contactName: 'Test', contactEmail: uniqueEmail('prov'), termsVersion: 'test', termsAcceptedAt: new Date() },
      });
      return org;
    })();
    testProviders.set(ctx, p);
  }
  return p;
}

export async function signIn(ctx: TestCtx, email: string, password = PASSWORD): Promise<TestUser & { organizationId?: string }> {
  const res = await login(ctx, email, password);
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  const cookie = (res.headers['set-cookie'] as unknown as string[] | undefined)?.find((c) => c.startsWith('gps_rt='));
  const me = await http(ctx).get(url('/auth/me')).set('Authorization', `Bearer ${res.body.data.accessToken}`);
  return {
    id: res.body.data.user.id,
    email,
    password,
    accessToken: res.body.data.accessToken,
    refreshCookie: cookie?.split(';')[0] ?? '',
    organizationId: me.body.data.activeOrganizationId ?? undefined,
  };
}

export const tokenFromMail = extractToken;

// ---------------------------------------------------------------- direct-DB fixtures (system role)

export async function createOrg(
  ctx: TestCtx,
  opts: { name?: string; type?: OrganizationType; parentOrganizationId?: string } = {},
) {
  const type = opts.type ?? 'CUSTOMER';
  const parentOrganizationId = opts.parentOrganizationId ?? (type === 'CUSTOMER' ? (await ensureTestProvider(ctx)).id : undefined);
  return ctx.system.organization.create({
    data: {
      name: opts.name ?? `Org ${randomUUID().slice(0, 6)}`,
      type,
      parentOrganizationId,
      countryCode: 'RW',
      timezone: 'Africa/Kigali',
      currencyCode: 'RWF',
    },
  });
}

/** Creates a verified user directly in the database and adds it to `organizationId` with `roleKey`. */
export async function addMember(ctx: TestCtx, organizationId: string, roleKey: string, email = uniqueEmail(roleKey.toLowerCase())) {
  const user = await ctx.users.create({
    email,
    passwordHash: await ctx.users.hashPassword(PASSWORD),
    fullName: `${roleKey} user`,
    emailVerified: true,
  });
  const role = await ctx.system.role.findUniqueOrThrow({ where: { key: roleKey } });
  const member = await ctx.system.organizationMember.create({ data: { organizationId, userId: user.id } });
  await ctx.system.memberRole.create({ data: { organizationId, memberId: member.id, roleId: role.id } });
  return { user, member, email };
}

export async function addMemberAndLogin(ctx: TestCtx, organizationId: string, roleKey: string) {
  const { email, member } = await addMember(ctx, organizationId, roleKey);
  return { ...(await signIn(ctx, email)), memberId: member.id };
}

export async function stepUp(ctx: TestCtx, user: TestUser) {
  const res = await http(ctx).post(url('/auth/step-up')).set(bearer(user)).send({ password: user.password });
  if (res.status !== 204) throw new Error(`step-up failed: ${res.status}`);
}
