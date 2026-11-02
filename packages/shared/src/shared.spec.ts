import { describe, expect, it } from 'vitest';
import {
  ALL_PERMISSIONS,
  ORGANIZATION_PERMISSIONS,
  P,
  ROLE_KEYS,
  SYSTEM_ROLES,
  createOrganizationSchema,
  inviteMemberSchema,
  loginSchema,
  registerSchema,
  stepUpSchema,
} from './index';

describe('permission catalogue', () => {
  it('has unique, well-formed keys', () => {
    expect(new Set(ALL_PERMISSIONS).size).toBe(ALL_PERMISSIONS.length);
    for (const k of ALL_PERMISSIONS) expect(k).toMatch(/^[a-z_]+(\.[a-z_]+){1,2}$/);
  });
  it('keeps platform and reseller keys out of organization scope', () => {
    expect(ORGANIZATION_PERMISSIONS.some((k) => k.startsWith('platform.') || k.startsWith('reseller.'))).toBe(false);
  });
});

describe('system role bundles', () => {
  const byKey = (k: string) => SYSTEM_ROLES.find((r) => r.key === k)!;
  it('define every role key exactly once, with only known permissions', () => {
    expect(SYSTEM_ROLES.map((r) => r.key).sort()).toEqual(Object.values(ROLE_KEYS).sort());
    for (const r of SYSTEM_ROLES) for (const p of r.permissions) expect(ALL_PERMISSIONS).toContain(p);
  });
  it('Fleet Manager cannot immobilize or restore; Security Manager can', () => {
    expect(byKey('FLEET_MANAGER').permissions).not.toContain(P.SECURITY_IMMOBILIZE_REQUEST);
    expect(byKey('FLEET_MANAGER').permissions).not.toContain(P.SECURITY_RESTORE_REQUEST);
    expect(byKey('SECURITY_MANAGER').permissions).toContain(P.SECURITY_IMMOBILIZE_REQUEST);
  });
  it('Owner holds every organization permission; Admin lacks ownership transfer and billing management', () => {
    expect(new Set(byKey('ORG_OWNER').permissions)).toEqual(new Set(ORGANIZATION_PERMISSIONS));
    expect(byKey('ORG_ADMIN').permissions).not.toContain(P.ORGANIZATION_TRANSFER_OWNERSHIP);
    expect(byKey('ORG_ADMIN').permissions).not.toContain(P.BILLING_MANAGE);
  });
  it('Viewer and Driver hold no write or export permission', () => {
    for (const k of ['VIEWER', 'DRIVER']) {
      for (const p of byKey(k).permissions) expect(p).toMatch(/\.(read|view)$/);
    }
  });
  it('no customer role carries platform permissions', () => {
    for (const r of SYSTEM_ROLES.filter((r) => r.scope === 'ORGANIZATION')) {
      expect(r.permissions.some((p) => p.startsWith('platform.'))).toBe(false);
    }
  });
});

describe('request schemas', () => {
  it('normalises email and enforces password length', () => {
    const ok = registerSchema.parse({ email: '  Ada@Example.COM ', password: 'x'.repeat(12), fullName: ' Ada ' });
    expect(ok.email).toBe('ada@example.com');
    expect(ok.fullName).toBe('Ada');
    expect(registerSchema.safeParse({ email: 'a@b.co', password: 'short', fullName: 'A' }).success).toBe(false);
  });
  it('strips unknown fields such as a client-supplied organizationId', () => {
    const parsed = inviteMemberSchema.parse({ email: 'a@b.co', roleKey: 'VIEWER', organizationId: 'evil' });
    expect(parsed).not.toHaveProperty('organizationId');
  });
  it('validates country and time zone', () => {
    expect(createOrganizationSchema.parse({ name: 'Acme', countryCode: 'rw' }).countryCode).toBe('RW');
    expect(createOrganizationSchema.safeParse({ name: 'Acme', timezone: 'Mars/Olympus' }).success).toBe(false);
    expect(createOrganizationSchema.safeParse({ name: 'Acme', countryCode: 'RWA' }).success).toBe(false);
  });
  it('login accepts a 6-digit code or a recovery code; step-up needs a credential', () => {
    expect(loginSchema.safeParse({ email: 'a@b.co', password: 'p', totpCode: '123456' }).success).toBe(true);
    expect(stepUpSchema.safeParse({}).success).toBe(false);
    expect(stepUpSchema.safeParse({ password: 'x' }).success).toBe(true);
  });
});
