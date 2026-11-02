import { z } from 'zod';
import { uuidSchema, type DeviceLifecycleStatus } from './schemas';

/**
 * Device catalogue, effective capabilities, onboarding and consent (M5b, ADR-0009).
 * Rule 12: a capability is NEVER inferred from a manufacturer or model name. No catalogue row means UNKNOWN, not "no".
 */

// ---------------------------------------------------------------- identifiers

/** True for a 15-digit IMEI with a correct Luhn check digit. */
export function isValidImei(value: string): boolean {
  if (!/^\d{15}$/.test(value)) return false;
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    let d = Number(value[14 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

// ---------------------------------------------------------------- statuses

export const COMPATIBILITY_STATUSES = ['VERIFIED', 'SUPPORTED_UNVERIFIED', 'PARTIAL', 'UNSUPPORTED', 'REQUIRES_CONFIGURATION'] as const;
export type CompatibilityStatus = (typeof COMPATIBILITY_STATUSES)[number];
/** The spec's wording for each compatibility status. */
export const COMPATIBILITY_LABEL: Record<CompatibilityStatus, string> = {
  VERIFIED: 'Tested and verified',
  SUPPORTED_UNVERIFIED: 'Supported but not physically verified',
  PARTIAL: 'Partially supported',
  UNSUPPORTED: 'Unsupported',
  REQUIRES_CONFIGURATION: 'Requires configuration',
};

export const CAPABILITY_SUPPORTS = ['SUPPORTED', 'PARTIAL', 'NOT_SUPPORTED', 'REQUIRES_CONFIGURATION'] as const;
export type CapabilitySupport = (typeof CAPABILITY_SUPPORTS)[number];

export const IDENTIFIER_TYPES = ['IMEI', 'SERIAL', 'OTHER'] as const;
export type IdentifierType = (typeof IDENTIFIER_TYPES)[number];

export const CAPABILITY_KEYS = [
  'gps_tracking',
  'trip_history',
  'ignition_detection',
  'speed_monitoring',
  'motion_detection',
  'external_power_monitoring',
  'battery_monitoring',
  'fuel_monitoring',
  'digital_inputs',
  'digital_outputs',
  'driver_identification',
  'sos_button',
  'towing_detection',
  'remote_configuration',
  'remote_immobilization',
] as const;
export type CapabilityKey = (typeof CAPABILITY_KEYS)[number];
export const CAPABILITY_LABEL: Record<CapabilityKey, string> = {
  gps_tracking: 'Live vehicle tracking',
  trip_history: 'Trip history',
  ignition_detection: 'Ignition monitoring',
  speed_monitoring: 'Speed monitoring',
  motion_detection: 'Motion detection',
  external_power_monitoring: 'External power monitoring',
  battery_monitoring: 'Backup battery monitoring',
  fuel_monitoring: 'Fuel monitoring',
  digital_inputs: 'Digital inputs',
  digital_outputs: 'Digital outputs',
  driver_identification: 'Driver identification',
  sos_button: 'SOS button',
  towing_detection: 'Towing detection',
  remote_configuration: 'Remote configuration',
  remote_immobilization: 'Remote immobilization',
};

// ---------------------------------------------------------------- effective capabilities (pure; shared by API and web)

export type CapabilityState = 'VERIFIED' | 'SUPPORTED_UNVERIFIED' | 'PARTIAL' | 'NOT_SUPPORTED' | 'REQUIRES_CONFIGURATION' | 'DISABLED' | 'UNKNOWN';
export type ObservedState = 'SEEN' | 'NOT_SEEN' | 'NOT_YET_REPORTED' | 'NOT_OBSERVABLE';
/** Customer-facing wording. SUPPORTED_UNVERIFIED is deliberately not shown as plain "Supported". */
export const CAPABILITY_STATE_LABEL: Record<CapabilityState, string> = {
  VERIFIED: 'Supported',
  SUPPORTED_UNVERIFIED: 'Supported, not yet verified',
  PARTIAL: 'Partially supported',
  NOT_SUPPORTED: 'Not supported',
  REQUIRES_CONFIGURATION: 'Needs setup',
  DISABLED: 'Not enabled',
  UNKNOWN: 'Unknown',
};

export interface EffectiveCapabilityDto {
  key: CapabilityKey;
  state: CapabilityState;
  observed: ObservedState;
  /** Plain-language explanation of the state. */
  reason: string;
}

export interface CapabilityRow {
  support: CapabilitySupport;
}
export interface CapabilityInput {
  /** null = the device has not been identified as a catalogue variant. */
  variant: { compatibilityStatus: CompatibilityStatus } | null;
  /** Catalogue rows by key. A missing key means the catalogue says nothing (UNKNOWN). */
  rows: Partial<Record<CapabilityKey, CapabilityRow>>;
  /** What the platform has actually seen from this device. */
  observation: { everReported: boolean; positionSeen: boolean; speedSeen: boolean; ignitionSeen: boolean; motionSeen: boolean };
  /** A platform technician has verified how the device is wired. No installation records exist before M9, so this is false for now. */
  installationVerified: boolean;
}

/** Capabilities whose truth depends on how the device was wired, not only on the model. */
export const INSTALLATION_DEPENDENT: readonly CapabilityKey[] = ['ignition_detection', 'external_power_monitoring', 'digital_inputs', 'digital_outputs', 'remote_immobilization'];

export function effectiveCapabilities(input: CapabilityInput): EffectiveCapabilityDto[] {
  const { variant, rows, observation: o } = input;
  const evidence: Partial<Record<CapabilityKey, boolean>> = {
    gps_tracking: o.positionSeen,
    trip_history: o.positionSeen,
    speed_monitoring: o.speedSeen,
    ignition_detection: o.ignitionSeen,
    motion_detection: o.motionSeen,
  };
  return CAPABILITY_KEYS.map((key): EffectiveCapabilityDto => {
    const observable = key in evidence;
    const observedState = (): ObservedState => (!observable ? 'NOT_OBSERVABLE' : !o.everReported ? 'NOT_YET_REPORTED' : evidence[key] ? 'SEEN' : 'NOT_SEEN');

    if (!variant) return { key, state: 'UNKNOWN', observed: observedState(), reason: 'The device model has not been identified, so nothing can be said about this.' };
    const row = rows[key];
    if (!row) return { key, state: 'UNKNOWN', observed: observedState(), reason: 'The catalogue has no information about this for the model.' };
    if (variant.compatibilityStatus === 'UNSUPPORTED' || row.support === 'NOT_SUPPORTED') {
      return { key, state: 'NOT_SUPPORTED', observed: observedState(), reason: variant.compatibilityStatus === 'UNSUPPORTED' ? 'This model is listed as unsupported.' : 'The catalogue lists this as not supported by the model.' };
    }
    if (key === 'remote_immobilization') {
      return { key, state: 'DISABLED', observed: 'NOT_OBSERVABLE', reason: 'Switched off until a verified starter-circuit installation and a verified command path exist.' };
    }

    let state: CapabilityState = row.support === 'PARTIAL' ? 'PARTIAL' : row.support === 'REQUIRES_CONFIGURATION' ? 'REQUIRES_CONFIGURATION' : variant.compatibilityStatus === 'VERIFIED' ? 'VERIFIED' : 'SUPPORTED_UNVERIFIED';
    let reason =
      state === 'VERIFIED' ? 'Verified for this model by a recorded test.'
      : state === 'SUPPORTED_UNVERIFIED' ? 'Expected from the catalogue; the model has not been verified on physical hardware.'
      : state === 'PARTIAL' ? 'The catalogue lists this as partially supported.'
      : 'The catalogue says this needs configuration on the device.';

    if (state === 'VERIFIED' && INSTALLATION_DEPENDENT.includes(key) && !input.installationVerified) {
      state = 'SUPPORTED_UNVERIFIED';
      reason = 'Supported by this model, but it depends on how the device was wired and the installation has not been verified.';
    }

    const obs = observedState();
    if (obs === 'NOT_SEEN') {
      return { key, state: 'REQUIRES_CONFIGURATION', observed: obs, reason: 'The device has reported, but has not delivered the data this needs. Check the wiring and the device settings.' };
    }
    // What was or was not observed is its own field (`observed`) and the UI shows it on its own line; the reason stays about the state.
    return { key, state, observed: obs, reason };
  });
}

// ---------------------------------------------------------------- lifecycle and display status (ADR-0005)

export type DeviceConnectivity = 'ONLINE' | 'OFFLINE' | 'NEVER_CONNECTED';
export function deviceConnectivity(lastSeenAt: Date | null, now: Date, offlineAfterSec: number): DeviceConnectivity {
  if (!lastSeenAt) return 'NEVER_CONNECTED';
  return (now.getTime() - lastSeenAt.getTime()) / 1000 > offlineAfterSec ? 'OFFLINE' : 'ONLINE';
}

/** The spec's activation wording. Lifecycle wins unless the device is ACTIVE, then connectivity shows. */
export function deviceDisplayStatus(lifecycle: DeviceLifecycleStatus, connectivity: DeviceConnectivity): string {
  switch (lifecycle) {
    case 'REGISTERED': return 'Registered';
    case 'AWAITING_CONFIGURATION': return 'Awaiting configuration';
    case 'AWAITING_FIRST_SIGNAL': return 'Awaiting first GPS signal';
    case 'CONFIGURATION_ERROR': return 'Configuration error';
    case 'SUSPENDED': return 'Suspended';
    case 'RETIRED': return 'Retired';
    case 'ACTIVE': return connectivity === 'ONLINE' ? 'Online' : connectivity === 'OFFLINE' ? 'Offline' : 'Awaiting first GPS signal';
  }
}

/** Allowed lifecycle transitions. The first usable position additionally moves a pre-active device to ACTIVE (see the lifecycle service). */
export const LIFECYCLE_TRANSITIONS: Record<DeviceLifecycleStatus, readonly DeviceLifecycleStatus[]> = {
  REGISTERED: ['AWAITING_CONFIGURATION', 'AWAITING_FIRST_SIGNAL', 'ACTIVE', 'SUSPENDED', 'RETIRED'],
  AWAITING_CONFIGURATION: ['AWAITING_FIRST_SIGNAL', 'ACTIVE', 'CONFIGURATION_ERROR', 'SUSPENDED', 'RETIRED'],
  AWAITING_FIRST_SIGNAL: ['AWAITING_CONFIGURATION', 'ACTIVE', 'CONFIGURATION_ERROR', 'SUSPENDED', 'RETIRED'],
  ACTIVE: ['CONFIGURATION_ERROR', 'SUSPENDED', 'RETIRED'],
  CONFIGURATION_ERROR: ['AWAITING_CONFIGURATION', 'AWAITING_FIRST_SIGNAL', 'ACTIVE', 'SUSPENDED', 'RETIRED'],
  SUSPENDED: ['AWAITING_FIRST_SIGNAL', 'ACTIVE', 'RETIRED'],
  RETIRED: [],
};
export const canTransition = (from: DeviceLifecycleStatus, to: DeviceLifecycleStatus) => LIFECYCLE_TRANSITIONS[from].includes(to);
/** A device that has not yet proved it transmits. The first usable position activates these. */
export const PRE_ACTIVE: readonly DeviceLifecycleStatus[] = ['REGISTERED', 'AWAITING_CONFIGURATION', 'AWAITING_FIRST_SIGNAL', 'CONFIGURATION_ERROR'];
/** How long a device may wait for its first signal before diagnostics flags it. */
export const FIRST_SIGNAL_STUCK_AFTER_HOURS = 24;

// ---------------------------------------------------------------- catalogue management (platform staff)

const optText = (max: number) =>
  z.string().trim().max(max).transform((v) => (v === '' ? null : v)).nullable().optional();
const nonEmpty = (max: number) => z.string().trim().min(1, 'Required').max(max);

export const createManufacturerSchema = z.object({ name: nonEmpty(80), website: optText(200) });
export const updateManufacturerSchema = createManufacturerSchema.partial().refine((v) => Object.keys(v).length > 0, { message: 'Nothing to change' });

const modelFields = {
  protocol: nonEmpty(40),
  enginePort: z.number().int().min(1).max(65535).nullable().optional(),
  networkTechnologies: z.array(nonEmpty(20)).max(8).optional(),
  identifierType: z.enum(IDENTIFIER_TYPES).optional(),
  reportingNotes: optText(500),
  configurationNotes: optText(4000),
  installationRequirements: optText(2000),
  knownLimitations: optText(2000),
  docsUrl: optText(300),
  isListed: z.boolean().optional(),
};
export const createModelSchema = z.object({ manufacturerId: uuidSchema, name: nonEmpty(80), ...modelFields });
export const updateModelSchema = z.object({ name: nonEmpty(80).optional(), ...modelFields }).refine((v) => Object.keys(v).length > 0, { message: 'Nothing to change' });

const variantFields = {
  hardwareRevision: optText(40),
  firmwareMin: optText(40),
  firmwareMax: optText(40),
  notes: optText(1000),
  /** VERIFIED is refused unless a verification record exists; use the verification endpoint to record a test. */
  compatibilityStatus: z.enum(COMPATIBILITY_STATUSES).optional(),
};
export const createVariantSchema = z.object({ modelId: uuidSchema, ...variantFields });
export const updateVariantSchema = z.object(variantFields).refine((v) => Object.keys(v).length > 0, { message: 'Nothing to change' });

export const setCapabilitySchema = z.object({
  support: z.enum(CAPABILITY_SUPPORTS),
  evidenceAttribute: optText(80),
  evidenceNotes: optText(1000),
});
/** A recorded test. Recording one is what allows a variant to become VERIFIED. */
export const addVerificationSchema = z.object({
  testedAt: z.iso.datetime(),
  testedByName: nonEmpty(120),
  firmwareVersion: nonEmpty(60),
  procedure: nonEmpty(2000),
  evidence: nonEmpty(4000),
});

export interface CapabilityRowDto {
  key: CapabilityKey;
  support: CapabilitySupport;
  evidenceAttribute: string | null;
  evidenceNotes: string | null;
  verifiedAt: string | null;
}
export interface VerificationDto {
  id: string;
  testedAt: string;
  testedByName: string;
  firmwareVersion: string;
  procedure: string;
  evidence: string;
}
export interface VariantDto {
  id: string;
  hardwareRevision: string | null;
  firmwareMin: string | null;
  firmwareMax: string | null;
  compatibilityStatus: CompatibilityStatus;
  lastTestedAt: string | null;
  notes: string | null;
  capabilities: CapabilityRowDto[];
  verifications: VerificationDto[];
}
export interface CatalogueModelDto {
  id: string;
  manufacturer: { id: string; name: string };
  name: string;
  protocol: string;
  enginePort: number | null;
  networkTechnologies: string[];
  identifierType: IdentifierType;
  reportingNotes: string | null;
  configurationNotes: string | null;
  installationRequirements: string | null;
  knownLimitations: string | null;
  docsUrl: string | null;
  isListed: boolean;
  /** A software profile of the platform simulator, not a physical device. */
  isSimulatorProfile: boolean;
  variants: VariantDto[];
}

// ---------------------------------------------------------------- onboarding, consent, support requests

export const requestSupportSchema = z.object({
  manufacturerText: nonEmpty(80),
  modelText: nonEmpty(80),
  firmwareText: optText(60),
  notes: optText(2000),
});
export const SUPPORT_REQUEST_STATUSES = ['OPEN', 'RESOLVED', 'DECLINED'] as const;
export type SupportRequestStatus = (typeof SUPPORT_REQUEST_STATUSES)[number];
export const resolveSupportRequestSchema = z.object({ status: z.enum(['RESOLVED', 'DECLINED']), resolutionNote: optText(1000) });
export interface SupportRequestDto {
  id: string;
  organization?: { id: string; name: string };
  manufacturerText: string;
  modelText: string;
  firmwareText: string | null;
  notes: string | null;
  status: SupportRequestStatus;
  resolutionNote: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface ConsentNoticeDto {
  id: string;
  kind: 'TRACKING_NOTICE';
  version: number;
  title: string;
  body: string;
  /** True while the wording has not been through legal review (OQ-020, OQ-037): shown on screen. */
  isDraftWording: boolean;
}
export const publishConsentNoticeSchema = z.object({ title: nonEmpty(120), body: nonEmpty(6000), isDraftWording: z.boolean() });

export interface DeviceConfigurationDto {
  deviceId: string;
  /** What the device must transmit as its identifier. */
  identifier: string;
  identifierType: IdentifierType | null;
  /** The platform's GPS server the device connects to. null = not configured on this deployment. */
  serverHost: string | null;
  port: number | null;
  protocol: string | null;
  notes: string | null;
  /** Why some fields are missing (never guessed). */
  missing: string[];
}

/** Platform staff only. */
export const setLifecycleSchema = z.object({
  status: z.enum(['AWAITING_CONFIGURATION', 'AWAITING_FIRST_SIGNAL', 'ACTIVE', 'CONFIGURATION_ERROR', 'SUSPENDED', 'RETIRED']),
  reason: z.string().trim().min(1, 'Give a reason').max(300),
});
export const setDeviceVariantSchema = z.object({ variantId: uuidSchema.nullable(), firmwareVersion: optText(60) });

export interface DeviceCapabilitiesDto {
  deviceId: string;
  variant: { id: string; label: string; compatibilityStatus: CompatibilityStatus; isSimulatorProfile: boolean } | null;
  computedAt: string;
  capabilities: EffectiveCapabilityDto[];
}

export interface DeviceStatusHistoryDto {
  id: string;
  fromStatus: DeviceLifecycleStatus | null;
  toStatus: DeviceLifecycleStatus;
  reason: string | null;
  byUser: boolean;
  at: string;
}

/** Read-only diagnostics for technical administrators (cross-tenant, platform permission). */
export interface DeviceDiagnosticsDto {
  device: {
    id: string;
    uniqueId: string;
    name: string | null;
    organization: { id: string; name: string } | null;
    lifecycleStatus: DeviceLifecycleStatus;
    connectivity: DeviceConnectivity;
    displayStatus: string;
    isSimulated: boolean;
    firmwareVersion: string | null;
    serialNumber: string | null;
    simIccid: string | null;
    variantLabel: string | null;
    firstSignalAt: string | null;
    lastSeenAt: string | null;
    createdAt: string;
    awaitingFirstSignalTooLong: boolean;
  };
  engine: { reachable: boolean; known: boolean; engineStatus: 'online' | 'offline' | 'unknown' | null; lastUpdate: string | null; syncStatus: 'PENDING' | 'SYNCED' | 'FAILED'; syncError: string | null; protocol: string | null };
  history: DeviceStatusHistoryDto[];
  capabilities: EffectiveCapabilityDto[];
  /** What is missing for capability evidence, in words. */
  notes: string[];
}
export interface AdminDeviceRowDto {
  id: string;
  uniqueId: string;
  organizationName: string | null;
  lifecycleStatus: DeviceLifecycleStatus;
  displayStatus: string;
  isSimulated: boolean;
  variantLabel: string | null;
  lastSeenAt: string | null;
  createdAt: string;
  awaitingFirstSignalTooLong: boolean;
}
