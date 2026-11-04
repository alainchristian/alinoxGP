import { Inject, Injectable, Logger } from '@nestjs/common';
import type { HistoryWindowDto, RouteDto, RoutePointDto, StopDto, TripDto, TripListDto } from '@gps/shared';
import { AppException, notFound } from '../../common/errors';
import { ENV, type Env } from '../../infrastructure/config/env';
import { TenantPrismaService } from '../../infrastructure/prisma/prisma.service';
import { GPS_ENGINE, GpsEngineError, type EngineDeviceRef, type GpsEnginePort } from '../../integrations/gps-engine/port';
import { classifyTrip, clipToHistoryPeriod, coverageWithin, exceedsSpan, isDrawable, queryWindows, thin, type Range } from './history-windows';

const iso = (d: Date) => d.toISOString();

/**
 * Trip history and route playback (spec Modules 9). History stays in the tracking engine (ADR-0004); this service decides
 * WHAT may be asked of it: the range is clipped to the history period and to the periods a tracker was installed on THIS
 * vehicle, so a tracker that was moved never reveals the other tenant's movements (gps-tenant-isolation §5). The vehicle
 * is looked up through RLS: another organization's vehicle is a 404.
 */
@Injectable()
export class HistoryService {
  private readonly logger = new Logger(HistoryService.name);

