/**
 * Pure rules of the history queries (gps-tenant-isolation §5, gps-position-pipeline §10). Everything that decides WHAT
 * may be asked of the engine lives here so it is unit-tested without a database or an engine.
 */

export interface AssignmentWindow {
  assignedAt: Date;
  /** null = still installed. */
  unassignedAt: Date | null;
}

export interface Range {
  from: Date;
  to: Date;
}

const DAY_MS = 86_400_000;

/**
 * The part of a requested range that may be answered at all: the start is moved forward to `now - historyDays`, the end is
 * never in the future. `null` when nothing of the range is left (entirely older than the history period, or inverted).
 */
export function clipToHistoryPeriod(requested: Range, now: Date, historyDays: number): { range: Range; clipped: boolean } | null {
  const earliest = new Date(now.getTime() - historyDays * DAY_MS);
  const from = requested.from < earliest ? earliest : requested.from;
  const to = requested.to > now ? now : requested.to;
  if (from >= to) return null;
  return { range: { from, to }, clipped: from.getTime() !== requested.from.getTime() };
}

/** Longer than the allowed span? (inclusive: exactly the limit is allowed) */
export const exceedsSpan = (r: Range, maxSpanDays: number) => r.to.getTime() - r.from.getTime() > maxSpanDays * DAY_MS;

/**
 * The periods of `range` during which a tracker was installed on the vehicle. Time before/after an installation is not in
 * any window: a device moved to another vehicle or customer never contributes its later (or earlier) movements.
 * Overlapping rows (which the database forbids, but clock slack could produce) are merged. Sorted, non-empty windows only.
 */
export function coverageWithin(assignments: readonly AssignmentWindow[], range: Range, now: Date): Range[] {
  const clipped = assignments
    .map((a) => ({ from: a.assignedAt > range.from ? a.assignedAt : range.from, to: (a.unassignedAt ?? now) < range.to ? (a.unassignedAt ?? now) : range.to }))
    .filter((w) => w.from < w.to)
    .sort((a, b) => a.from.getTime() - b.from.getTime());
  const merged: Range[] = [];
  for (const w of clipped) {
    const last = merged[merged.length - 1];
    if (last && w.from <= last.to) {
      if (w.to > last.to) last.to = w.to;
    } else merged.push({ from: w.from, to: w.to });
  }
  return merged;
}

/**
 * The query windows PER DEVICE: each assignment of the vehicle intersected with the range. (A vehicle that changed tracker
 * has one entry per tracker, each only for its own installation period.)
 */
export function queryWindows<A extends AssignmentWindow>(assignments: readonly A[], range: Range, now: Date): { assignment: A; range: Range }[] {
  const out: { assignment: A; range: Range }[] = [];
  for (const a of assignments) {
    const w = coverageWithin([a], range, now)[0];
    if (w) out.push({ assignment: a, range: w });
  }
  return out.sort((x, y) => x.range.from.getTime() - y.range.from.getTime());
}

export type TripVerdict = 'ok' | 'tooShort' | 'implausible';

/**
 * Whether an engine trip belongs in the list. The engine's defaults report a phantom trip for parked GPS drift (OQ-033) and one
 * bad coordinate can add thousands of kilometres, so both are hidden — and COUNTED, so the page can say so instead of silently
 * dropping data. Implausibility is checked first: a huge distance in a short time is a bad fix, not a short trip.
 */
export function classifyTrip(t: { distanceM: number; durationMs: number }, minDistanceM: number, maxPlausibleKmh: number): TripVerdict {
  const hours = t.durationMs / 3_600_000;
  if (hours > 0 && t.distanceM / 1000 / hours > maxPlausibleKmh) return 'implausible';
  if (t.durationMs <= 0 && t.distanceM > 0) return 'implausible';
  if (t.distanceM < minDistanceM) return 'tooShort';
  return 'ok';
}

/** A fix that may be drawn: the engine marked it valid, the coordinates are possible and not the 0,0 "no fix" value. */
export function isDrawable(p: { valid: boolean; latitude: number; longitude: number }): boolean {
  return p.valid && Number.isFinite(p.latitude) && Number.isFinite(p.longitude) && Math.abs(p.latitude) <= 90 && Math.abs(p.longitude) <= 180 && !(p.latitude === 0 && p.longitude === 0);
}

/** Thins to at most `max` items, always keeping the first and the last, evenly by index. Returns the input when it already fits. */
export function thin<T>(items: readonly T[], max: number): T[] {
  if (items.length <= max) return [...items];
  if (max < 2) return items.length ? [items[0]!] : [];
  const out: T[] = [];
  const step = (items.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(items[Math.round(i * step)]!);
  return out;
}
