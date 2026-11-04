import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Pause, Play, Square } from 'lucide-react';
import { P, type MapConfigDto, type RouteDto, type TripDto, type TripListDto, type VehicleDto } from '@gps/shared';
import { Alert, Badge, Button, Card, EmptyState, Input, PageHeader, Select, Skeleton } from '@/components/ui/primitives';
import { QueryError } from '@/features/fleet/fleet-ui';
import { ApiError, api, apiPaged } from '@/lib/api';
import { hasPermission, useAuthStore } from '@/lib/auth-store';
import { errorMessage } from '@/lib/i18n';
import { activeOrganization } from '@/lib/session';
import { cn, formatDateTime } from '@/lib/utils';
import { PLAYBACK_SPEEDS, advance, dayRange, formatDuration, stateAt, toPlayPoints, todayIn, type PlaybackSpeed } from './playback-model';
import { RouteMap } from './RouteMap';

/** The longest period one request may cover (the API enforces its own limit; this keeps the page from asking more). */
const MAX_DAYS = 7;
const time = (iso: string, tz: string) => new Date(iso).toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit' });
const dayAgo = (ymd: string, days: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);

/**
 * Trips & playback (spec Module 9). Everything shown comes from the tracking engine through the API; time with no tracker
 * installed is said to be unknown, never "parked". Playback runs on the route of ONE trip, at 1× (real time) to 16×.
 */
