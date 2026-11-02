import type { EngineDevice, EnginePosition } from '../port';
import type { TraccarDevice, TraccarPosition } from './traccar.schemas';

/** Traccar reports speed in knots. */
export const KNOTS_TO_KMH = 1.852;

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Tri-state: only a real boolean (or the strings "true"/"false") is a value; anything else is "not reported". */
export function triState(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function toEngineDevice(d: TraccarDevice): EngineDevice {
  const status = d.status === 'online' || d.status === 'offline' ? d.status : 'unknown';
  return {
    engineId: d.id,
    uniqueId: d.uniqueId,
    name: d.name,
    disabled: d.disabled,
    engineStatus: status,
    lastUpdate: d.lastUpdate ? new Date(d.lastUpdate) : null,
  };
}

export function toEnginePosition(p: TraccarPosition): EnginePosition {
  const a = p.attributes;
  return {
    engineDeviceId: p.deviceId,
    engineId: p.id,
    fixTime: new Date(p.fixTime),
    deviceTime: new Date(p.deviceTime),
    serverTime: new Date(p.serverTime),
    latitude: p.latitude,
    longitude: p.longitude,
    altitudeM: p.altitude ?? null,
    speedKmh: p.speed === null || p.speed === undefined ? null : round1(p.speed * KNOTS_TO_KMH),
    heading: p.course ?? null,
    accuracyM: p.accuracy ?? null,
    valid: p.valid,
    ignition: triState(a['ignition']),
    motion: triState(a['motion']),
    externalPowerV: num(a['power']),
    batteryPercent: num(a['batteryLevel']),
    satellites: num(a['sat']),
    declaredSimulated: triState(a['simulated']) === true,
    protocol: p.protocol ?? 'unknown',
    raw: a,
  };
}
