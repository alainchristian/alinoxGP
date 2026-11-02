/**
 * OsmAnd protocol client — the ONLY place that knows how we talk to Traccar's OsmAnd decoder.
 *
 * Verified against Traccar 6.16.0 (apps/api/test/fixtures/traccar/osmand-behaviour.json):
 *  - `speed` is passed through UNCONVERTED and stored as KNOTS, so km/h must be converted here.
 *  - `timestamp` is epoch seconds; without it the server time is used.
 *  - `batt` becomes the `batteryLevel` attribute (percent); `ignition=true|false` is kept as a boolean attribute;
 *    extra parameters (e.g. `simulated=true`) are stored as attributes.
 *  - An unregistered device id is answered with HTTP 400 (nothing is auto-created).
 *  - Latitude outside +-90 makes the server close the connection without a response.
 */
export const KMH_PER_KNOT = 1.852;

export const kmhToKnots = (kmh: number): number => Math.round((kmh / KMH_PER_KNOT) * 100) / 100;

export interface OsmandPosition {
  /** Unique id registered in the platform. Simulated devices MUST start with `SIM-`. */
  id: string;
  latitude: number;
  longitude: number;
  /** km/h (converted to knots on the wire). */
  speedKmh?: number;
  heading?: number;
  altitudeM?: number;
  accuracyM?: number;
  batteryPercent?: number;
  satellites?: number;
  hdop?: number;
  /** undefined = not reported (the attribute is omitted, so the platform shows Unknown). */
  ignition?: boolean;
  /** Device clock, epoch ms. Defaults to now. */
  time?: number;
}

export function buildOsmandQuery(p: OsmandPosition): URLSearchParams {
  const q = new URLSearchParams();
  q.set('id', p.id);
  q.set('lat', String(p.latitude));
  q.set('lon', String(p.longitude));
  q.set('timestamp', String(Math.floor((p.time ?? Date.now()) / 1000)));
  if (p.speedKmh !== undefined) q.set('speed', String(kmhToKnots(p.speedKmh)));
  if (p.heading !== undefined) q.set('bearing', String(Math.round(p.heading)));
  if (p.altitudeM !== undefined) q.set('altitude', String(p.altitudeM));
  if (p.accuracyM !== undefined) q.set('accuracy', String(p.accuracyM));
  if (p.batteryPercent !== undefined) q.set('batt', String(p.batteryPercent));
  if (p.satellites !== undefined) q.set('sat', String(p.satellites));
  if (p.hdop !== undefined) q.set('hdop', String(p.hdop));
  if (p.ignition !== undefined) q.set('ignition', String(p.ignition));
  // Every simulated position declares itself (spec §9). The platform additionally checks its own device record.
  if (p.id.startsWith('SIM-')) q.set('simulated', 'true');
  return q;
}

export class SimulatorGuardError extends Error {}

export interface SendResult {
  httpStatus: number | 'connection-closed';
}

/** Sends one position. Refuses ids that are not clearly simulated: this tool must never impersonate a real device. */
export async function sendPosition(baseUrl: string, p: OsmandPosition, fetchImpl: typeof fetch = fetch): Promise<SendResult> {
  if (!p.id.startsWith('SIM-')) throw new SimulatorGuardError(`Refusing to send for "${p.id}": simulated device ids must start with "SIM-"`);
  try {
    const res = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/?${buildOsmandQuery(p)}`);
    return { httpStatus: res.status };
  } catch {
    return { httpStatus: 'connection-closed' };
  }
}
