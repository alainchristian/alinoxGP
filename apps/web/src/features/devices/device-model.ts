import {
  CAPABILITY_KEYS,
  COMPATIBILITY_LABEL,
  isValidImei,
  type CapabilityKey,
  type CapabilityState,
  type CatalogueModelDto,
  type CompatibilityStatus,
  type DeviceDto,
  type DeviceLifecycleStatus,
  type IdentifierType,
  type ObservedState,
} from '@gps/shared';

/** Pure helpers for the device pages (labels, tones, wizard rules). Unit-tested; no React here. */

export type Tone = 'neutral' | 'brand' | 'ok' | 'warn' | 'danger';

/**
 * Green means VERIFIED on hardware and nothing else. "Supported, not yet verified" is the product's honest middle state
 * and is never styled like a confirmed one.
 */
export const CAPABILITY_TONE: Record<CapabilityState, Tone> = {
  VERIFIED: 'ok',
  SUPPORTED_UNVERIFIED: 'brand',
  PARTIAL: 'warn',
  REQUIRES_CONFIGURATION: 'warn',
  NOT_SUPPORTED: 'neutral',
  DISABLED: 'neutral',
  UNKNOWN: 'neutral',
};

export const OBSERVED_LABEL: Record<ObservedState, string> = {
  SEEN: 'Seen in the device’s data',
  NOT_SEEN: 'Not seen although the device reports',
  NOT_YET_REPORTED: 'No data yet (not reported, or not installed on a vehicle)',
  NOT_OBSERVABLE: 'Cannot be checked yet',
};

export const COMPATIBILITY_TONE: Record<CompatibilityStatus, Tone> = {
  VERIFIED: 'ok',
  SUPPORTED_UNVERIFIED: 'brand',
  PARTIAL: 'warn',
  REQUIRES_CONFIGURATION: 'warn',
  UNSUPPORTED: 'danger',
};
export const compatibilityLabel = (s: CompatibilityStatus) => COMPATIBILITY_LABEL[s];

/** Tone of the activation status shown to users (spec wording comes from the API). */
export function displayStatusTone(d: Pick<DeviceDto, 'lifecycleStatus' | 'displayStatus'>): Tone {
  const l: DeviceLifecycleStatus = d.lifecycleStatus;
  if (l === 'CONFIGURATION_ERROR' || l === 'SUSPENDED') return 'danger';
  if (l === 'RETIRED') return 'neutral';
  if (l === 'ACTIVE') return d.displayStatus === 'Online' ? 'ok' : d.displayStatus === 'Offline' ? 'warn' : 'neutral';
  return 'brand';
}

/** Capability keys in the product's display order. */
export const CAPABILITY_ORDER: readonly CapabilityKey[] = CAPABILITY_KEYS;

/** "Toyota Hiace" style label of a model, with its variant count; used in pickers. */
export const modelLabel = (m: Pick<CatalogueModelDto, 'manufacturer' | 'name'>) => `${m.manufacturer.name} ${m.name}`;

/** Models grouped by manufacturer for the picker. */
export function groupByManufacturer(models: CatalogueModelDto[]): { manufacturer: string; models: CatalogueModelDto[] }[] {
  const out = new Map<string, CatalogueModelDto[]>();
  for (const m of models) out.set(m.manufacturer.name, [...(out.get(m.manufacturer.name) ?? []), m]);
  return [...out.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([manufacturer, list]) => ({ manufacturer, models: list.sort((a, b) => a.name.localeCompare(b.name)) }));
}

/** Firmware range in words: "firmware 1.0 – 2.0", "firmware 1.0 and later", "any firmware". */
export function firmwareRange(v: { firmwareMin: string | null; firmwareMax: string | null }): string {
  if (v.firmwareMin && v.firmwareMax) return `firmware ${v.firmwareMin} – ${v.firmwareMax}`;
  if (v.firmwareMin) return `firmware ${v.firmwareMin} and later`;
  if (v.firmwareMax) return `firmware up to ${v.firmwareMax}`;
  return 'any firmware';
}

/** Hint under the identifier field, by what the model transmits. */
export function identifierHint(type: IdentifierType | null): string {
  if (type === 'IMEI') return '15 digits, usually printed on the device or its box';
  if (type === 'SERIAL') return 'The serial number the device transmits';
  return 'The identifier the device transmits to the platform';
}

/** Client-side check mirroring the server rule; the server stays the authority. Returns an error message or null. */
export function identifierError(value: string, type: IdentifierType | null): string | null {
  const v = value.trim();
  if (!v) return 'Enter the device identifier';
  if (type === 'IMEI' && !isValidImei(v)) return 'This is not a valid IMEI (15 digits with a correct check digit)';
  if (!/^[A-Za-z0-9._:-]{3,64}$/.test(v)) return 'Use 3–64 letters, digits or . _ : -';
  return null;
}

/** Whether the customer is still waiting for the device (the page polls only then). */
export const isWaitingForSignal = (s: DeviceLifecycleStatus) => s === 'AWAITING_FIRST_SIGNAL';
/** Whether the customer can confirm the device is configured. */
export const canConfirmConfigured = (s: DeviceLifecycleStatus) => s === 'REGISTERED' || s === 'AWAITING_CONFIGURATION' || s === 'CONFIGURATION_ERROR';

export const LIFECYCLE_LABEL: Record<DeviceLifecycleStatus, string> = {
  REGISTERED: 'Registered',
  AWAITING_CONFIGURATION: 'Awaiting configuration',
  AWAITING_FIRST_SIGNAL: 'Awaiting first GPS signal',
  ACTIVE: 'Active',
  CONFIGURATION_ERROR: 'Configuration error',
  SUSPENDED: 'Suspended',
  RETIRED: 'Retired',
};
