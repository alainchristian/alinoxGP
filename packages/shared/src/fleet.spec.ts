import { describe, expect, it } from 'vitest';
import {
  createDriverSchema,
  createVehicleDocumentSchema,
  createVehicleSchema,
  expiryOf,
  todayIn,
  updateVehicleSchema,
  vehicleListQuerySchema,
} from './fleet';
import { P } from './permissions';
import { SYSTEM_ROLES } from './roles';

describe('expiryOf', () => {
  const today = '2026-11-02';
  it('is null when no date is known (unknown is not "ok")', () => {
    expect(expiryOf(null, today)).toBeNull();
    expect(expiryOf(undefined, today)).toBeNull();
    expect(expiryOf('', today)).toBeNull();
  });
  it('treats the expiry day itself as the last valid day', () => {
    expect(expiryOf('2026-11-02', today)).toEqual({ date: '2026-11-02', daysLeft: 0, status: 'EXPIRING_SOON' });
  });
  it('is EXPIRED the day after', () => {
    expect(expiryOf('2026-11-01', today)).toEqual({ date: '2026-11-01', daysLeft: -1, status: 'EXPIRED' });
  });
  it('is EXPIRING_SOON up to 30 days and OK from 31', () => {
    expect(expiryOf('2026-12-02', today)?.status).toBe('EXPIRING_SOON'); // 30 days
    expect(expiryOf('2026-12-03', today)?.status).toBe('OK'); // 31 days
  });
  it('crosses a year boundary correctly', () => {
    expect(expiryOf('2027-01-01', today)?.daysLeft).toBe(60);
  });
  it('honours a custom window', () => {
    expect(expiryOf('2026-11-12', today, 5)?.status).toBe('OK');
    expect(expiryOf('2026-11-12', today, 10)?.status).toBe('EXPIRING_SOON');
  });
});

describe('todayIn', () => {
  it('uses the organization time zone, not the server time zone', () => {
    const instant = new Date('2026-11-02T23:30:00Z');
    expect(todayIn('UTC', instant)).toBe('2026-11-02');
    expect(todayIn('Africa/Kigali', instant)).toBe('2026-11-03'); // UTC+2
    expect(todayIn('America/Los_Angeles', instant)).toBe('2026-11-02');
  });
});

describe('vehicle schemas', () => {
  it('accepts the registration number alone and keeps other fields unset', () => {
    const v = createVehicleSchema.parse({ registrationNumber: 'RAB 123 C' });
    expect(v.make).toBeUndefined();
    expect(v.vin).toBeUndefined();
  });
  it('turns empty text into null and normalises the VIN', () => {
    const v = createVehicleSchema.parse({ registrationNumber: 'RAB 123 C', make: '  ', vin: ' wba 12345 abc ' });
    expect(v.make).toBeNull();
    expect(v.vin).toBe('WBA12345ABC');
  });
  it('rejects a malformed VIN, a far-future year and a malformed date', () => {
    expect(createVehicleSchema.safeParse({ registrationNumber: 'RAB 123 C', vin: 'no!' }).success).toBe(false);
    expect(createVehicleSchema.safeParse({ registrationNumber: 'RAB 123 C', year: new Date().getFullYear() + 5 }).success).toBe(false);
    expect(createVehicleSchema.safeParse({ registrationNumber: 'RAB 123 C', insuranceExpiry: '02/11/2026' }).success).toBe(false);
  });
  it('update needs at least one field, and null clears a field', () => {
    expect(updateVehicleSchema.safeParse({}).success).toBe(false);
    expect(updateVehicleSchema.parse({ make: null })).toEqual({ make: null });
  });
  it('list query parses booleans and refuses an unknown sort', () => {
    expect(vehicleListQuerySchema.parse({ hasDevice: 'true' }).hasDevice).toBe(true);
    expect(vehicleListQuerySchema.safeParse({ sort: 'password:asc' }).success).toBe(false);
  });
});

describe('driver and document schemas', () => {
  it('normalises phone numbers to E.164 and rejects local formats', () => {
    expect(createDriverSchema.parse({ fullName: 'A B', phone: '+250 788 123 456' }).phone).toBe('+250788123456');
    expect(createDriverSchema.safeParse({ fullName: 'A B', phone: '0788123456' }).success).toBe(false);
  });
  it('lower-cases the email and requires a name', () => {
    expect(createDriverSchema.parse({ fullName: 'A B', email: 'A@B.CO' }).email).toBe('a@b.co');
    expect(createDriverSchema.safeParse({ fullName: ' ' }).success).toBe(false);
  });
  it('rejects a document that expires before it was issued', () => {
    const base = { type: 'INSURANCE', title: 'Policy' } as const;
    expect(createVehicleDocumentSchema.safeParse({ ...base, issuedOn: '2026-05-01', expiresOn: '2026-04-01' }).success).toBe(false);
    expect(createVehicleDocumentSchema.safeParse({ ...base, issuedOn: '2026-05-01', expiresOn: '2027-05-01' }).success).toBe(true);
  });
});

describe('category permission', () => {
  it('is granted to the Fleet Manager role', () => {
    const role = SYSTEM_ROLES.find((r) => r.name === 'Fleet Manager');
    expect(role?.permissions).toContain(P.VEHICLES_CATEGORIES_MANAGE);
  });
});
