import type { EngineDevice, EnginePosition, EngineStop, EngineTrip } from '../port';
import type { TraccarDevice, TraccarPosition, TraccarStop, TraccarTrip } from './traccar.schemas';

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

const usableCoordinate = (lat: number | null | undefined, lon: number | null | undefined): [number | null, number | null] =>
  lat != null && lon != null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0) ? [lat, lon] : [null, null];

/** Trip report row -> normalized trip: knots -> km/h, metres kept, an out-of-range coordinate becomes null (never drawn at 0,0). */
export function toEngineTrip(t: TraccarTrip): EngineTrip {
  const startTime = new Date(t.startTime);
  const endTime = new Date(t.endTime);
  const [startLatitude, startLongitude] = usableCoordinate(t.startLat, t.startLon);
  const [endLatitude, endLongitude] = usableCoordinate(t.endLat, t.endLon);
  return {
    startTime,
    endTime,
    durationMs: t.duration ?? Math.max(0, endTime.getTime() - startTime.getTime()),
    distanceM: Math.max(0, t.distance ?? 0),
    maxSpeedKmh: t.maxSpeed == null ? null : round1(t.maxSpeed * KNOTS_TO_KMH),
    averageSpeedKmh: t.averageSpeed == null ? null : round1(t.averageSpeed * KNOTS_TO_KMH),
    startLatitude,
    startLongitude,
    endLatitude,
    endLongitude,
    startAddress: t.startAddress ?? null,
    endAddress: t.endAddress ?? null,
  };
}

export function toEngineStop(s: TraccarStop): EngineStop {
  const startTime = new Date(s.startTime);
  const endTime = new Date(s.endTime);
  const [latitude, longitude] = usableCoordinate(s.latitude, s.longitude);
  return { startTime, endTime, durationMs: s.duration ?? Math.max(0, endTime.getTime() - startTime.getTime()), latitude, longitude, address: s.address ?? null };
}
