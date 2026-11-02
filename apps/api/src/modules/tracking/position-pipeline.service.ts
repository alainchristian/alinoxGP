import { Inject, Injectable, Logger } from '@nestjs/common';
import { isStationaryFix } from '@gps/shared';
import { haversineM, impliedSpeedKmh } from '../../common/geo';
import { ENV, type Env } from '../../infrastructure/config/env';
import { TenantPrismaService } from '../../infrastructure/prisma/prisma.service';
import type { EnginePosition } from '../../integrations/gps-engine/port';
import { AlertEvaluatorService } from '../alerts/alert-evaluator.service';
import { activateOnFirstSignal } from '../devices/device-lifecycle';
import { DeviceRoutingService, type DeviceRoute } from '../devices/device-routing.service';
import { toDelta, type LiveState } from '../live-state/live-state';
import { LiveStateStore } from '../live-state/live-state.store';
import { StatusConfigService } from '../live-state/status-config.service';
import { FanoutService } from '../realtime/fanout.service';
import { IngestStatsService, type IngestCounter } from './ingest-stats.service';

/**
 * A fix that may move a vehicle marker. Traccar stores (0,0) and other junk as VALID positions (recorded in
 * test/fixtures/traccar/osmand-behaviour.json), so this check is ours.
 */
export function isUsableFix(p: Pick<EnginePosition, 'valid' | 'latitude' | 'longitude'>): boolean {
  return (
    p.valid &&
    Number.isFinite(p.latitude) &&
    Number.isFinite(p.longitude) &&
    Math.abs(p.latitude) <= 90 &&
    Math.abs(p.longitude) <= 180 &&
    !(p.latitude === 0 && p.longitude === 0)
  );
}

const later = (a: Date | null | undefined, b: Date) => (a && a > b ? a : b);
/** Below this distance an "implausible speed" is just GPS noise over a very short interval. */
const JUMP_MIN_DISTANCE_M = 500;
/** Consecutive consistent far-away fixes after which the new location is accepted as the truth (the old one was the outlier). */
const REBASELINE_AFTER = 3;
const CLOCK_SKEW_TOLERANCE_SEC = 120;
const DEVICE_WRITE_THROTTLE_MS = 30_000;

type Outcome = 'accepted' | 'heartbeat_invalid' | 'ignored_out_of_order' | 'duplicate' | 'implausible_jump';

/**
 * The position pipeline (skill gps-position-pipeline §1–§8). After tenant routing every step carries the organization:
 *   route → simulated guards → classify (invalid / duplicate / out-of-order / jump) → new state → derive status →
 *   Redis state + ring buffer (+ throttled PostgreSQL) → coalesced socket delta → alert evaluation.
 * Anything that is not "a new usable fix" only refreshes liveness, so a vehicle can never be moved by junk and never
 * looks offline while its device is still talking.
 */
@Injectable()
export class PositionPipelineService {
  private readonly logger = new Logger(PositionPipelineService.name);
  /** Injectable clock (unit tests, scenario time compression). */
  clock: () => Date = () => new Date();
  private readonly suspects = new Map<string, { lat: number; lon: number; count: number }>();
  private readonly deviceWrites = new Map<string, number>();
  private readonly firstSignalRecorded = new Set<string>();

