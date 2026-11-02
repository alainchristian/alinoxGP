import { describe, expect, it } from 'vitest';
import {
  CAPABILITY_KEYS,
  canTransition,
  deviceConnectivity,
  deviceDisplayStatus,
  effectiveCapabilities,
  isValidImei,
  addVerificationSchema,
  createModelSchema,
  type CapabilityInput,
  type CapabilityKey,
} from './catalogue';
import { DEVICE_LIFECYCLE_STATUSES, registerDeviceSchema } from './schemas';

describe('isValidImei', () => {
  it('accepts a 15-digit number with a correct Luhn check digit', () => {
    expect(isValidImei('490154203237518')).toBe(true); // the standard Luhn example IMEI
    expect(isValidImei('356938035643809')).toBe(true);
  });
  it('rejects a wrong check digit, wrong length and non-digits', () => {
    expect(isValidImei('490154203237519')).toBe(false);
    expect(isValidImei('49015420323751')).toBe(false);
    expect(isValidImei('4901542032375181')).toBe(false);
    expect(isValidImei('49015420323751A')).toBe(false);
    expect(isValidImei('')).toBe(false);
  });
});

const seen = { everReported: true, positionSeen: true, speedSeen: true, ignitionSeen: true, motionSeen: true };
const none = { everReported: false, positionSeen: false, speedSeen: false, ignitionSeen: false, motionSeen: false };
const input = (over: Partial<CapabilityInput>): CapabilityInput => ({
  variant: { compatibilityStatus: 'SUPPORTED_UNVERIFIED' },
  rows: {},
  observation: none,
  installationVerified: false,
  ...over,
});
const get = (list: ReturnType<typeof effectiveCapabilities>, key: CapabilityKey) => list.find((c) => c.key === key)!;

describe('effectiveCapabilities', () => {
  it('always returns every capability key, once', () => {
    const out = effectiveCapabilities(input({}));
    expect(out.map((c) => c.key)).toEqual([...CAPABILITY_KEYS]);
  });

  it('is UNKNOWN for everything when the model was not identified (never "not supported")', () => {
    const out = effectiveCapabilities(input({ variant: null, rows: { gps_tracking: { support: 'SUPPORTED' } } }));
    expect(out.every((c) => c.state === 'UNKNOWN')).toBe(true);
  });

  it('is UNKNOWN when the catalogue has no row, even for a verified model', () => {
    const out = effectiveCapabilities(input({ variant: { compatibilityStatus: 'VERIFIED' }, rows: { gps_tracking: { support: 'SUPPORTED' } } }));
    expect(get(out, 'gps_tracking').state).not.toBe('UNKNOWN');
    expect(get(out, 'fuel_monitoring').state).toBe('UNKNOWN');
  });

  it('never promotes a capability of an unverified model to verified', () => {
    const out = effectiveCapabilities(input({ rows: { gps_tracking: { support: 'SUPPORTED' } }, observation: seen }));
    expect(get(out, 'gps_tracking').state).toBe('SUPPORTED_UNVERIFIED');
    expect(get(out, 'gps_tracking').observed).toBe('SEEN');
  });

  it('shows VERIFIED only for a verified model whose capability does not depend on wiring', () => {
    const out = effectiveCapabilities(input({ variant: { compatibilityStatus: 'VERIFIED' }, rows: { gps_tracking: { support: 'SUPPORTED' }, ignition_detection: { support: 'SUPPORTED' } }, observation: seen }));
    expect(get(out, 'gps_tracking').state).toBe('VERIFIED');
    // Ignition depends on the ignition wire: capped until the installation is verified.
    expect(get(out, 'ignition_detection').state).toBe('SUPPORTED_UNVERIFIED');
    const wired = effectiveCapabilities(input({ variant: { compatibilityStatus: 'VERIFIED' }, rows: { ignition_detection: { support: 'SUPPORTED' } }, observation: seen, installationVerified: true }));
    expect(get(wired, 'ignition_detection').state).toBe('VERIFIED');
  });

  it('says "needs setup" when the device has reported but never delivered the evidence', () => {
    const out = effectiveCapabilities(input({ rows: { ignition_detection: { support: 'SUPPORTED' } }, observation: { ...seen, ignitionSeen: false } }));
    const c = get(out, 'ignition_detection');
    expect(c.state).toBe('REQUIRES_CONFIGURATION');
    expect(c.observed).toBe('NOT_SEEN');
  });

  it('does not penalise a device that has not reported yet', () => {
    const out = effectiveCapabilities(input({ rows: { ignition_detection: { support: 'SUPPORTED' } }, observation: none }));
    expect(get(out, 'ignition_detection').state).toBe('SUPPORTED_UNVERIFIED');
    expect(get(out, 'ignition_detection').observed).toBe('NOT_YET_REPORTED');
  });

  it('marks what the platform cannot observe yet, and never upgrades it', () => {
    const out = effectiveCapabilities(input({ variant: { compatibilityStatus: 'VERIFIED' }, rows: { battery_monitoring: { support: 'SUPPORTED' } }, observation: seen }));
    expect(get(out, 'battery_monitoring').observed).toBe('NOT_OBSERVABLE');
    expect(get(out, 'battery_monitoring').state).toBe('VERIFIED');
  });

  it('maps partial, configuration-required and not-supported rows', () => {
    const out = effectiveCapabilities(input({ rows: { sos_button: { support: 'PARTIAL' }, towing_detection: { support: 'REQUIRES_CONFIGURATION' }, fuel_monitoring: { support: 'NOT_SUPPORTED' } } }));
    expect(get(out, 'sos_button').state).toBe('PARTIAL');
    expect(get(out, 'towing_detection').state).toBe('REQUIRES_CONFIGURATION');
    expect(get(out, 'fuel_monitoring').state).toBe('NOT_SUPPORTED');
  });

  it('treats an unsupported model as unsupported for every capability it has a row for', () => {
    const out = effectiveCapabilities(input({ variant: { compatibilityStatus: 'UNSUPPORTED' }, rows: { gps_tracking: { support: 'SUPPORTED' } } }));
    expect(get(out, 'gps_tracking').state).toBe('NOT_SUPPORTED');
  });

  it('remote immobilization is NEVER effective, whatever the catalogue, the observation or the installation say', () => {
    for (const support of ['SUPPORTED', 'PARTIAL', 'REQUIRES_CONFIGURATION'] as const) {
      for (const status of ['VERIFIED', 'SUPPORTED_UNVERIFIED', 'PARTIAL', 'REQUIRES_CONFIGURATION'] as const) {
        const out = effectiveCapabilities(input({ variant: { compatibilityStatus: status }, rows: { remote_immobilization: { support } }, observation: seen, installationVerified: true }));
        expect(get(out, 'remote_immobilization').state).toBe('DISABLED');
      }
    }
    // Not even "unknown" hides it: with no row it stays unknown, never enabled.
    expect(get(effectiveCapabilities(input({})), 'remote_immobilization').state).toBe('UNKNOWN');
  });

  it('every state comes with a reason', () => {
    for (const out of [effectiveCapabilities(input({ variant: null })), effectiveCapabilities(input({ rows: { gps_tracking: { support: 'SUPPORTED' } }, observation: seen }))]) {
      expect(out.every((c) => c.reason.length > 10)).toBe(true);
    }
  });
});

