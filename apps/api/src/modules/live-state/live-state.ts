import type { LiveLocationDto, StatusThresholds, VehicleDeltaDto, VehicleStatus } from '@gps/shared';
import { deriveStatus } from '@gps/shared';

/** Latest known state of one vehicle (in memory / Redis form). Null = not reported — never 0 or false. */
export interface LiveState {
  vehicleId: string;
  organizationId: string;
  deviceId: string;
  latitude: number | null;
  longitude: number | null;
  speedKmh: number | null;
  heading: number | null;
  ignition: boolean | null;
  motion: boolean | null;
  lastFixAt: Date | null;
  lastSeenAt: Date;
  lastFixInvalid: boolean;
  lastFixDelayed: boolean;
  stationarySince: Date | null;
  status: VehicleStatus;
  statusChangedAt: Date | null;
  simulated: boolean;
}

/** One position kept in the short per-vehicle history used by safety checks (e.g. stationarity window, M7). */
export interface RecentSample {
  fixAt: string;
  lat: number;
  lon: number;
  speedKmh: number | null;
  ignition: boolean | null;
  motion: boolean | null;
  delayed: boolean;
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);
const date = (s: string | null | undefined) => (s ? new Date(s) : null);

export const serializeState = (s: LiveState): string =>
  JSON.stringify({ ...s, lastFixAt: iso(s.lastFixAt), lastSeenAt: s.lastSeenAt.toISOString(), stationarySince: iso(s.stationarySince), statusChangedAt: iso(s.statusChangedAt) });

export function parseState(json: string): LiveState {
  const o = JSON.parse(json) as Record<string, unknown>;
  return {
    ...(o as unknown as LiveState),
    lastFixAt: date(o['lastFixAt'] as string | null),
    lastSeenAt: new Date(o['lastSeenAt'] as string),
    stationarySince: date(o['stationarySince'] as string | null),
    statusChangedAt: date(o['statusChangedAt'] as string | null),
  };
}

/** Status of a state "now" — the one shared derivation, applied to a stored state. */
export const statusOf = (s: LiveState, now: Date, t: StatusThresholds): VehicleStatus =>
  deriveStatus({ everReported: true, lastSeenAt: s.lastSeenAt, speedKmh: s.speedKmh, motion: s.motion, ignition: s.ignition, stationarySince: s.stationarySince }, now, t);

export const toDelta = (s: LiveState, status: VehicleStatus): VehicleDeltaDto => ({
  vehicleId: s.vehicleId,
  status,
  latitude: s.latitude,
  longitude: s.longitude,
  speedKmh: s.speedKmh,
  heading: s.heading,
  ignition: s.ignition,
  lastFixAt: iso(s.lastFixAt),
  lastSeenAt: s.lastSeenAt.toISOString(),
  lastFixInvalid: s.lastFixInvalid,
  lastFixDelayed: s.lastFixDelayed,
  simulated: s.simulated,
});

export const toLocationDto = (s: LiveState, registrationNumber: string, status: VehicleStatus): LiveLocationDto => ({
  ...toDelta(s, status),
  registrationNumber,
  deviceId: s.deviceId,
});
