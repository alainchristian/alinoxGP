import { describe, expect, it } from 'vitest';
import { CAPABILITY_KEYS, DEVICE_LIFECYCLE_STATUSES, type CapabilityState, type CatalogueModelDto } from '@gps/shared';
import {
  CAPABILITY_TONE,
  canConfirmConfigured,
  displayStatusTone,
  firmwareRange,
  groupByManufacturer,
  identifierError,
  isWaitingForSignal,
  LIFECYCLE_LABEL,
} from './device-model';

const model = (maker: string, name: string) => ({ manufacturer: { id: maker, name: maker }, name }) as CatalogueModelDto;

describe('capability tones', () => {
  it('only a verified capability is green; supported-but-unverified is never styled as confirmed', () => {
    const states: CapabilityState[] = ['VERIFIED', 'SUPPORTED_UNVERIFIED', 'PARTIAL', 'NOT_SUPPORTED', 'REQUIRES_CONFIGURATION', 'DISABLED', 'UNKNOWN'];
    expect(states.filter((s) => CAPABILITY_TONE[s] === 'ok')).toEqual(['VERIFIED']);
    expect(CAPABILITY_TONE.UNKNOWN).toBe('neutral'); // unknown is not good news and not bad news
  });
});

describe('identifierError', () => {
  it('requires a value and checks the IMEI check digit for IMEI models', () => {
    expect(identifierError('', 'IMEI')).toMatch(/Enter/);
    expect(identifierError('490154203237518', 'IMEI')).toBeNull();
    expect(identifierError('490154203237519', 'IMEI')).toMatch(/valid IMEI/);
  });
  it('accepts other identifiers by shape only', () => {
    expect(identifierError('SIM-DEMO-1', 'OTHER')).toBeNull();
    expect(identifierError('a b', 'OTHER')).toMatch(/Use 3/);
    expect(identifierError('ab', null)).toMatch(/Use 3/);
  });
});

describe('device status helpers', () => {
  it('labels every lifecycle status', () => {
    for (const s of DEVICE_LIFECYCLE_STATUSES) expect(LIFECYCLE_LABEL[s].length).toBeGreaterThan(3);
  });
  it('shows problems in danger tones and a live device in ok', () => {
    expect(displayStatusTone({ lifecycleStatus: 'SUSPENDED', displayStatus: 'Suspended' })).toBe('danger');
    expect(displayStatusTone({ lifecycleStatus: 'ACTIVE', displayStatus: 'Online' })).toBe('ok');
    expect(displayStatusTone({ lifecycleStatus: 'ACTIVE', displayStatus: 'Offline' })).toBe('warn');
    expect(displayStatusTone({ lifecycleStatus: 'AWAITING_FIRST_SIGNAL', displayStatus: 'Awaiting first GPS signal' })).toBe('brand');
  });
  it('polls only while waiting, and lets the customer confirm only before that', () => {
    expect(isWaitingForSignal('AWAITING_FIRST_SIGNAL')).toBe(true);
    expect(isWaitingForSignal('ACTIVE')).toBe(false);
    expect(canConfirmConfigured('AWAITING_CONFIGURATION')).toBe(true);
    expect(canConfirmConfigured('REGISTERED')).toBe(true);
    expect(canConfirmConfigured('ACTIVE')).toBe(false);
    expect(canConfirmConfigured('RETIRED')).toBe(false);
  });
});

describe('catalogue display', () => {
  it('groups models by manufacturer, sorted', () => {
    const g = groupByManufacturer([model('Zed', 'B'), model('Acme', 'Y'), model('Acme', 'X')]);
    expect(g.map((x) => x.manufacturer)).toEqual(['Acme', 'Zed']);
    expect(g[0]!.models.map((m) => m.name)).toEqual(['X', 'Y']);
  });
  it('describes firmware ranges in words', () => {
    expect(firmwareRange({ firmwareMin: '1.0', firmwareMax: '2.0' })).toBe('firmware 1.0 – 2.0');
    expect(firmwareRange({ firmwareMin: '1.0', firmwareMax: null })).toBe('firmware 1.0 and later');
    expect(firmwareRange({ firmwareMin: null, firmwareMax: '2.0' })).toBe('firmware up to 2.0');
    expect(firmwareRange({ firmwareMin: null, firmwareMax: null })).toBe('any firmware');
  });
  it('knows every capability key', () => {
    expect(CAPABILITY_KEYS).toHaveLength(15);
  });
});