export function TripsPage() {
  const me = useAuthStore((s) => s.me);
  const orgId = me?.activeOrganizationId ?? '';
  const tz = activeOrganization(me)?.timezone ?? 'Africa/Kigali';
  const canRoute = hasPermission(me, P.TRACKING_HISTORY_VIEW);
  const today = todayIn(tz);

  const [vehicleId, setVehicleId] = useState('');
  const [fromDay, setFromDay] = useState(dayAgo(today, 1));
  const [toDay, setToDay] = useState(today);
  const [selected, setSelected] = useState<number | null>(null);

  const vehicles = useQuery({ queryKey: ['org', orgId, 'vehicles', 'history-select'], queryFn: () => apiPaged<VehicleDto>('/vehicles?pageSize=100'), enabled: !!orgId });
  const range = useMemo(() => dayRange(fromDay, toDay, tz, MAX_DAYS), [fromDay, toDay, tz]);

  const trips = useQuery({
    queryKey: ['org', orgId, 'history', 'trips', vehicleId, range.ok ? range.from : '', range.ok ? range.to : ''],
    enabled: !!vehicleId && range.ok,
    queryFn: () => api<TripListDto>(`/vehicles/${vehicleId}/trips?from=${encodeURIComponent((range as { from: string }).from)}&to=${encodeURIComponent((range as { to: string }).to)}`),
  });
  const trip: TripDto | null = selected !== null ? (trips.data?.trips[selected] ?? null) : null;

  const route = useQuery({
    queryKey: ['org', orgId, 'history', 'route', vehicleId, trip?.startTime, trip?.endTime],
    enabled: !!vehicleId && !!trip && canRoute,
    queryFn: () => api<RouteDto>(`/vehicles/${vehicleId}/route?from=${encodeURIComponent(trip!.startTime)}&to=${encodeURIComponent(trip!.endTime)}`),
  });
  const mapConfig = useQuery({ queryKey: ['maps', 'config', orgId], queryFn: () => api<MapConfigDto>('/maps/config'), enabled: !!orgId, staleTime: Infinity });

  const points = useMemo(() => toPlayPoints(route.data?.points ?? []), [route.data]);
  const start = points[0]?.t ?? 0;
  const end = points[points.length - 1]?.t ?? 0;

  // ---- playback clock
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<PlaybackSpeed>(8);
  const [clock, setClock] = useState(0);
  const clockRef = useRef(0);
  useEffect(() => {
    clockRef.current = start;
    setClock(start);
    setPlaying(false);
  }, [start, end, vehicleId]);
  useEffect(() => {
    if (!playing || points.length < 2) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const next = advance(clockRef.current, now - last, speed, end);
      last = now;
      clockRef.current = next.t;
      setClock(next.t);
      if (next.finished) setPlaying(false);
      else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, speed, end, points.length]);
  const state = stateAt(points, clock);
  const progress = end > start ? ((clock - start) / (end - start)) * 100 : 0;

  const err = (q: { error: unknown }) => (q.error instanceof ApiError ? errorMessage(q.error.code) : errorMessage(undefined));
  const w = trips.data?.window;

  return (
    <>
      <PageHeader title="Trips & playback" description="Look back at a vehicle’s journeys and replay them on the map." />
      <Card className="mb-5">
        <div className="flex flex-wrap items-end gap-4 p-5">
          <label className="block text-[12px] font-semibold text-text-muted">Vehicle
            <Select aria-label="Vehicle" className="mt-1 w-56" value={vehicleId} onChange={(e) => { setVehicleId(e.target.value); setSelected(null); }}>
              <option value="">Choose a vehicle</option>
              {vehicles.data?.data.map((v) => <option key={v.id} value={v.id}>{v.registrationNumber}</option>)}
            </Select>
          </label>
          <label className="block text-[12px] font-semibold text-text-muted">From
            <Input aria-label="From day" type="date" className="mt-1 w-40" max={today} value={fromDay} onChange={(e) => { setFromDay(e.target.value); setSelected(null); }} />
          </label>
          <label className="block text-[12px] font-semibold text-text-muted">To
            <Input aria-label="To day" type="date" className="mt-1 w-40" max={today} value={toDay} onChange={(e) => { setToDay(e.target.value); setSelected(null); }} />
          </label>
          <p className="pb-2 text-xs text-text-muted">Up to {MAX_DAYS} days at a time. Times are in {tz}.</p>
        </div>
        {!range.ok && <div className="px-5 pb-5"><Alert tone="warn">{range.error}</Alert></div>}
      </Card>

      {!vehicleId ? (
        <Card><EmptyState title="Choose a vehicle" description="Pick a vehicle and a period to see its journeys." /></Card>
      ) : trips.isPending && range.ok ? (
        <Skeleton className="h-64" />
      ) : trips.isError ? (
        <Card><QueryError query={trips} what="the journeys" /></Card>
      ) : trips.data ? (
        <div className="space-y-4">
          {trips.data.engineUnavailable && <Alert tone="warn">The tracking engine could not be reached, so the journeys below are unknown, not empty. Try again in a moment.</Alert>}
          {(trips.data.hiddenTrips.tooShort > 0 || trips.data.hiddenTrips.implausible > 0) && (
            <p className="text-xs text-text-muted">
              Not listed: {trips.data.hiddenTrips.tooShort > 0 ? `${trips.data.hiddenTrips.tooShort} very short movement${trips.data.hiddenTrips.tooShort === 1 ? '' : 's'} (GPS drift while parked)` : ''}{trips.data.hiddenTrips.tooShort > 0 && trips.data.hiddenTrips.implausible > 0 ? ' and ' : ''}{trips.data.hiddenTrips.implausible > 0 ? `${trips.data.hiddenTrips.implausible} with impossible distances (bad GPS fixes)` : ''}.
            </p>
          )}
          {w?.clippedToHistoryPeriod && <Alert tone="neutral">History is kept for {w.historyDays} days. Showing from {formatDateTime(w.from, tz)}.</Alert>}
          {w && w.coverage.length === 0 && !trips.data.engineUnavailable && <Alert tone="neutral">No tracker was installed on this vehicle during this period, so there is nothing to show. That does not mean the vehicle was parked.</Alert>}
          {w && w.coverage.length > 0 && (w.coverage.length > 1 || w.coverage[0]!.from !== w.from || w.coverage[0]!.to !== w.to) && (
            <Alert tone="neutral">A tracker was installed during part of this period only; the rest is unknown: {w.coverage.map((c) => `${formatDateTime(c.from, tz)} – ${formatDateTime(c.to, tz)}`).join('; ')}.</Alert>
          )}
          <div className="grid gap-5 lg:grid-cols-[22rem_1fr]">
            <Card className="h-fit overflow-hidden">
              <div className="flex items-center justify-between border-b border-border/70 px-5 py-4">
                <h2 className="text-[15px] font-bold text-text">Journeys</h2>
                <span className="text-xs text-text-muted">{trips.data.trips.length} found {trips.data.simulated && <Badge tone="warn">Simulated</Badge>}</span>
              </div>
              {trips.data.trips.length === 0 ? (
                <p className="p-5 text-[13px] text-text-muted">{w && w.coverage.length > 0 ? 'No journey was detected in this period.' : '—'}</p>
              ) : (
                <ul className="max-h-[28rem] divide-y divide-border/60 overflow-y-auto">
                  {trips.data.trips.map((t, i) => (
                    <li key={t.startTime}>
                      <button type="button" onClick={() => setSelected(i)} aria-pressed={selected === i} className={cn('block w-full px-5 py-3 text-left text-[13px] hover:bg-surface-2', selected === i && 'bg-brand-soft')}>
                        <span className="flex items-center justify-between font-semibold text-text"><span>{formatDateTime(t.startTime, tz).slice(0, 10)} · {time(t.startTime, tz)}–{time(t.endTime, tz)}</span><span className="tabular text-text-muted">{t.distanceKm} km</span></span>
                        <span className="mt-0.5 block text-xs text-text-muted">{formatDuration(t.durationSec)} · max {t.maxSpeedKmh === null ? '—' : `${Math.round(t.maxSpeedKmh)} km/h`}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {trips.data.stops.length > 0 && (
                <div className="border-t border-border/70 px-5 py-4">
                  <h3 className="text-[13px] font-bold text-text">Stops</h3>
                  <ul className="mt-2 space-y-1.5 text-xs text-text-muted">
                    {trips.data.stops.map((s) => <li key={s.startTime}>{formatDateTime(s.startTime, tz).slice(0, 10)} {time(s.startTime, tz)}–{time(s.endTime, tz)} · {formatDuration(s.durationSec)}{s.place?.address ? ` · ${s.place.address}` : ''}</li>)}
                  </ul>
                </div>
              )}
            </Card>

            <Card className="overflow-hidden">
              {trip === null ? (
                <EmptyState title={trips.data.trips.length ? 'Choose a journey' : 'Nothing to replay'} description={trips.data.trips.length ? 'Select a journey on the left to see it on the map.' : 'Journeys appear here when the vehicle has been driven.'} />
              ) : !canRoute ? (
                <div className="p-6"><Alert tone="neutral">Your role can see the list of journeys but not replay them on the map.</Alert></div>
              ) : route.isPending ? (
                <Skeleton className="h-96" />
              ) : route.isError ? (
                <div className="p-6"><Alert>{err(route)}</Alert></div>
              ) : (
                <>
                  <div className="h-[26rem]">
                    {mapConfig.data ? <RouteMap config={mapConfig.data} points={points} breaks={route.data.breaks} current={state} currentTime={clock} /> : <Skeleton className="h-full" />}
                  </div>
                  <div className="space-y-3 border-t border-border/70 p-5">
                    {route.data.engineUnavailable && <Alert tone="warn">The tracking engine could not be reached; the route is unknown.</Alert>}
                    {route.data.points.length < 2 && !route.data.engineUnavailable && <Alert tone="neutral">This journey has too few usable GPS fixes to replay.</Alert>}
                    {route.data.thinned && <p className="text-xs text-text-muted">Long route: showing {route.data.points.length} of {route.data.totalPoints} fixes.</p>}
                    {route.data.skippedInvalid > 0 && <p className="text-xs text-text-muted">{route.data.skippedInvalid} fixes without a valid GPS position were left out.</p>}
                    <div className="flex flex-wrap items-center gap-3">
                      <Button size="sm" onClick={() => { if (clockRef.current >= end) { clockRef.current = start; setClock(start); } setPlaying((p) => !p); }} disabled={points.length < 2} aria-label={playing ? 'Pause' : 'Play'}>
                        {playing ? <Pause className="size-4" aria-hidden /> : <Play className="size-4" aria-hidden />}{playing ? 'Pause' : 'Play'}
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => { setPlaying(false); clockRef.current = start; setClock(start); }} disabled={points.length < 2} aria-label="Stop"><Square className="size-4" aria-hidden />Stop</Button>
                      <div role="group" aria-label="Playback speed" className="flex gap-1">
                        {PLAYBACK_SPEEDS.map((s) => <button key={s} type="button" aria-pressed={speed === s} onClick={() => setSpeed(s)} className={cn('h-8 rounded-lg border px-2.5 text-xs font-semibold', speed === s ? 'border-brand bg-brand-soft text-brand' : 'border-border text-text-muted hover:bg-surface-2')}>{s}×</button>)}
                      </div>
                      <span className="tabular ml-auto text-[13px] text-text-muted">{points.length > 1 ? new Date(clock).toLocaleTimeString('en-GB', { timeZone: tz }) : '—'}</span>
                    </div>
                    <input type="range" aria-label="Timeline" className="w-full accent-[var(--color-brand)]" min={start} max={Math.max(end, start + 1)} step={1000} value={clock} disabled={points.length < 2} onChange={(e) => { setPlaying(false); clockRef.current = Number(e.target.value); setClock(Number(e.target.value)); }} />
                    <p className="sr-only" aria-live="polite">{progress.toFixed(0)} percent</p>
                    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-[13px] sm:grid-cols-4">
                      <div><dt className="text-text-muted">Distance</dt><dd className="tabular font-semibold">{trip.distanceKm} km</dd></div>
                      <div><dt className="text-text-muted">Duration</dt><dd className="tabular font-semibold">{formatDuration(trip.durationSec)}</dd></div>
                      <div><dt className="text-text-muted">Max / average speed</dt><dd className="tabular font-semibold">{trip.maxSpeedKmh === null ? '—' : Math.round(trip.maxSpeedKmh)} / {trip.averageSpeedKmh === null ? '—' : Math.round(trip.averageSpeedKmh)} km/h</dd></div>
                      <div><dt className="text-text-muted">Speed now</dt><dd className="tabular font-semibold">{state?.speedKmh == null ? 'Unknown' : `${Math.round(state.speedKmh)} km/h`}</dd></div>
                    </dl>
                  </div>
                </>
              )}
            </Card>
          </div>
        </div>
      ) : null}
    </>
  );
}
