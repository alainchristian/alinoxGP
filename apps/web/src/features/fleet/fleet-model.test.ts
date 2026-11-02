import { describe, expect, it } from 'vitest';
import type { AttentionItemDto, ExpiryDto, VehicleDto } from '@gps/shared';
import {
  attentionHref,
  documentFormToPayload,
  driverFormToPayload,
  emptyDocumentForm,
  emptyDriverForm,
  emptyVehicleForm,
  expiryText,
  expiryTone,
  formatDay,
  vehicleFormToPayload,
  vehicleSubtitle,
  vehicleToForm,
} from './fleet-model';

const exp = (daysLeft: number, status: ExpiryDto['status']): ExpiryDto => ({ date: '2026-11-02', daysLeft, status });

describe('expiry wording', () => {
  it('says what is known in words and treats a missing date as "Not set", not as fine', () => {
    expect(expiryText(null)).toBe('Not set');
    expect(expiryText(exp(0, 'EXPIRING_SOON'))).toBe('Expires today');
    expect(expiryText(exp(1, 'EXPIRING_SOON'))).toBe('Expires in 1 day');
    expect(expiryText(exp(12, 'EXPIRING_SOON'))).toBe('Expires in 12 days');
    expect(expiryText(exp(-1, 'EXPIRED'))).toBe('Expired 1 day ago');
    expect(expiryText(exp(-30, 'EXPIRED'))).toBe('Expired 30 days ago');
  });
  it('maps status to a tone, with unknown neutral (never green)', () => {
    expect(expiryTone(null)).toBe('neutral');
    expect(expiryTone(exp(100, 'OK'))).toBe('ok');
    expect(expiryTone(exp(5, 'EXPIRING_SOON'))).toBe('warn');
    expect(expiryTone(exp(-5, 'EXPIRED'))).toBe('danger');
  });
});

describe('formatDay', () => {
  it('formats a day as DD/MM/YYYY and shows a dash for unknown or malformed input', () => {
    expect(formatDay('2026-11-02')).toBe('02/11/2026');
    expect(formatDay(null)).toBe('—');
    expect(formatDay('')).toBe('—');
    expect(formatDay('02/11/2026')).toBe('—');
  });
});

describe('vehicleSubtitle', () => {
  it('joins what is known and leaves the rest out', () => {
    expect(vehicleSubtitle({ make: 'Toyota', model: 'Hiace', year: 2019 })).toBe('Toyota Hiace · 2019');
    expect(vehicleSubtitle({ make: 'Toyota', model: null, year: null })).toBe('Toyota');
    expect(vehicleSubtitle({ make: null, model: null, year: null })).toBe('');
  });
});

describe('attentionHref', () => {
  const item = (type: AttentionItemDto['subject']['type']): AttentionItemDto => ({
    kind: 'VEHICLE_INSURANCE', severity: 'EXPIRED', subject: { type, id: 'abc', label: 'x' }, title: 't', date: null, daysLeft: null,
  });
  it('leads to the vehicle, the drivers page or the pipeline monitor', () => {
    expect(attentionHref(item('vehicle'))).toBe('/app/vehicles/abc');
    expect(attentionHref(item('driver'))).toBe('/app/drivers');
    expect(attentionHref(item('device'))).toBe('/app/monitor');
  });
});

describe('form <-> payload', () => {
  it('turns empty fields into null so an update clears them and a create leaves them unknown', () => {
    const p = vehicleFormToPayload({ ...emptyVehicleForm, registrationNumber: ' RAB 123 C ', make: '  ', year: '' });
    expect(p).toMatchObject({ registrationNumber: 'RAB 123 C', make: null, year: null, vin: null, categoryId: null, insuranceExpiry: null, notes: null });
  });
  it('sends the year as a number and keeps a non-numeric year so the server can reject it', () => {
    expect(vehicleFormToPayload({ ...emptyVehicleForm, registrationNumber: 'A', year: '2019' }).year).toBe(2019);
    expect(Number.isNaN(vehicleFormToPayload({ ...emptyVehicleForm, registrationNumber: 'A', year: 'abc' }).year)).toBe(true);
  });
  it('round-trips a vehicle through the edit form', () => {
    const v = {
      registrationNumber: 'RAB 1 C', make: 'Isuzu', model: null, year: 2020, color: null, vehicleType: 'TRUCK', vin: 'ABCDE12345', fuelType: 'DIESEL', notes: null,
      insurance: { date: '2027-01-01', daysLeft: 60, status: 'OK' }, inspection: null, category: { id: 'c1', name: 'Trucks', color: null },
    } as unknown as VehicleDto;
    const back = vehicleFormToPayload(vehicleToForm(v));
    expect(back).toMatchObject({ registrationNumber: 'RAB 1 C', make: 'Isuzu', model: null, year: 2020, vehicleType: 'TRUCK', fuelType: 'DIESEL', categoryId: 'c1', insuranceExpiry: '2027-01-01', inspectionExpiry: null });
  });
  it('builds driver and document payloads the same way', () => {
    expect(driverFormToPayload({ ...emptyDriverForm, fullName: ' Eric ', phone: '+250788123456' })).toMatchObject({ fullName: 'Eric', phone: '+250788123456', email: null, licenseExpiry: null, status: 'ACTIVE' });
    expect(documentFormToPayload({ ...emptyDocumentForm, title: ' Policy ', expiresOn: '2027-01-01' })).toMatchObject({ type: 'INSURANCE', title: 'Policy', issuedOn: null, expiresOn: '2027-01-01' });
  });
});
