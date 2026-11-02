/**
 * Vehicle status derivation — THE single definition (skill gps-position-pipeline §4). The live map, the dashboard
 * counts, the socket deltas and the alert logic all call `deriveStatus`; nothing else may re-implement it.
 */
export const VEHICLE_STATUSES = ['NO_DATA', 'OFFLINE', 'MOVING', 'IDLING', 'PARKED', 'STATIONARY'] as const;
export type VehicleStatus = (typeof VEHICLE_STATUSES)[number];

export interface StatusThresholds {
  /** No message from the device for longer than this → OFFLINE. */
  offlineAfterSec: number;
  /** Speed at or above this (km/h) → MOVING. */
  movingSpeedKmh: number;
  /** Ignition ON and stationary for at least this long → IDLING (shorter → STATIONARY). */
  idleAfterSec: number;
  /** Ignition UNKNOWN and stationary for at least this long → PARKED (shorter → STATIONARY). */
  parkedAfterSec: number;
}

/** Platform defaults (starting points from the skill). Per-organization overrides arrive later. */
export const DEFAULT_STATUS_THRESHOLDS: StatusThresholds = {
  offlineAfterSec: 600,
  movingSpeedKmh: 5,
  idleAfterSec: 180,
  parkedAfterSec: 300,
};

export interface StatusInput {
  /** The device has reported at least once (a message of any kind). */
  everReported: boolean;
  /** When the platform last heard from the device (any message, even without a usable fix). */
  lastSeenAt: Date | null;
  /** Last usable speed in km/h; null = unknown. */
  speedKmh: number | null;
  /** Engine/device "motion" flag; null = not reported. */
  motion: boolean | null;
  /** Tri-state: null = not reported. */
  ignition: boolean | null;
  /** Since when the vehicle has been below the moving speed (by fix time); null = currently moving or unknown. */
  stationarySince: Date | null;
}

/**
 * Precedence: NO_DATA > OFFLINE > MOVING > IDLING > PARKED / STATIONARY.
 * An alert is an overlay on the marker, never a status of its own.
 */
export function deriveStatus(input: StatusInput, now: Date, t: StatusThresholds = DEFAULT_STATUS_THRESHOLDS): VehicleStatus {
  if (!input.everReported || !input.lastSeenAt) return 'NO_DATA';
  if ((now.getTime() - input.lastSeenAt.getTime()) / 1000 > t.offlineAfterSec) return 'OFFLINE';

  // Moving needs a known speed at/above the threshold, and must not be contradicted by a motion flag of "false".
  if (input.speedKmh !== null && input.speedKmh >= t.movingSpeedKmh && input.motion !== false) return 'MOVING';

  const stationaryFor = input.stationarySince ? Math.max(0, (now.getTime() - input.stationarySince.getTime()) / 1000) : 0;

  if (input.ignition === true) return stationaryFor >= t.idleAfterSec ? 'IDLING' : 'STATIONARY';
  if (input.ignition === false) return 'PARKED';
  // Ignition unknown: only a long stop counts as parked.
  return stationaryFor >= t.parkedAfterSec ? 'PARKED' : 'STATIONARY';
}

/**
 * The next instant at which `deriveStatus` could return something different purely because TIME passed (no new message):
 * the offline deadline (last seen + this vehicle's own threshold) and, for a stopped vehicle, the idle / parked deadline.
 * The offline sweeper keeps vehicles in a sorted set scored by this instant, so one range query returns everything that
 * is due instead of scanning every vehicle. It is allowed to be EARLY (the sweeper just re-derives and re-schedules) but
 * must never be LATE or missing, so it returns the earliest candidate strictly after `now`.
 *
 * `null` = nothing will change by itself (never reported, or already OFFLINE: only a new message changes that).
 */
export function nextStatusDeadline(input: StatusInput, now: Date, t: StatusThresholds = DEFAULT_STATUS_THRESHOLDS): Date | null {
  if (!input.everReported || !input.lastSeenAt) return null;
  // deriveStatus says OFFLINE only when the silence is STRICTLY longer than the threshold, hence the +1 ms.
  const offlineAt = input.lastSeenAt.getTime() + t.offlineAfterSec * 1000 + 1;
  if (now.getTime() >= offlineAt) return null;

  const candidates = [offlineAt];
  const moving = input.speedKmh !== null && input.speedKmh >= t.movingSpeedKmh && input.motion !== false;
  if (!moving && input.stationarySince) {
    const since = input.stationarySince.getTime();
    if (input.ignition === true) candidates.push(since + t.idleAfterSec * 1000);
    else if (input.ignition === null) candidates.push(since + t.parkedAfterSec * 1000);
    // ignition === false is PARKED at once: no time-based change.
  }
  const next = Math.min(...candidates.filter((c) => c > now.getTime()));
  return Number.isFinite(next) ? new Date(next) : null;
}

/** True when this fix means "not moving" (used to maintain `stationarySince`). Unknown speed relies on the motion flag. */
export function isStationaryFix(speedKmh: number | null, motion: boolean | null, t: Pick<StatusThresholds, 'movingSpeedKmh'>): boolean {
  if (speedKmh !== null) return speedKmh < t.movingSpeedKmh || motion === false;
  return motion === false;
}

// ---------------------------------------------------------------- alerts

export const ALERT_TYPES = ['OVERSPEED', 'IGNITION_ON', 'IGNITION_OFF', 'DEVICE_OFFLINE'] as const;
export type AlertType = (typeof ALERT_TYPES)[number];
export const ALERT_SEVERITIES = ['INFO', 'WARNING', 'CRITICAL'] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];
