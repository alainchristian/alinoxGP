import type { VehicleDeltaDto, VehicleStatus } from '@gps/shared';
import { haversineM } from '../motion';
import type { Fix, ScenarioContext } from '../scenario/types';

/** Real-time pacing between messages. Traccar adds ~3 s of buffering on top, so scenarios wait for outcomes, not for sends. */
export const STEP_MS = 1500;

/** Sends fixes one after another, each stamped with the real time of sending (a device reporting live). */
export async function sendLive(ctx: ScenarioContext, fixes: Fix[], gapMs = STEP_MS): Promise<number[]> {
  const times: number[] = [];
  for (const f of fixes) {
    const time = f.time ?? Date.now();
    times.push(time);
    await ctx.send({ ...f, time });
    await ctx.sleep(gapMs);
  }
  return times;
}

/** Distinct consecutive statuses the socket reported for this vehicle, e.g. ['MOVING','STATIONARY','IDLING']. */
export function statusSequence(ctx: ScenarioContext): VehicleStatus[] {
  const out: VehicleStatus[] = [];
  for (const d of ctx.socket.deltas) if (d.vehicleId === ctx.vehicleId && out[out.length - 1] !== d.status) out.push(d.status);
  return out;
}

/** True if `needle` appears in `haystack` in this order (not necessarily adjacent). */
export function isSubsequence<T>(needle: T[], haystack: T[]): boolean {
  let i = 0;
  for (const h of haystack) if (h === needle[i]) i++;
  return i === needle.length;
}

export const ownDeltas = (ctx: ScenarioContext): VehicleDeltaDto[] => ctx.socket.deltas.filter((d) => d.vehicleId === ctx.vehicleId);

export const metresBetween = (a: { latitude: number | null; longitude: number | null }, b: { latitude: number | null; longitude: number | null }) =>
  haversineM([a.longitude!, a.latitude!], [b.longitude!, b.latitude!]);

/** Small deterministic generator for noise in scenarios (seeded, so every run is identical). */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
