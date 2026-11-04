import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Crosshair, LocateFixed, Menu, Search, X } from 'lucide-react';
import { P, VEHICLE_STATUSES, type AlertDto, type MapConfigDto, type VehicleStatus } from '@gps/shared';
import { Alert, Badge, Button, EmptyState, Input, Skeleton } from '@/components/ui/primitives';
import { api, apiPaged } from '@/lib/api';
import { hasPermission, useAuthStore } from '@/lib/auth-store';
import { cn } from '@/lib/utils';
import { ALERT_TYPE_LABEL, STATUS_META, agoLabel, ignitionLabel, speedLabel, visibleRows, type VehicleRow } from '../monitor/monitor-model';
import { StatusBadge, STATUS_ICON } from '../monitor/status-badge';
import { LiveMap } from './LiveMap';
import { boundsOf, canDrawProvider, extendTrail, hasPosition, headingLabel, toFeature, toFeatureCollection, vehiclesWithRecentAlert, type TrailPoint } from './live-model';
import { useLiveFleet } from './useLiveFleet';
import { useNow } from './use-now';

const NO_TRAIL: readonly TrailPoint[] = [];
const CONNECTION_COPY = {
  connecting: { label: 'Connecting…', className: 'bg-[#EDF2F7] text-[#718096]' },
  live: { label: 'Live', className: 'bg-[#E6F7F0] text-[#16A36A]' },
  reconnecting: { label: 'Reconnecting…', className: 'bg-[#FEF6E6] text-[#B7791F]' },
  refused: { label: 'Disconnected', className: 'bg-[#FDEEEE] text-[#DC5555]' },
} as const;

const STATUS_DOT: Record<VehicleStatus, string> = {
  MOVING: 'bg-[#16A36A]',
  IDLING: 'bg-[#D69B32]',
  PARKED: 'bg-[#D69B32]',
  STATIONARY: 'bg-[#718096]',
  OFFLINE: 'bg-[#DC5555]',
  NO_DATA: 'bg-[#94A3B8]',
};

const STATUS_TEXT: Record<VehicleStatus, string> = {
  MOVING: 'text-[#16A36A]',
  IDLING: 'text-[#B7791F]',
  PARKED: 'text-[#B7791F]',
  STATIONARY: 'text-[#718096]',
  OFFLINE: 'text-[#DC5555]',
  NO_DATA: 'text-[#718096]',
};

function absolute(iso: string | null, timeZone: string): string {
  return iso ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'short', timeStyle: 'medium', hour12: false, timeZone }).format(new Date(iso)) : 'No value';
}

/**
 * Live tracking (M4): matches design_references/02_live_tracking.png with a top header bar,
 * a rounded Vehicles card on the left, a rounded Live vehicle map card in the centre, and a selected vehicle panel on the right.
 */
export function LivePage() {
  const orgId = useAuthStore((s) => s.me?.activeOrganizationId ?? null);
  return <LiveView key={orgId ?? 'none'} />;
}

