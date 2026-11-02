import { authenticator } from 'otplib';
import { decryptSecret } from '../src/modules/users/crypto';
import {
  bearer,
  createTestApp,
  http,
  login,
  PASSWORD,
  registerUser,
  signIn,
  stepUp,
  tokenFromMail,
  uniqueEmail,
  url,
  type TestCtx,
} from './helpers';

describe('Authentication & sessions (e2e)', () => {
  let ctx: TestCtx;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());

  describe('registration & email verification', () => {
    it('registers, requires email verification before login, then signs in', async () => {
      const email = uniqueEmail();
      const reg = await http(ctx).post(url('/auth/register')).send({ email, password: PASSWORD, fullName: 'Ada', organizationName: 'Ada Transport' });
      expect(reg.status).toBe(201);

      const before = await login(ctx, email);
      expect(before.status).toBe(403);
      expect(before.body.code).toBe('EMAIL_NOT_VERIFIED');

      const mail = ctx.mail.lastTo(email)!;
      expect(mail.subject).toMatch(/verify/i);
      const token = tokenFromMail(mail.text);
      expect((await http(ctx).post(url('/auth/verify-email')).send({ token })).status).toBe(204);
      // single use
      expect((await http(ctx).post(url('/auth/verify-email')).send({ token })).status).toBe(400);

      const ok = await login(ctx, email);
      expect(ok.status).toBe(200);
      expect(ok.body.data.accessToken).toEqual(expect.any(String));
      const cookie = (ok.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('gps_rt='))!;
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/SameSite=Strict/i);
      expect(cookie).toMatch(/Path=\/api\/v1\/auth/);

      const me = await http(ctx).get(url('/auth/me')).set(bearer({ accessToken: ok.body.data.accessToken }));
      expect(me.status).toBe(200);
      expect(me.body.data.memberships).toHaveLength(1);
      expect(me.body.data.memberships[0].roleKeys).toEqual(['ORG_OWNER']);
      expect(me.body.data.permissions).toContain('billing.manage');
    });

    it('answers a duplicate registration exactly like a new one (no account enumeration)', async () => {
      const first = await registerUser(ctx);
      const dup = await http(ctx).post(url('/auth/register')).send({ email: first.email, password: PASSWORD, fullName: 'Other' });
      const fresh = await http(ctx).post(url('/auth/register')).send({ email: uniqueEmail(), password: PASSWORD, fullName: 'New' });
      expect(dup.status).toBe(fresh.status);
      expect(dup.body).toEqual(fresh.body);
      expect(ctx.mail.lastTo(first.email)!.subject).toMatch(/already exists|attempt/i);
    });

    it('rejects weak passwords and invalid email with field errors', async () => {
      const res = await http(ctx).post(url('/auth/register')).send({ email: 'nope', password: 'short', fullName: '' });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(res.body.errors.map((e: { path: string }) => e.path).sort()).toEqual(['email', 'fullName', 'password']);
    });
  });

  describe('login', () => {
    it('does not reveal whether the email exists', async () => {
      const u = await registerUser(ctx);
      const wrongPw = await login(ctx, u.email, 'definitely-wrong-password');
      const noUser = await login(ctx, uniqueEmail('ghost'), 'definitely-wrong-password');
      expect(wrongPw.status).toBe(401);
      expect(noUser.status).toBe(401);
      expect(wrongPw.body).toEqual(noUser.body);
      expect(wrongPw.body.code).toBe('INVALID_CREDENTIALS');
    });

    it('writes audit rows for login and failed login', async () => {
      const u = await registerUser(ctx);
      await login(ctx, u.email, 'wrong-wrong-wrong');
      const rows = await ctx.system.auditLog.findMany({ where: { actorUserId: u.id } });
      const actions = rows.map((r) => r.action);
      expect(actions).toEqual(expect.arrayContaining(['auth.register', 'auth.login', 'auth.login_failed']));
      expect(JSON.stringify(rows)).not.toContain(PASSWORD);
    });

    it('locks an account temporarily after repeated failures', async () => {
      const u = await registerUser(ctx);
      for (let i = 0; i < 10; i++) await login(ctx, u.email, 'wrong-wrong-wrong');
      const locked = await login(ctx, u.email, PASSWORD);
      expect(locked.status).toBe(429);
      expect(locked.body.code).toBe('ACCOUNT_TEMPORARILY_LOCKED');
    });
  });

  describe('access tokens, refresh rotation, logout', () => {
    it('rejects missing, malformed and tampered tokens', async () => {
      expect((await http(ctx).get(url('/auth/me'))).status).toBe(401);
      expect((await http(ctx).get(url('/auth/me')).set('Authorization', 'Bearer abc')).status).toBe(401);
      const u = await registerUser(ctx);
      const tampered = u.accessToken.slice(0, -4) + 'AAAA';
      expect((await http(ctx).get(url('/auth/me')).set('Authorization', `Bearer ${tampered}`)).status).toBe(401);
    });

    it('rotates the refresh token and requires the CSRF header', async () => {
      const u = await registerUser(ctx);
      const noHeader = await http(ctx).post(url('/auth/refresh')).set('Cookie', u.refreshCookie);
      expect(noHeader.status).toBe(403);
      expect(noHeader.body.code).toBe('CSRF_HEADER_REQUIRED');

      const ok = await http(ctx).post(url('/auth/refresh')).set('Cookie', u.refreshCookie).set('X-Requested-With', 'gps-web');
      expect(ok.status).toBe(200);
      const next = (ok.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('gps_rt='))!.split(';')[0]!;
      expect(next).not.toBe(u.refreshCookie);
      expect((await http(ctx).get(url('/auth/me')).set(bearer({ accessToken: ok.body.data.accessToken }))).status).toBe(200);
    });

    it('two tabs refreshing at once: the loser gets a retryable 401 and the winner’s cookie survives', async () => {
      const u = await registerUser(ctx);
      const h = { 'X-Requested-With': 'gps-web' };
      const [a, b] = await Promise.all([
        http(ctx).post(url('/auth/refresh')).set('Cookie', u.refreshCookie).set(h),
        http(ctx).post(url('/auth/refresh')).set('Cookie', u.refreshCookie).set(h),
      ]);
      const [winner, loser] = a.status === 200 ? [a, b] : [b, a];
      expect(winner.status).toBe(200);
      expect(loser.status).toBe(401);
      expect(loser.body.code).toBe('REFRESH_RACE');
      // The race loser must not clear the cookie the winner just issued.
      const loserCookies = ((loser.headers['set-cookie'] as unknown as string[] | undefined) ?? []).join(';');
      expect(loserCookies).not.toContain('gps_rt=;');
      // The session is still alive: the winner's new cookie rotates fine.
      const next = (winner.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('gps_rt='))!.split(';')[0]!;
      expect((await http(ctx).post(url('/auth/refresh')).set('Cookie', next).set(h)).status).toBe(200);
    });

    it('revokes the whole session when a rotated refresh token is replayed', async () => {
      const u = await registerUser(ctx);
      const h = { 'X-Requested-With': 'gps-web' };
      const first = await http(ctx).post(url('/auth/refresh')).set('Cookie', u.refreshCookie).set(h);
      expect(first.status).toBe(200);
      const newCookie = (first.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('gps_rt='))!.split(';')[0]!;
      // Age the "used" mark beyond the benign-race grace window.
      await ctx.system.refreshToken.updateMany({ where: { usedAt: { not: null }, session: { userId: u.id } }, data: { usedAt: new Date(Date.now() - 60_000) } });

      const replay = await http(ctx).post(url('/auth/refresh')).set('Cookie', u.refreshCookie).set(h);
      expect(replay.status).toBe(401);
      expect(replay.body.code).toBe('REFRESH_TOKEN_REUSED');

      // The legitimate descendant token and the access token of that session are dead too.
      expect((await http(ctx).post(url('/auth/refresh')).set('Cookie', newCookie).set(h)).status).toBe(401);
      expect((await http(ctx).get(url('/auth/me')).set(bearer(u))).status).toBe(401);
    });

    it('logout revokes the access token immediately', async () => {
      const u = await registerUser(ctx);
      expect((await http(ctx).post(url('/auth/logout')).set(bearer(u))).status).toBe(204);
      const after = await http(ctx).get(url('/auth/me')).set(bearer(u));
      expect(after.status).toBe(401);
      expect(after.body.code).toBe('SESSION_REVOKED');
      expect((await http(ctx).post(url('/auth/refresh')).set('Cookie', u.refreshCookie).set('X-Requested-With', 'gps-web')).status).toBe(401);
    });

    it('lists the current session', async () => {
      const u = await registerUser(ctx);
      const list = await http(ctx).get(url('/auth/sessions')).set(bearer(u));
      expect(list.status).toBe(200);
      expect(list.body.data).toHaveLength(1);
      expect(list.body.data[0].current).toBe(true);
    });
  });

  describe('sessions list / revoke', () => {
    it('lists own sessions and revokes another one, but not someone else’s', async () => {
      const u = await registerUser(ctx);
      const second = await signIn(ctx, u.email);
      const stranger = await registerUser(ctx);

      const list = await http(ctx).get(url('/auth/sessions')).set(bearer(u));
      expect(list.body.data.length).toBe(2);
      const other = list.body.data.find((s: { current: boolean }) => !s.current);

      expect((await http(ctx).delete(url(`/auth/sessions/${other.id}`)).set(bearer(stranger))).status).toBe(404);
      expect((await http(ctx).delete(url(`/auth/sessions/${other.id}`)).set(bearer(u))).status).toBe(204);
      expect((await http(ctx).get(url('/auth/me')).set(bearer(second))).status).toBe(401);
    });
  });

  describe('password recovery', () => {
    it('resets the password with a single-use token and revokes existing sessions', async () => {
      const u = await registerUser(ctx);
      const unknown = await http(ctx).post(url('/auth/forgot-password')).send({ email: uniqueEmail('ghost') });
      const known = await http(ctx).post(url('/auth/forgot-password')).send({ email: u.email });
      expect(unknown.status).toBe(202);
      expect(known.body).toEqual(unknown.body);

      const token = tokenFromMail(ctx.mail.lastTo(u.email)!.text);
      const newPassword = 'Another-Strong-Pass-42';
      expect((await http(ctx).post(url('/auth/reset-password')).send({ token, password: newPassword })).status).toBe(204);
      expect((await http(ctx).post(url('/auth/reset-password')).send({ token, password: newPassword })).status).toBe(400);

      expect((await http(ctx).get(url('/auth/me')).set(bearer(u))).status).toBe(401);
      expect((await login(ctx, u.email, PASSWORD)).status).toBe(401);
      expect((await login(ctx, u.email, newPassword)).status).toBe(200);
    });

    it('rejects expired reset tokens', async () => {
      const u = await registerUser(ctx);
      await http(ctx).post(url('/auth/forgot-password')).send({ email: u.email });
      const token = tokenFromMail(ctx.mail.lastTo(u.email)!.text);
      await ctx.system.emailToken.updateMany({ where: { userId: u.id, purpose: 'RESET_PASSWORD' }, data: { expiresAt: new Date(Date.now() - 1000) } });
      const res = await http(ctx).post(url('/auth/reset-password')).send({ token, password: 'Another-Strong-Pass-42' });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_OR_EXPIRED_TOKEN');
    });

    it('changes password, keeps current session, revokes the others', async () => {
      const u = await registerUser(ctx);
      const other = await signIn(ctx, u.email);
      const res = await http(ctx).post(url('/auth/change-password')).set(bearer(u)).send({ currentPassword: PASSWORD, newPassword: 'Brand-New-Passphrase-77' });
      expect(res.status).toBe(204);
      expect((await http(ctx).get(url('/auth/me')).set(bearer(u))).status).toBe(200);
      expect((await http(ctx).get(url('/auth/me')).set(bearer(other))).status).toBe(401);
      const wrong = await http(ctx).post(url('/auth/change-password')).set(bearer(u)).send({ currentPassword: 'nope-nope-nope-nope', newPassword: 'Brand-New-Passphrase-88' });
      expect(wrong.status).toBe(401);
    });
  });

  describe('two-factor authentication & step-up', () => {
    it('enrols TOTP, requires it at login, accepts recovery codes once', async () => {
      const u = await registerUser(ctx);
      const enroll = await http(ctx).post(url('/auth/2fa/enroll')).set(bearer(u));
      expect(enroll.status).toBe(201);
      const secret: string = enroll.body.data.secret;
      expect(enroll.body.data.otpauthUrl).toContain('otpauth://totp/');

      // Secret is encrypted at rest.
      const stored = await ctx.system.user.findUniqueOrThrow({ where: { id: u.id } });
      expect(stored.totpSecretEnc).toBeTruthy();
      expect(stored.totpSecretEnc).not.toContain(secret);
      expect(decryptSecret(stored.totpSecretEnc!, process.env['TOTP_ENCRYPTION_KEY']!)).toBe(secret);

      const bad = await http(ctx).post(url('/auth/2fa/confirm')).set(bearer(u)).send({ code: '000000' });
      expect(bad.status).toBe(400);
      const confirm = await http(ctx).post(url('/auth/2fa/confirm')).set(bearer(u)).send({ code: authenticator.generate(secret) });
      expect(confirm.status).toBe(200);
      const recovery: string[] = confirm.body.data.recoveryCodes;
      expect(recovery).toHaveLength(8);

      const noCode = await login(ctx, u.email);
      expect(noCode.status).toBe(401);
      expect(noCode.body.code).toBe('TOTP_REQUIRED');
      expect((await login(ctx, u.email, PASSWORD, '000000')).body.code).toBe('INVALID_TOTP');
      expect((await login(ctx, u.email, PASSWORD, authenticator.generate(secret))).status).toBe(200);

      expect((await login(ctx, u.email, PASSWORD, recovery[0])).status).toBe(200);
      expect((await login(ctx, u.email, PASSWORD, recovery[0])).status).toBe(401); // single use

      const off = await http(ctx).post(url('/auth/2fa/disable')).set(bearer(u)).send({ password: PASSWORD });
      expect(off.status).toBe(204);
      expect((await login(ctx, u.email)).status).toBe(200);
    });

    it('step-up marks the session fresh; wrong password does not', async () => {
      const u = await registerUser(ctx);
      const bad = await http(ctx).post(url('/auth/step-up')).set(bearer(u)).send({ password: 'wrong-wrong-wrong' });
      expect(bad.status).toBe(401);
      await stepUp(ctx, u);
      const s = await ctx.system.session.findFirstOrThrow({ where: { userId: u.id } });
      expect(s.stepUpAt).not.toBeNull();
    });
  });

  describe('rate limiting', () => {
    it('returns 429 with a stable code once the auth limit is exceeded', async () => {
      process.env['THROTTLE_AUTH_LIMIT'] = '3';
      let limited: TestCtx | undefined;
      await jest.isolateModulesAsync(async () => {
        const helpers = await import('./helpers');
        limited = await helpers.createTestApp();
      });
      try {
        const results: number[] = [];
        for (let i = 0; i < 5; i++) {
          const r = await http(limited!).post(url('/auth/forgot-password')).send({ email: uniqueEmail() });
          results.push(r.status);
        }
        expect(results.slice(0, 3)).toEqual([202, 202, 202]);
        expect(results.slice(3)).toEqual([429, 429]);
        const last = await http(limited!).post(url('/auth/forgot-password')).send({ email: uniqueEmail() });
        expect(last.body.code).toBe('RATE_LIMITED');
      } finally {
        await limited?.close();
        process.env['THROTTLE_AUTH_LIMIT'] = '100000';
      }
    });
  });
});