describe('lifecycle and display status', () => {
  it('connectivity is derived from last seen, never stored', () => {
    const now = new Date('2026-11-02T12:00:00Z');
    expect(deviceConnectivity(null, now, 600)).toBe('NEVER_CONNECTED');
    expect(deviceConnectivity(new Date('2026-11-02T11:55:00Z'), now, 600)).toBe('ONLINE');
    expect(deviceConnectivity(new Date('2026-11-02T11:40:00Z'), now, 600)).toBe('OFFLINE');
  });
  it('lifecycle wins unless ACTIVE; a suspended device that is transmitting still shows Suspended', () => {
    expect(deviceDisplayStatus('SUSPENDED', 'ONLINE')).toBe('Suspended');
    expect(deviceDisplayStatus('AWAITING_CONFIGURATION', 'NEVER_CONNECTED')).toBe('Awaiting configuration');
    expect(deviceDisplayStatus('CONFIGURATION_ERROR', 'ONLINE')).toBe('Configuration error');
    expect(deviceDisplayStatus('ACTIVE', 'ONLINE')).toBe('Online');
    expect(deviceDisplayStatus('ACTIVE', 'OFFLINE')).toBe('Offline');
  });
  it('a retired device is final; nothing leaves RETIRED', () => {
    for (const to of DEVICE_LIFECYCLE_STATUSES) expect(canTransition('RETIRED', to)).toBe(false);
    expect(canTransition('REGISTERED', 'AWAITING_CONFIGURATION')).toBe(true);
    expect(canTransition('ACTIVE', 'REGISTERED')).toBe(false);
    expect(canTransition('ACTIVE', 'ACTIVE')).toBe(false);
  });
});

describe('schemas', () => {
  it('registerDevice keeps the old shape valid and normalises optional text', () => {
    expect(registerDeviceSchema.parse({ uniqueId: 'SIM-0001' })).toEqual({ uniqueId: 'SIM-0001' });
    const p = registerDeviceSchema.parse({ uniqueId: 'X1234', serialNumber: '  ', simIccid: '' });
    expect(p.serialNumber).toBeUndefined();
    expect(p.simIccid).toBeUndefined();
    expect(registerDeviceSchema.safeParse({ uniqueId: 'X1234', simIccid: '123' }).success).toBe(false);
  });
  it('a model needs a protocol and a valid port', () => {
    const base = { manufacturerId: '11111111-1111-4111-8111-111111111111', name: 'M', protocol: 'osmand' };
    expect(createModelSchema.safeParse(base).success).toBe(true);
    expect(createModelSchema.safeParse({ ...base, enginePort: 70000 }).success).toBe(false);
    expect(createModelSchema.safeParse({ ...base, protocol: '' }).success).toBe(false);
  });
  it('a verification needs who, when, firmware, procedure and evidence', () => {
    const ok = { testedAt: '2026-11-02T10:00:00Z', testedByName: 'A', firmwareVersion: '1.0', procedure: 'bench', evidence: 'log' };
    expect(addVerificationSchema.safeParse(ok).success).toBe(true);
    expect(addVerificationSchema.safeParse({ ...ok, evidence: ' ' }).success).toBe(false);
  });
});
