import { describe, expect, it } from 'vitest';
import {
  ALL_PERMISSIONS,
  permissionsActingOnCustomer,
  contrastRatio,
  providerRegistrationSchema,
  meetsAaOn,
  readableTextOn,
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
    for (const k of ALL_PERMISSIONS) expect(k).toMatch(/^[a-z_]+(\.[a-z_]+){1,3}$/);
  });
  it('keeps platform and provider keys out of organization scope', () => {
    expect(ORGANIZATION_PERMISSIONS.some((k) => k.startsWith('platform.') || k.startsWith('provider.'))).toBe(false);
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
  it('Owner holds every organization permission; Admin lacks ownership transfer', () => {
    expect(new Set(byKey('ORG_OWNER').permissions)).toEqual(new Set(ORGANIZATION_PERMISSIONS));
    expect(byKey('ORG_ADMIN').permissions).not.toContain(P.ORGANIZATION_TRANSFER_OWNERSHIP);
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

describe('provider roles', () => {
  const byKey = (k: string) => SYSTEM_ROLES.find((r) => r.key === k)!;
  it('provider roles carry no platform permission and no customer-only security command', () => {
    for (const r of SYSTEM_ROLES.filter((r) => r.scope === 'PROVIDER')) {
      expect(r.permissions.some((p) => p.startsWith('platform.'))).toBe(false);
      expect(r.permissions).not.toContain(P.SECURITY_IMMOBILIZE_REQUEST);
      expect(r.permissions).not.toContain(P.SECURITY_RESTORE_REQUEST);
    }
  });
  it('only the owner can transfer ownership; only owner/admin change branding or suspend customers', () => {
    expect(byKey('PROVIDER_OWNER').permissions).toContain(P.ORGANIZATION_TRANSFER_OWNERSHIP);
    expect(byKey('PROVIDER_ADMIN').permissions).not.toContain(P.ORGANIZATION_TRANSFER_OWNERSHIP);
    for (const k of ['PROVIDER_OPERATIONS', 'PROVIDER_TECHNICIAN', 'PROVIDER_FINANCE']) {
      expect(byKey(k).permissions).not.toContain(P.PROVIDER_BRANDING_MANAGE);
      expect(byKey(k).permissions).not.toContain(P.PROVIDER_CUSTOMERS_SUSPEND);
    }
  });
  it('a technician sees customers but not their tracking data', () => {
    const acting = permissionsActingOnCustomer(new Set(byKey('PROVIDER_TECHNICIAN').permissions));
    expect(acting.has(P.TRACKING_LIVE_VIEW)).toBe(false);
    expect(acting.has(P.TRACKING_HISTORY_VIEW)).toBe(false);
  });
  it('acting on a customer never grants security commands, ownership transfer or role management', () => {
    const acting = permissionsActingOnCustomer(new Set(ALL_PERMISSIONS));
    expect(acting.has(P.TRACKING_LIVE_VIEW)).toBe(true);
    for (const k of [P.SECURITY_IMMOBILIZE_REQUEST, P.SECURITY_RESTORE_REQUEST, P.ORGANIZATION_TRANSFER_OWNERSHIP, P.ROLES_MANAGE, P.USERS_REMOVE]) {
      expect(acting.has(k)).toBe(false);
    }
  });
});

describe('provider staff and the customer access log', () => {
  it('provider staff can never read the log of their own access', () => {
    expect(permissionsActingOnCustomer(new Set(ALL_PERMISSIONS)).has(P.ORGANIZATION_ACCESS_LOG_READ)).toBe(false);
    const owner = SYSTEM_ROLES.find((r) => r.key === 'ORG_OWNER')!;
    const admin = SYSTEM_ROLES.find((r) => r.key === 'ORG_ADMIN')!;
    expect(owner.permissions).toContain(P.ORGANIZATION_ACCESS_LOG_READ);
    expect(admin.permissions).not.toContain(P.ORGANIZATION_ACCESS_LOG_READ);
  });
});

describe('branding colours', () => {
  it('picks a readable text colour that always reaches AA', () => {
    expect(readableTextOn('#000000')).toBe('#FFFFFF');
    expect(readableTextOn('#FFFFFF')).toBe('#000000');
    expect(readableTextOn('#1F4ED8')).toBe('#FFFFFF');
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 0);
    expect(meetsAaOn('#1F4ED8')).toBe(true);
    // The better of black and white always reaches AA (>= 4.58:1), so an automatic text colour never needs a warning.
    for (const c of ['#808080', '#777777', '#7A7A7A', '#FF0000', '#00FF00']) expect(meetsAaOn(c)).toBe(true);
  });
});

describe('provider registration', () => {
  it('treats an empty expected-devices field as not given, not as zero', () => {
    const base = { companyName: 'Acme', contactName: 'Eve', email: 'e@x.co', password: 'x'.repeat(12), acceptedTermsVersion: 'draft-2026-11' as const };
    expect(providerRegistrationSchema.parse({ ...base, expectedDevices: '' }).expectedDevices).toBeUndefined();
    expect(providerRegistrationSchema.parse({ ...base, expectedDevices: '25' }).expectedDevices).toBe(25);
    expect(providerRegistrationSchema.safeParse({ ...base, acceptedTermsVersion: 'old' }).success).toBe(false);
  });
});