  constructor(
    private readonly routing: DeviceRoutingService,
    private readonly tenant: TenantPrismaService,
    private readonly stats: IngestStatsService,
    private readonly store: LiveStateStore,
    private readonly status: StatusConfigService,
    private readonly fanout: FanoutService,
    private readonly alerts: AlertEvaluatorService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private chain: Promise<unknown> = Promise.resolve();

  /**
   * Serialises everything that reads-modifies-writes live state (positions AND the offline sweeper). The state is a
   * read-modify-write on one Redis value per vehicle; without this a sweep could overwrite a position that arrived at
   * the same instant. Lives on the single ingestion leader, so a process-local lock is sufficient.
   */
  runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => undefined);
    return run;
  }

  process(position: EnginePosition, source: 'stream' | 'backfill' = 'stream'): Promise<void> {
    return this.runExclusive(() => this.processUnlocked(position, source));
  }

  private async processUnlocked(position: EnginePosition, source: 'stream' | 'backfill'): Promise<void> {
    const route = await this.routing.resolve(position.engineDeviceId);
    if (!route) {
      await this.stats.incr('dropped_unmapped'); // unknown device: never forwarded anywhere
      return;
    }
    if (!this.simulationAllowed(route, position)) {
      await this.stats.incr('blocked_simulated');
      this.logger.error(`Blocked simulated data for device ${route.deviceId}: not permitted for this organization`);
      return;
    }
    if (source === 'backfill') await this.stats.incr('backfilled');

    // Device liveness bookkeeping is not needed for ordering: keep it off the serialised hot path.
    void this.touchDevice(route, position, isUsableFix(position)).catch((err) => this.logger.warn(`Device liveness write failed: ${String(err)}`));
    if (!route.assignment) {
      await this.stats.incr('unassigned_device'); // alive, but on no vehicle yet (onboarding signal)
      return;
    }
    await this.applyToVehicle(route, route.assignment, position);
  }

  /** Simulated positions are accepted only for simulated devices of sandbox organizations, with the simulator enabled. */
  private simulationAllowed(route: DeviceRoute, position: EnginePosition): boolean {
    if (route.isSimulated) return this.env.SIMULATOR_ENABLED && route.ownerIsSandbox;
    return !position.declaredSimulated; // a real device must not claim to be simulated
  }

  /** Device-level liveness (first signal / last seen), written at most every 30 s, but the FIRST usable fix immediately. */
  private async touchDevice(route: DeviceRoute, p: EnginePosition, usable: boolean) {
    const now = Date.now();
    const needsFirst = usable && !this.firstSignalRecorded.has(route.deviceId);
    if (!needsFirst && now - (this.deviceWrites.get(route.deviceId) ?? 0) < DEVICE_WRITE_THROTTLE_MS) return;
    this.deviceWrites.set(route.deviceId, now);
    await this.tenant.runInOrganization(route.ownerOrganizationId, async (tx) => {
      const d = await tx.gpsDevice.findUnique({ where: { id: route.deviceId }, select: { lastSeenAt: true, firstSignalAt: true } });
      if (!d) return;
      await tx.gpsDevice.update({
        where: { id: route.deviceId },
        data: { lastSeenAt: later(d.lastSeenAt, p.serverTime), firstSignalAt: d.firstSignalAt ?? (usable ? p.serverTime : undefined) },
      });
      // The first usable fix proves the device transmits: a pre-active device becomes ACTIVE (self-heals devices that already had a first signal).
      if (usable) await activateOnFirstSignal(tx, route.deviceId, route.ownerOrganizationId);
    });
    if (usable) this.firstSignalRecorded.add(route.deviceId);
  }

  /** Implied speed between the stored fix and this one; far-away repeated fixes eventually become the new truth. */
  private checkJump(prev: LiveState, p: EnginePosition, fixTime: Date): 'ok' | 'suspect' | 'rebaseline' {
    if (prev.latitude === null || prev.longitude === null || !prev.lastFixAt) return 'ok';
    const dist = haversineM(prev.latitude, prev.longitude, p.latitude, p.longitude);
    const implied = impliedSpeedKmh(dist, fixTime.getTime() - prev.lastFixAt.getTime());
    if (dist < JUMP_MIN_DISTANCE_M || implied <= this.env.PIPELINE_MAX_PLAUSIBLE_SPEED_KMH) {
      this.suspects.delete(prev.vehicleId);
      return 'ok';
    }
    const s = this.suspects.get(prev.vehicleId);
    if (s && haversineM(s.lat, s.lon, p.latitude, p.longitude) < JUMP_MIN_DISTANCE_M) {
      s.count++;
      if (s.count >= REBASELINE_AFTER) {
        this.suspects.delete(prev.vehicleId);
        return 'rebaseline';
      }
    } else {
      this.suspects.set(prev.vehicleId, { lat: p.latitude, lon: p.longitude, count: 1 });
    }
    return 'suspect';
  }

  private async applyToVehicle(route: DeviceRoute, a: { organizationId: string; vehicleId: string }, p: EnginePosition) {
    const now = this.clock();
    const prev = await this.store.get(a.organizationId, a.vehicleId);
    const usable = isUsableFix(p);
    const lastSeenAt = later(prev?.lastSeenAt, p.serverTime);
    const delayed = (p.serverTime.getTime() - p.fixTime.getTime()) / 1000 > this.env.PIPELINE_DELAYED_AFTER_SEC;
    const skewed = (p.fixTime.getTime() - p.serverTime.getTime()) / 1000 > CLOCK_SKEW_TOLERANCE_SEC;
    // A fix claiming to be from the (near) future is clamped to the arrival time for display and ordering.
    const fixTime = skewed ? p.serverTime : p.fixTime;
    if (skewed) await this.stats.incr('clock_skew');

    let outcome: Outcome;
    let rebaselined = false;
    if (!usable) outcome = 'heartbeat_invalid';
    else if (prev?.lastFixAt && fixTime <= prev.lastFixAt) {
      const same = fixTime.getTime() === prev.lastFixAt.getTime() && prev.latitude === p.latitude && prev.longitude === p.longitude;
      outcome = same ? 'duplicate' : 'ignored_out_of_order';
    } else if (prev) {
      const jump = this.checkJump(prev, p, fixTime);
      outcome = jump === 'suspect' ? 'implausible_jump' : 'accepted';
      rebaselined = jump === 'rebaseline';
    } else outcome = 'accepted';

    const base: LiveState = prev ?? {
      vehicleId: a.vehicleId, organizationId: a.organizationId, deviceId: route.deviceId, latitude: null, longitude: null, speedKmh: null,
      heading: null, ignition: null, motion: null, lastFixAt: null, lastSeenAt, lastFixInvalid: false, lastFixDelayed: false,
      stationarySince: null, status: 'NO_DATA', statusChangedAt: null, simulated: route.isSimulated,
    };

    let next: LiveState;
    if (outcome === 'accepted') {
      const stationary = isStationaryFix(p.speedKmh, p.motion, this.status.thresholds);
      next = {
        ...base, deviceId: route.deviceId, simulated: route.isSimulated,
        latitude: p.latitude, longitude: p.longitude, speedKmh: p.speedKmh, heading: p.heading, ignition: p.ignition, motion: p.motion,
        lastFixAt: fixTime, lastSeenAt, lastFixInvalid: false, lastFixDelayed: delayed,
        stationarySince: stationary ? (prev?.stationarySince ?? fixTime) : null,
      };
    } else {
      // Not a new usable fix: refresh liveness only. Coordinates, speed, ignition and stationarity stay as they were.
      next = { ...base, lastSeenAt, lastFixInvalid: outcome === 'heartbeat_invalid' || outcome === 'implausible_jump' ? true : base.lastFixInvalid };
    }

    const derived = this.status.derive(next, now);
    const statusChanged = !prev || prev.status !== derived;
    next = { ...next, status: derived, statusChangedAt: statusChanged ? now : (prev?.statusChangedAt ?? now) };

    await this.store.put(next, statusChanged, now);
    if (outcome === 'accepted') {
      await this.store.pushRecent(a.organizationId, a.vehicleId, {
        fixAt: next.lastFixAt!.toISOString(), lat: p.latitude, lon: p.longitude, speedKmh: p.speedKmh, ignition: p.ignition, motion: p.motion, delayed,
      });
    }

    const flagChanged = (prev?.lastFixInvalid ?? false) !== next.lastFixInvalid;
    if (outcome === 'accepted' || statusChanged || flagChanged) this.fanout.queueDelta(a.organizationId, toDelta(next, next.status));

    const counter: Record<Outcome, IngestCounter> = {
      accepted: 'accepted', heartbeat_invalid: 'heartbeat_invalid', ignored_out_of_order: 'ignored_out_of_order', duplicate: 'duplicate', implausible_jump: 'implausible_jump',
    };
    await this.stats.incr(counter[outcome]);
    if (rebaselined) await this.stats.incr('jump_rebaselined');
    if (outcome === 'accepted' && delayed) await this.stats.incr('delayed_fix');

    if (outcome === 'accepted') await this.alerts.onAcceptedFix(prev, next, fixTime, delayed);
  }
}
