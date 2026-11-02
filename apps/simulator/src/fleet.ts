import { io } from 'socket.io-client';
import type { VehicleDeltaDto } from '@gps/shared';
import { drive, routeLengthM, type SimPoint } from './motion';
import { sendPosition } from './osmand-client';
import { PlatformClient } from './scenario/platform-client';
import { SOCKET_PATH } from './scenario/live-socket';
import { TraccarFeed, type EngineFeedOptions } from './scenario/traccar-feed';
import { KIGALI_STREETS_LOOP } from './routes';

export interface FleetOptions {
  platform: PlatformClient;
  osmandUrl: string;
  count: number;
  intervalSec: number;
  durationSec: number;
  registerConcurrency?: number;
  /** The engine's own REST credentials: enables the position-to-socket measurement (platform share of the latency). */
  engineFeed?: EngineFeedOptions;
  log?: (line: string) => void;
}

export interface Percentiles {
  samples: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

export interface FleetReport {
  devices: number;
  intervalSec: number;
  durationSec: number;
  registrationSeconds: number;
  sent: number;
  httpOk: number;
  httpFailed: Record<string, number>;
  /** Positions per second actually offered to the engine during the run. */
  offeredPerSecond: number;
  /** Deltas the browser-side listener received, and how many distinct vehicles they covered. */
  deltasReceived: number;
  distinctVehiclesSeen: number;
  /** Time from the ENGINE receiving a position (its server time) until the browser-side socket got the delta (ms). */
  engineToBrowserMs: Percentiles;
  /** Time from the engine EMITTING a position on its feed until the browser-side socket got the matching delta (ms) — the platform's own share. null without `engineFeed`. */
  positionToSocketMs: Percentiles | null;
  /** Deltas that could be matched to an engine-emitted position (the rest are status changes without a new fix). */
  matchedDeltas: number;
  /** Unexpected disconnects of the browser-side socket during the run. */
  socketDisconnects: number;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function percentiles(values: number[]): Percentiles {
  const s = [...values].sort((a, b) => a - b);
  const at = (q: number) => (s.length ? Math.round(s[Math.min(s.length - 1, Math.floor(q * s.length))]!) : 0);
  return { samples: s.length, p50: at(0.5), p95: at(0.95), p99: at(0.99), max: s.length ? Math.round(s[s.length - 1]!) : 0 };
}

/**
 * Load/demo generator: registers `count` vehicles with simulated devices in the SANDBOX organization the platform client
 * is scoped to, then every device reports once per `intervalSec` (offsets spread evenly, like a real fleet) for
 * `durationSec`, while a socket listener measures what a customer's browser would receive.
 */
export async function runFleet(opts: FleetOptions): Promise<FleetReport> {
  const log = opts.log ?? (() => undefined);
  const run = Math.random().toString(36).slice(2, 6).toUpperCase();
  const registerAt = Date.now();
  const devices: { id: string; vehicleId: string; points: Generator<SimPoint>; nextDue: number }[] = [];

  // ---- 1. register through the public API (bounded parallelism)
  const concurrency = opts.registerConcurrency ?? 24;
  let next = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      for (;;) {
        const i = next++;
        if (i >= opts.count) return;
        const id = `SIM-F${run}-${String(i).padStart(5, '0')}`;
        const vehicleId = await opts.platform.createVehicle(`F${run}${String(i).padStart(5, '0')}`);
        const deviceId = await opts.platform.registerDevice(id);
        await opts.platform.assign(deviceId, vehicleId);
        devices.push({ id, vehicleId, points: drive({ route: KIGALI_STREETS_LOOP, speedKmh: 35 + (i % 30), intervalSec: opts.intervalSec, seed: i + 1, startTime: Date.now(), startOffsetM: (i / opts.count) * routeLengthM(KIGALI_STREETS_LOOP) }), nextDue: 0 });
        if (devices.length % 250 === 0) log(`  registered ${devices.length}/${opts.count}`);
      }
    }),
  );
  const registrationSeconds = (Date.now() - registerAt) / 1000;
  log(`Registered ${devices.length} devices in ${registrationSeconds.toFixed(1)} s`);

  // ---- 2. a browser-side listener (and, optionally, an observer on the engine's own feed)
  const feed = opts.engineFeed ? new TraccarFeed(opts.engineFeed) : null;
  const engineOfVehicle = new Map<string, number>();
  if (feed) {
    await feed.open();
    const ids = await feed.engineIds(devices.map((d) => d.id));
    for (const d of devices) if (ids.has(d.id)) engineOfVehicle.set(d.vehicleId, ids.get(d.id)!);
  }
  const platformLatencies: number[] = [];
  let socketDisconnects = 0;
  const latencies: number[] = [];
  const seen = new Set<string>();
  let deltasReceived = 0;
  const socket = io(opts.platform.baseUrl, { path: SOCKET_PATH, transports: ['websocket'], auth: { token: opts.platform.token, organizationId: opts.platform.organizationId }, reconnection: false });
  await new Promise<void>((resolve, reject) => {
    socket.on('connect', () => resolve());
    socket.on('connect_error', (e) => reject(new Error(`socket refused: ${e.message}`)));
  });
  let measuring = false;
  socket.on('disconnect', (reason) => {
    if (reason !== 'io client disconnect') socketDisconnects++;
  });
  const ownVehicles = new Set(devices.map((d) => d.vehicleId));
  socket.on('vehicle:delta', (m: { vehicles: VehicleDeltaDto[] }) => {
    const now = Date.now();
    for (const d of m.vehicles) {
      // Only this run's vehicles: leftovers from earlier runs (e.g. the sweeper turning them OFFLINE) are not load we offered.
      if (!ownVehicles.has(d.vehicleId)) continue;
      deltasReceived++;
      seen.add(d.vehicleId);
      if (measuring && feed && d.lastFixAt) {
        const engineId = engineOfVehicle.get(d.vehicleId);
        const emittedAt = engineId === undefined ? undefined : feed.seenAt.get(TraccarFeed.key(engineId, Date.parse(d.lastFixAt)));
        if (emittedAt !== undefined) platformLatencies.push(Math.max(0, now - emittedAt));
      }
      if (measuring) latencies.push(now - Date.parse(d.lastSeenAt)); // lastSeenAt = engine receipt time (ms)
    }
  });

  // ---- 3. offer load
  const intervalMs = opts.intervalSec * 1000;
  const start = Date.now();
  devices.forEach((d, i) => (d.nextDue = start + (i / devices.length) * intervalMs));
  let sent = 0;
  let httpOk = 0;
  const httpFailed: Record<string, number> = {};
  const inflight = new Set<Promise<void>>();
  const endAt = start + opts.durationSec * 1000;
  const warmupUntil = start + Math.min(opts.durationSec * 0.25, intervalMs * 2 + 6000); // exclude start-up effects from latency
  log(`Offering ${devices.length} positions every ${opts.intervalSec} s (~${(devices.length / opts.intervalSec).toFixed(0)}/s) for ${opts.durationSec} s`);

  while (Date.now() < endAt) {
    const now = Date.now();
    if (!measuring && now >= warmupUntil) measuring = true;
    for (const d of devices) {
      if (d.nextDue > now) continue;
      d.nextDue += intervalMs;
      const p = d.points.next().value!;
      sent++;
      const job = sendPosition(opts.osmandUrl, { id: d.id, latitude: p.latitude, longitude: p.longitude, speedKmh: p.speedKmh, heading: p.heading, ignition: true, batteryPercent: 90, time: Date.now() })
        .then((r) => {
          if (r.httpStatus === 200) httpOk++;
          else httpFailed[String(r.httpStatus)] = (httpFailed[String(r.httpStatus)] ?? 0) + 1;
        })
        .finally(() => inflight.delete(job));
      inflight.add(job);
    }
    await sleep(40);
  }
  await Promise.all(inflight);
  const offeredSeconds = (Date.now() - start) / 1000;
  await sleep(8000); // let in-flight positions reach the browser
  socket.disconnect();
  feed?.close();

  return {
    devices: devices.length,
    intervalSec: opts.intervalSec,
    durationSec: opts.durationSec,
    registrationSeconds: Math.round(registrationSeconds * 10) / 10,
    sent,
    httpOk,
    httpFailed,
    offeredPerSecond: Math.round((sent / offeredSeconds) * 10) / 10,
    deltasReceived,
    distinctVehiclesSeen: seen.size,
    engineToBrowserMs: percentiles(latencies),
    positionToSocketMs: feed ? percentiles(platformLatencies) : null,
    matchedDeltas: platformLatencies.length,
    socketDisconnects,
  };
}