  constructor(
    private readonly tenant: TenantPrismaService,
    @Inject(GPS_ENGINE) private readonly engine: GpsEnginePort,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private async plan(vehicleId: string, from: Date, to: Date, maxSpanDays: number, now: Date) {
    const requested: Range = { from, to };
    if (exceedsSpan(requested, maxSpanDays)) {
      throw new AppException('HISTORY_RANGE_TOO_LARGE', 422, `Ask for at most ${maxSpanDays} days at a time`, undefined, [{ path: 'to', message: `The range may cover at most ${maxSpanDays} days` }]);
    }
    const vehicle = await this.tenant.run((tx) =>
      tx.vehicle.findFirst({
        where: { id: vehicleId, deletedAt: null },
        select: { id: true, assignments: { select: { assignedAt: true, unassignedAt: true, device: { select: { uniqueId: true, traccarDeviceId: true, isSimulated: true } } } } },
      }),
    );
    if (!vehicle) throw notFound('VEHICLE_NOT_FOUND'); // also the answer for another organization's vehicle

    const historyDays = this.env.HISTORY_DAYS_DEFAULT;
    const clip = clipToHistoryPeriod(requested, now, historyDays);
    const windows = clip ? queryWindows(vehicle.assignments, clip.range, now) : [];
    const coverage = clip ? coverageWithin(vehicle.assignments, clip.range, now) : [];
    const window: HistoryWindowDto = {
      requestedFrom: iso(from),
      requestedTo: iso(to),
      from: iso(clip?.range.from ?? from),
      to: iso(clip?.range.to ?? to),
      clippedToHistoryPeriod: clip?.clipped ?? true,
      historyDays,
      coverage: coverage.map((c) => ({ from: iso(c.from), to: iso(c.to) })),
      maxSpanDays,
    };
    return { window, windows, simulated: vehicle.assignments.some((a) => a.device.isSimulated) };
  }

  private refOf(a: { device: { uniqueId: string; traccarDeviceId: number | null } }): EngineDeviceRef | null {
    return a.device.traccarDeviceId == null ? null : { engineId: a.device.traccarDeviceId, uniqueId: a.device.uniqueId };
  }

  /** Engine failures are reported as "unknown" (flag), never as an empty history. */
  private async safely<T>(what: string, run: () => Promise<T>): Promise<T | null> {
    try {
      return await run();
    } catch (err) {
      if (err instanceof GpsEngineError) {
        this.logger.warn(`${what}: engine ${err.code}`);
        return null;
      }
      throw err;
    }
  }

  async trips(vehicleId: string, from: Date, to: Date, now = new Date()): Promise<TripListDto> {
    const { window, windows, simulated } = await this.plan(vehicleId, from, to, this.env.HISTORY_MAX_SPAN_TRIPS_DAYS, now);
    const trips: TripDto[] = [];
    const stops: StopDto[] = [];
    let engineUnavailable = false;
    const hidden = { tooShort: 0, implausible: 0 };
    for (const w of windows) {
      const ref = this.refOf(w.assignment);
      if (!ref) continue;
      const [t, s] = await Promise.all([
        this.safely('trips', () => this.engine.getTrips(ref, w.range.from, w.range.to)),
        this.safely('stops', () => this.engine.getStops(ref, w.range.from, w.range.to)),
      ]);
      if (t === null || s === null) engineUnavailable = true;
      // The engine may return a trip that STARTS inside the window but ends after the installation ended: keep only what lies inside.
      for (const x of t ?? []) {
        if (x.startTime < w.range.from || x.startTime >= w.range.to) continue;
        const verdict = classifyTrip(x, this.env.HISTORY_MIN_TRIP_DISTANCE_M, this.env.HISTORY_MAX_PLAUSIBLE_SPEED_KMH);
        if (verdict !== 'ok') {
          hidden[verdict]++;
          continue;
        }
        trips.push({
          startTime: iso(x.startTime),
          endTime: iso(x.endTime),
          durationSec: Math.round(x.durationMs / 1000),
          distanceKm: Math.round(x.distanceM / 10) / 100,
          maxSpeedKmh: x.maxSpeedKmh,
          averageSpeedKmh: x.averageSpeedKmh,
          start: x.startLatitude != null && x.startLongitude != null ? { latitude: x.startLatitude, longitude: x.startLongitude, address: x.startAddress } : null,
          end: x.endLatitude != null && x.endLongitude != null ? { latitude: x.endLatitude, longitude: x.endLongitude, address: x.endAddress } : null,
        });
      }
      for (const x of s ?? []) {
        if (x.startTime < w.range.from || x.startTime >= w.range.to) continue;
        stops.push({ startTime: iso(x.startTime), endTime: iso(x.endTime), durationSec: Math.round(x.durationMs / 1000), place: x.latitude != null && x.longitude != null ? { latitude: x.latitude, longitude: x.longitude, address: x.address } : null });
      }
    }
    trips.sort((a, b) => a.startTime.localeCompare(b.startTime));
    stops.sort((a, b) => a.startTime.localeCompare(b.startTime));
    return { vehicleId, window, trips, stops, hiddenTrips: hidden, simulated, engineUnavailable };
  }

  async route(vehicleId: string, from: Date, to: Date, now = new Date()): Promise<RouteDto> {
    const { window, windows, simulated } = await this.plan(vehicleId, from, to, this.env.HISTORY_MAX_SPAN_ROUTE_DAYS, now);
    const all: { point: RoutePointDto; window: number }[] = [];
    let skippedInvalid = 0;
    let engineUnavailable = false;
    for (const [i, w] of windows.entries()) {
      const ref = this.refOf(w.assignment);
      if (!ref) continue;
      const route = await this.safely('route', () => this.engine.getRoute(ref, w.range.from, w.range.to));
      if (route === null) {
        engineUnavailable = true;
        continue;
      }
      for (const p of route.slice().sort((a, b) => a.fixTime.getTime() - b.fixTime.getTime())) {
        if (p.fixTime < w.range.from || p.fixTime > w.range.to) continue;
        if (!isDrawable(p)) {
          skippedInvalid++;
          continue;
        }
        all.push({ window: i, point: { t: iso(p.fixTime), latitude: p.latitude, longitude: p.longitude, speedKmh: p.speedKmh, heading: p.heading, ignition: p.ignition } });
      }
    }
    const kept = thin(all, this.env.HISTORY_MAX_ROUTE_POINTS);
    const breaks: number[] = [];
    kept.forEach((k, i) => {
      if (i > 0 && k.window !== kept[i - 1]!.window) breaks.push(i - 1);
    });
    return { vehicleId, window, points: kept.map((k) => k.point), totalPoints: all.length, skippedInvalid, thinned: kept.length < all.length, breaks, simulated, engineUnavailable };
  }
}