function LiveView() {
  const now = useNow(1000);
  const slowNow = useNow(5000);
  const root = useRef<HTMLDivElement>(null);

  // Trails of every vehicle since this page opened (bounded): the selected vehicle's is drawn on the map.
  const trails = useRef(new Map<string, readonly TrailPoint[]>());
  const fleet = useLiveFleet({
    snapshot: true,
    onApplied: (deltas) => {
      for (const d of deltas) trails.current.set(d.vehicleId, extendTrail(trails.current.get(d.vehicleId), d.latitude, d.longitude));
    },
  });
  const { me, orgId, timeZone, rows, total, truncated, positions, summary, feed } = fleet;
  const canAlerts = hasPermission(me, P.ALERTS_READ);

  const mapConfig = useQuery({ queryKey: ['maps', 'config', orgId], queryFn: () => api<MapConfigDto>('/maps/config'), enabled: !!orgId, staleTime: Infinity });
  const alerts = useQuery({
    queryKey: ['alerts', 'live', orgId],
    queryFn: () => apiPaged<AlertDto>('/alerts?page=1&pageSize=50'),
    enabled: !!orgId && canAlerts,
    refetchInterval: 30_000,
  });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [follow, setFollow] = useState(false);
  const [fitRequest, setFitRequest] = useState(0);
  const [listOpen, setListOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<VehicleStatus | null>(null);
  const [query, setQuery] = useState('');

  const alertIds = useMemo(() => vehiclesWithRecentAlert(alerts.data?.data ?? [], slowNow), [alerts.data, slowNow]);
  const features = useMemo(() => toFeatureCollection(rows, alertIds, selectedId), [rows, alertIds, selectedId]);
  const bounds = useMemo(() => boundsOf(rows.values()), [rows]);
  const shown = useMemo(() => visibleRows(rows, { status: statusFilter, query }), [rows, statusFilter, query]);

  const selected = selectedId ? rows.get(selectedId) ?? null : null;
  const noPosition = useMemo(() => [...rows.values()].filter((r) => !hasPosition(r)).length, [rows]);
  const selectedFeature = useMemo(() => (selected ? toFeature(selected, alertIds) : null), [selected, alertIds]);
  const trail = selectedId ? trails.current.get(selectedId) ?? NO_TRAIL : NO_TRAIL;

  const select = (id: string | null) => {
    setSelectedId(id);
    setFollow(false);
    if (id) setListOpen(false);
  };

  const connection = CONNECTION_COPY[feed.connection];
  const counts = summary.data?.byStatus;

  return (
    <div ref={root} className="relative flex h-full min-h-0 flex-col bg-bg">
      {/* ---------------------------------------------------------- Top header & live status bar (matching 02_live_tracking.png) */}
      <div
        className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border/80 bg-surface px-4 py-3 sm:px-6"
        role="status"
        aria-live="polite"
      >
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 text-xs font-semibold text-text shadow-2xs hover:bg-surface-2 lg:hidden"
            onClick={() => setListOpen((o) => !o)}
            aria-expanded={listOpen}
          >
            <Menu className="size-4 text-text-muted" aria-hidden /> Vehicles <span className="tabular text-text-muted">({total})</span>
          </button>
          <div>
            <h1 className="text-[20px] font-bold tracking-tight text-text leading-tight">Live Tracking</h1>
            <p className="text-xs text-text-muted">Monitor vehicle positions and activity in real time</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
          <span className={cn('inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold', connection.className)}>
            <span aria-hidden className={cn('size-2 rounded-full bg-current', feed.connection === 'live' && 'animate-live-pulse')} />
            {connection.label}
          </span>
          <span className="text-text-muted">
            Tracking engine: {feed.engineConnected === null ? 'waiting for status' : feed.engineConnected ? 'connected' : 'unavailable'}
          </span>
          <span className="text-text-muted tabular">
            {feed.lastMessageAt ? `Last update ${agoLabel(new Date(feed.lastMessageAt).toISOString(), now)}` : 'No update received yet'}
          </span>
          {mapConfig.data?.devOnly && <Badge tone="warn">Development map</Badge>}
          <Link to="/app/monitor" className="font-semibold text-brand hover:underline">
            Pipeline monitor
          </Link>
        </div>
      </div>

      {feed.engineConnected === false && (
        <div className="px-4 pt-3 sm:px-6">
          <Alert tone="warn">The tracking engine is unavailable. Positions may be out of date until it reconnects.</Alert>
        </div>
      )}
      {feed.connection === 'refused' && (
        <div className="px-4 pt-3 sm:px-6">
          <Alert tone="danger">The live connection was closed by the server. Reload the page or sign in again.</Alert>
        </div>
      )}
      {feed.connection === 'reconnecting' && (
        <div className="px-4 pt-3 sm:px-6">
          <Alert tone="warn">Live updates are paused while reconnecting. You are looking at the last known positions.</Alert>
        </div>
      )}

      {/* ---------------------------------------------------------- Main two/three-card canvas matching 02_live_tracking.png */}
      <div className="relative flex min-h-0 flex-1 gap-4 p-3 sm:p-5">
        {/* Left Vehicles card */}
        <aside
          className={cn(
            'z-20 flex w-[340px] max-w-[88vw] shrink-0 flex-col rounded-xl border border-border/90 bg-surface card-shadow overflow-hidden',
            'max-lg:absolute max-lg:inset-y-3 max-lg:left-3 max-lg:shadow-2xl',
            listOpen ? 'max-lg:flex' : 'max-lg:hidden',
          )}
          aria-label="Vehicles"
        >
          <div className="space-y-3 border-b border-border/70 px-4 pt-4 pb-3">
            <div>
              <h2 className="text-[16px] font-bold tracking-tight text-text">Vehicles</h2>
              <p className="text-xs text-text-muted tabular">
                {summary.data ? `${summary.data.total} vehicles · ${summary.data.byStatus.MOVING} moving` : `${total} vehicles`}
              </p>
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-faint" aria-hidden />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search registration"
                aria-label="Search by registration number"
                className="h-9 pl-9 text-xs"
              />
            </div>
            <div className="flex flex-wrap gap-1" role="group" aria-label="Filter by status">
              <FilterChip active={statusFilter === null} onClick={() => setStatusFilter(null)} label="All" count={summary.data?.total} />
              {VEHICLE_STATUSES.map((s) => {
                const Icon = STATUS_ICON[s];
                return (
                  <FilterChip
                    key={s}
                    active={statusFilter === s}
                    onClick={() => setStatusFilter(statusFilter === s ? null : s)}
                    label={STATUS_META[s].label}
                    hint={STATUS_META[s].hint}
                    count={counts?.[s]}
                    icon={<Icon className="size-3" aria-hidden />}
                  />
                );
              })}
            </div>
          </div>

          <VehicleList
            rows={shown}
            loading={positions.isPending}
            error={positions.isError}
            onRetry={() => void positions.refetch()}
            empty={rows.size === 0}
            onClear={() => {
              setQuery('');
              setStatusFilter(null);
            }}
            selectedId={selectedId}
            onSelect={select}
            alertIds={alertIds}
            now={now}
          />
          {truncated && (
            <p className="border-t border-border/80 bg-surface-2 px-4 py-2 text-xs text-text-muted">
              Showing the first {rows.size} of {total} vehicles (the server's snapshot limit).
            </p>
          )}
        </aside>

        {/* Centre Live vehicle map card */}
        <section
          className="relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-border/90 bg-surface card-shadow"
          aria-label="Map"
        >
          <div className="flex items-center justify-between border-b border-border/70 px-5 py-3">
            <div>
              <h2 className="text-[15px] font-bold tracking-tight text-text">Live vehicle map</h2>
              <p className="text-xs text-text-muted">Map view · Vehicle clusters enabled</p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setFitRequest((n) => n + 1)}
              disabled={!bounds}
            >
              <Crosshair className="size-3.5 text-brand" aria-hidden /> Fit to fleet
            </Button>
          </div>

          <div className="relative min-h-0 flex-1">
            {mapConfig.isError ? (
              <MapMessage title="The map is unavailable" text="The map configuration could not be loaded. The vehicle list still works." />
            ) : mapConfig.data && !canDrawProvider(mapConfig.data) ? (
              <MapMessage
                title="This build cannot draw the configured map"
                text={`The server is set to use "${mapConfig.data.provider}", whose renderer is not part of this build yet. The vehicle list still works.`}
              />
            ) : mapConfig.data ? (
              <LiveMap
                config={mapConfig.data}
                features={features}
                selectedId={selectedId}
                selectedFeature={selectedFeature}
                trail={trail}
                follow={follow}
                fitRequest={fitRequest}
                bounds={bounds}
                onSelect={select}
                onUserMoved={() => setFollow(false)}
                fullscreenContainer={root.current}
              />
            ) : (
              <div className="grid h-full place-items-center bg-surface-2">
                <Skeleton className="h-8 w-40" />
              </div>
            )}
            {noPosition > 0 && (
              <p className="pointer-events-none absolute bottom-6 left-4 z-10 rounded-xl border border-border bg-white/95 backdrop-blur-md px-3.5 py-2 text-xs font-medium text-text-muted shadow-md">
                {noPosition === 1
                  ? '1 vehicle has no known position and is not on the map.'
                  : `${noPosition} vehicles have no known position and are not on the map.`}
              </p>
            )}
          </div>
        </section>

        {/* Right Selected vehicle detail card */}
        {selected && (
          <aside
            className="z-20 flex w-[340px] shrink-0 flex-col overflow-y-auto rounded-xl border border-border/90 bg-surface card-shadow max-lg:absolute max-lg:inset-x-3 max-lg:bottom-3 max-lg:max-h-[58%] max-lg:w-auto max-lg:shadow-2xl"
            aria-label="Selected vehicle"
          >
            <VehicleDetail
              row={selected}
              now={now}
              timeZone={timeZone}
              follow={follow}
              canFollow={selectedFeature !== null}
              onFollow={() => setFollow((f) => !f)}
              onClose={() => select(null)}
              alerts={(alerts.data?.data ?? []).filter((a) => a.vehicleId === selected.vehicleId && a.acknowledgedAt === null)}
              engineConnected={feed.engineConnected}
            />
          </aside>
        )}
      </div>
    </div>
  );
}

function MapMessage({ title, text }: { title: string; text: string }) {
  return (
    <div className="grid h-full place-items-center bg-surface-2 p-6 text-center" role="alert">
      <div className="rounded-xl border border-border bg-surface p-6 card-shadow">
        <p className="text-sm font-bold text-text">{title}</p>
        <p className="mt-1 max-w-sm text-[13px] text-text-muted leading-relaxed">{text}</p>
      </div>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  label,
  count,
  hint,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number | undefined;
  hint?: string;
  icon?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      title={hint}
      onClick={onClick}
      className={cn(
        'inline-flex h-7 cursor-pointer items-center gap-1 rounded-lg border px-2 text-[11px] transition-all duration-150',
        active
          ? 'border-[#B8CEFF] bg-[#EEF3FF] font-bold text-[#2458E8]'
          : 'border-border bg-surface font-medium text-text-muted hover:bg-surface-2 hover:text-text',
      )}
    >
      {icon}
      <span>{label}</span>
      <span className={cn('tabular rounded px-1 text-[10px] font-bold', active ? 'text-[#2458E8]' : 'text-text-faint')}>
        {count ?? '—'}
      </span>
    </button>
  );
}

interface VehicleListProps {
  rows: VehicleRow[];
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  empty: boolean;
  onClear: () => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  alertIds: ReadonlySet<string>;
  now: number;
}

/**
 * Virtualized vehicle list styled after design_references/02_live_tracking.png:
 * Colored status dot + bold registration on left, speed on right, status label in semantic color underneath.
 * Selected row gets a soft blue card (`bg-[#EEF3FF] border-[#B8CEFF]`).
 */
function VehicleList({ rows, loading, error, onRetry, empty, onClear, selectedId, onSelect, alertIds, now }: VehicleListProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const virtual = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => 78,
    overscan: 8,
    initialRect: { width: 340, height: 600 },
  });

  if (loading) {
    return (
      <div className="space-y-2.5 p-3.5">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="p-4">
        <Alert tone="danger">The vehicles could not be loaded right now.</Alert>
        <Button className="mt-3" variant="secondary" size="sm" onClick={onRetry}>
          Try again
        </Button>
      </div>
    );
  }
  if (empty)
    return (
      <EmptyState
        title="No vehicle has reported yet"
        description="Vehicles appear here and on the map as soon as a registered GPS device sends its first position."
      />
    );
  if (rows.length === 0)
    return (
      <EmptyState
        title="No vehicle matches"
        description="Clear the search or the status filter."
        action={
          <Button variant="secondary" size="sm" onClick={onClear}>
            Clear filters
          </Button>
        }
      />
    );

  return (
    <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-2.5 py-2" role="list" aria-label="Vehicle list">
      <div className="relative w-full" style={{ height: virtual.getTotalSize() }}>
        {virtual.getVirtualItems().map((item) => {
          const r = rows[item.index]!;
          const active = r.vehicleId === selectedId;
          return (
            <div key={r.vehicleId} role="listitem" className="absolute left-0 top-0 w-full py-1" style={{ height: item.size, transform: `translateY(${item.start}px)` }}>
              <button
                type="button"
                onClick={() => onSelect(r.vehicleId)}
                aria-current={active || undefined}
                className={cn(
                  'flex h-full w-full cursor-pointer flex-col justify-center gap-1 rounded-xl border px-3.5 text-left text-[13px] transition-all',
                  active
                    ? 'border-[#A3C2FF] bg-[#EEF3FF]'
                    : 'border-transparent bg-surface hover:bg-surface-2',
                )}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-2.5 min-w-0">
                    <span aria-hidden className={cn('size-2.5 shrink-0 rounded-full', STATUS_DOT[r.status])} />
                    <span className="truncate font-bold tracking-tight text-text">{r.registrationNumber}</span>
                  </span>
                  <span className="tabular text-xs font-bold text-text">
                    {r.speedKmh === null ? '—' : `${speedLabel(r.speedKmh)} km/h`}
                  </span>
                </span>
                <span className="flex items-center justify-between gap-2 pl-5 text-xs">
                  <span className="flex items-center gap-1.5">
                    <span className={cn('font-semibold', STATUS_TEXT[r.status])}>{STATUS_META[r.status].label}</span>
                    {r.simulated && <Badge tone="brand">Simulated</Badge>}
                    {alertIds.has(r.vehicleId) && <Badge tone="danger">Alert</Badge>}
                    {!hasPosition(r) && <span className="italic text-text-faint">no position</span>}
                  </span>
                  <span className="tabular text-[11px] text-text-muted">{agoLabel(r.lastSeenAt, now)}</span>
                </span>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function VehicleDetail({
  row,
  now,
  timeZone,
  follow,
  canFollow,
  onFollow,
  onClose,
  alerts,
  engineConnected,
}: {
  row: VehicleRow;
  now: number;
  timeZone: string;
  follow: boolean;
  canFollow: boolean;
  onFollow: () => void;
  onClose: () => void;
  alerts: AlertDto[];
  engineConnected: boolean | null;
}) {
  return (
    <>
      <div className="flex items-start justify-between gap-2 border-b border-border/80 px-5 py-4">
        <div>
          <h2 className="text-[17px] font-bold tracking-tight text-text">{row.registrationNumber}</h2>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <StatusBadge status={row.status} />
            {row.simulated && <Badge tone="brand">Simulated</Badge>}
            {row.lastFixDelayed && <Badge tone="warn">Delayed data</Badge>}
            {row.lastFixInvalid && <Badge tone="warn">No fix</Badge>}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
          aria-label="Close vehicle details"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>

      <div className="space-y-4 px-5 py-4 text-[13px]">
        <div className="flex gap-2">
          <Button
            variant={follow ? 'primary' : 'secondary'}
            size="sm"
            className="flex-1"
            onClick={onFollow}
            disabled={!canFollow}
            aria-pressed={follow}
            title={canFollow ? undefined : 'This vehicle has no known position'}
          >
            <LocateFixed className="size-3.5" aria-hidden /> {follow ? 'Following' : 'Follow on map'}
          </Button>
          <Link to={`/app/vehicles/${row.vehicleId}`}>
            <Button variant="secondary" size="sm">
              Vehicle details
            </Button>
          </Link>
        </div>

        {alerts.length > 0 && (
          <div className="space-y-1.5">
            {alerts.map((a) => (
              <Alert key={a.id} tone="danger">
                {ALERT_TYPE_LABEL[a.type]} · {agoLabel(a.startedAt, now)}
              </Alert>
            ))}
          </div>
        )}

        <dl className="divide-y divide-border/60 rounded-xl border border-border/80 bg-surface-2/50 px-4 py-1">
          <Row label="Speed" value={row.speedKmh === null ? '—' : `${speedLabel(row.speedKmh)} km/h`} />
          <Row label="Heading" value={headingLabel(row.heading)} />
          <Row label="Ignition" value={ignitionLabel(row.ignition)} />
          <Row label="Position" value={hasPosition(row) ? `${row.latitude.toFixed(5)}, ${row.longitude.toFixed(5)}` : 'Unknown'} />
          <Row label="Last fix" value={agoLabel(row.lastFixAt, now)} title={absolute(row.lastFixAt, timeZone)} />
          <Row label="Last message" value={agoLabel(row.lastSeenAt, now)} title={absolute(row.lastSeenAt, timeZone)} />
          <Row label="Device" value={row.deviceId.slice(0, 8)} />
          <Row label="Address" value="Not available" hint="Reverse geocoding is not enabled (map provider terms, OQ-012)." />
        </dl>

        {engineConnected === false && (
          <p className="text-xs font-semibold text-warn">The tracking engine is unavailable: these values may be out of date.</p>
        )}
        <p className="text-xs leading-relaxed text-text-muted">
          Trips, history and security views arrive in later milestones. The trail on the map shows movement since this page was opened.
        </p>
      </div>
    </>
  );
}

function Row({ label, value, title, hint }: { label: string; value: string; title?: string; hint?: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5" title={title ?? hint}>
      <dt className="text-xs text-text-muted">{label}</dt>
      <dd className="text-right text-[13px] font-bold text-text tabular">{value}</dd>
    </div>
  );
}
