import { VEHICLE_STATUSES, type LiveLocationDto, type VehicleDeltaDto, type VehicleStatus } from '@gps/shared';

/**
 * Pure logic of the M3a monitor page (no React, no network), so it can be tested exhaustively.
 *
 * Rules (gps-fleet-ui §3–§4): every number comes from the API; unknown stays unknown; clients merge pushed deltas by
 * fix time and never let an older message overwrite a newer one.
 */
export type VehicleRow = LiveLocationDto;
export type RowMap = ReadonlyMap<string, VehicleRow>;

const ms = (iso: string | null) => (iso ? Date.parse(iso) : Number.NEGATIVE_INFINITY);

/**
 * Merges ONE pushed delta into the table. Returns `unknown: true` (and the table unchanged) when the vehicle is not in
 * the table yet — a delta carries no registration number, so the caller must load a snapshot. An older message never
 * overwrites a newer one: not an older fix, and not an older "last seen".
 */
export function applyDelta(rows: RowMap, d: VehicleDeltaDto): { rows: RowMap; unknown: boolean; applied: boolean } {
  const current = rows.get(d.vehicleId);
  if (!current) return { rows, unknown: true, applied: false };
  if (ms(d.lastFixAt) < ms(current.lastFixAt) || ms(d.lastSeenAt) < ms(current.lastSeenAt)) return { rows, unknown: false, applied: false };
  const next = new Map(rows);
  next.set(d.vehicleId, { ...current, ...d, registrationNumber: current.registrationNumber, deviceId: current.deviceId });
  return { rows: next, unknown: false, applied: true };
}

/** Applies a batch of deltas; reports whether any belonged to a vehicle we do not know yet. */
export function applyDeltas(rows: RowMap, deltas: readonly VehicleDeltaDto[]): { rows: RowMap; unknown: boolean; applied: number } {
  let acc = rows;
  let unknown = false;
  let applied = 0;
  for (const d of deltas) {
    const r = applyDelta(acc, d);
    acc = r.rows;
    unknown ||= r.unknown;
    if (r.applied) applied++;
  }
  return { rows: acc, unknown, applied };
}

/** Adopts a REST snapshot, except where a pushed message we already hold is newer than the snapshot's copy. */
export function mergeSnapshot(rows: RowMap, snapshot: readonly VehicleRow[]): RowMap {
  const next = new Map<string, VehicleRow>();
  for (const s of snapshot) {
    const held = rows.get(s.vehicleId);
    next.set(s.vehicleId, held && ms(held.lastSeenAt) > ms(s.lastSeenAt) ? { ...s, ...held, registrationNumber: s.registrationNumber, deviceId: s.deviceId } : s);
  }
  return next;
}

export function countByStatus(rows: RowMap): Record<VehicleStatus, number> {
  const counts = Object.fromEntries(VEHICLE_STATUSES.map((s) => [s, 0])) as Record<VehicleStatus, number>;
  for (const r of rows.values()) counts[r.status]++;
  return counts;
}

export interface RowFilter {
  status: VehicleStatus | null;
  query: string;
}

/** Natural order, so F00002 comes before F00010. */
const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

export function visibleRows(rows: RowMap, filter: RowFilter): VehicleRow[] {
  const q = filter.query.trim().toLowerCase();
  return [...rows.values()]
    .filter((r) => (filter.status === null || r.status === filter.status) && (q === '' || r.registrationNumber.toLowerCase().includes(q)))
    .sort((a, b) => collator.compare(a.registrationNumber, b.registrationNumber));
}

// ---------------------------------------------------------------- presentation

export interface StatusMeta {
  label: string;
  /** What the status means, shown as a tooltip. */
  hint: string;
  /** Tailwind classes (tokens from index.css). Colour is never the only signal: every status also has its own icon and text. */
  className: string;
}

export const STATUS_META: Record<VehicleStatus, StatusMeta> = {
  MOVING: { label: 'Moving', hint: 'Speed at or above the moving threshold', className: 'bg-status-moving-soft text-status-moving' },
  IDLING: { label: 'Idling', hint: 'Ignition on and stopped for longer than the idle threshold', className: 'bg-status-idling-soft text-status-idling' },
  PARKED: { label: 'Parked', hint: 'Ignition off, or stopped for longer than the parked threshold', className: 'bg-status-parked-soft text-status-parked' },
  STATIONARY: { label: 'Stopped', hint: 'Stopped briefly; not yet idling or parked', className: 'bg-status-stationary-soft text-status-stationary' },
  OFFLINE: { label: 'Offline', hint: 'No message from the device for longer than the offline threshold', className: 'bg-status-offline-soft text-status-offline' },
  NO_DATA: { label: 'No data', hint: 'A device is installed but has never reported', className: 'bg-status-offline-soft text-status-offline' },
};

/** Unknown is shown as Unknown — never as Off (gps-fleet-ui §3). */
export const ignitionLabel = (ignition: boolean | null): string => (ignition === null ? 'Unknown' : ignition ? 'On' : 'Off');

export const speedLabel = (speedKmh: number | null): string => (speedKmh === null ? '—' : speedKmh.toFixed(1));

export const coordinatesLabel = (lat: number | null, lon: number | null): string => (lat === null || lon === null ? '—' : `${lat.toFixed(5)}, ${lon.toFixed(5)}`);

/** Seconds since an ISO instant, or null. */
export const secondsSince = (iso: string | null, now: number): number | null => (iso === null ? null : Math.max(0, Math.round((now - Date.parse(iso)) / 1000)));

/** "just now" / "12 s ago" / "3 min ago" / "2 h ago" — compact and always updating (a tooltip carries the absolute time). */
export function agoLabel(iso: string | null, now: number): string {
  const s = secondsSince(iso, now);
  if (s === null) return '—';
  if (s < 3) return 'just now';
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

/** The feed is "receiving" when the vehicle's last message is only seconds old. */
export const isReceiving = (lastSeenAt: string, now: number, withinSec = 6): boolean => (secondsSince(lastSeenAt, now) ?? Infinity) <= withinSec;

export const ALERT_TYPE_LABEL = {
  OVERSPEED: 'Overspeed',
  IGNITION_ON: 'Ignition on',
  IGNITION_OFF: 'Ignition off',
  DEVICE_OFFLINE: 'Device offline',
} as const;

// ---------------------------------------------------------------- event log

export interface LogEntry {
  id: number;
  at: number;
  kind: 'delta' | 'alert' | 'engine' | 'connection';
  text: string;
}

export const LOG_LIMIT = 40;
let logSeq = 0;

/** Newest first, bounded. */
export function pushLog(log: readonly LogEntry[], kind: LogEntry['kind'], text: string, at = Date.now()): LogEntry[] {
  return [{ id: ++logSeq, at, kind, text }, ...log].slice(0, LOG_LIMIT);
}

export const clockLabel = (at: number, timeZone: string): string => new Intl.DateTimeFormat('en-GB', { hour12: false, timeStyle: 'medium', timeZone }).format(new Date(at));
