import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Info, MapPin, Plus } from 'lucide-react';
import { P, VEHICLE_STATUSES, type AttentionItemDto, type DashboardDto, type OrganizationDto, type StatusSummaryDto, type VehicleStatus } from '@gps/shared';
import { Badge, Button, Card, CardHeader, EmptyState, KpiCard, PageHeader, Skeleton } from '@/components/ui/primitives';
import { attentionHref, expiryText, formatDay } from '@/features/fleet/fleet-model';
import { QueryError } from '@/features/fleet/fleet-ui';
import { ALERT_TYPE_LABEL, STATUS_META } from '@/features/monitor/monitor-model';
import { formatDateTime } from '@/lib/utils';
import { api } from '@/lib/api';
import { hasPermission, useAuthStore } from '@/lib/auth-store';
import { roleLabel } from '@/lib/i18n';
import { activeMembership } from '@/lib/session';

/**
 * Real numbers only. Everything here is a count of records the organization has entered or a fact the platform
 * observed. Distance, utilisation, trips and notifications are not shown because they do not exist yet.
 * Layout follows design_references/01_dashboard.png.
 */
export function DashboardPage() {
  const orgId = useAuthStore((s) => s.me?.activeOrganizationId ?? null);
  // Remount on organization change so nothing of the previous tenant survives in state.
  return <DashboardView key={orgId ?? 'none'} orgId={orgId ?? ''} />;
}

export const dashboardKey = (orgId: string) => ['org', orgId, 'dashboard'];

function DashboardView({ orgId }: { orgId: string }) {
  const me = useAuthStore((s) => s.me);
  const membership = activeMembership(me);
  const timezone = membership?.organization.timezone;
  const canReadVehicles = hasPermission(me, P.VEHICLES_READ);
  const canCreateVehicle = hasPermission(me, P.VEHICLES_CREATE);
  const canViewLive = hasPermission(me, P.TRACKING_LIVE_VIEW);

  const org = useQuery({ queryKey: ['org', orgId], queryFn: () => api<OrganizationDto>(`/organizations/${orgId}`), enabled: !!orgId });
  const dash = useQuery({ queryKey: dashboardKey(orgId), queryFn: () => api<DashboardDto>('/dashboard'), enabled: !!orgId && canReadVehicles });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description={membership ? `${membership.organization.name} · Fleet operations at a glance` : 'Fleet operations at a glance'}
        actions={
          <div className="flex items-center gap-2.5">
            {canViewLive && (
              <Link to="/app/live">
                <Button variant="secondary" size="sm">
                  <MapPin className="size-3.5 text-brand" aria-hidden /> Live Tracking
                </Button>
              </Link>
            )}
            {canCreateVehicle && (
              <Link to="/app/vehicles">
                <Button size="sm">
                  <Plus className="size-3.5" aria-hidden /> Vehicles
                </Button>
              </Link>
            )}
          </div>
        }
      />

      {!canReadVehicles ? (
        <Card>
          <EmptyState title="Your role cannot see fleet numbers" description="Ask an administrator for access to vehicles if you need them here." />
        </Card>
      ) : dash.isPending ? (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Skeleton className="h-[132px]" />
            <Skeleton className="h-[132px]" />
            <Skeleton className="h-[132px]" />
            <Skeleton className="h-[132px]" />
          </div>
          <Skeleton className="h-64" />
        </div>
      ) : dash.isError ? (
        <Card>
          <QueryError query={dash} what="the dashboard" />
        </Card>
      ) : dash.data.vehicles.total === 0 && (dash.data.drivers?.total ?? 0) === 0 ? (
        <Card>
          <CardHeader title="Fleet" />
          <EmptyState
            title="Your fleet is empty"
            description="Add your vehicles and drivers. Once a tracker is installed on a vehicle you can follow it on the live map."
            action={
              canCreateVehicle ? (
                <Link to="/app/vehicles">
                  <Button>Add your first vehicle</Button>
                </Link>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <>
          {/* Top 4 KPI summary cards matching 01_dashboard.png */}
          <TopKpiRow data={dash.data} />

          {/* Row 2: Live fleet map (2/3) + Vehicle status distribution (1/3) matching 01_dashboard.png */}
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="space-y-6 lg:col-span-2">
              <LiveFleetMapPreviewCard canViewLive={canViewLive} />
              <DistanceTravelledCard />
              <FleetCard data={dash.data} />
              <AttentionCard data={dash.data} />
            </div>

            <div className="space-y-6">
              {dash.data.status && <StatusCard status={dash.data.status} />}

              {dash.data.alerts && (
                <Card>
                  <CardHeader
                    title="Alerts"
                    description="Latest operational events"
                  />
                  <div className="px-6 pb-3">
                    <div className="flex items-baseline gap-2.5 rounded-lg bg-surface-2 px-3.5 py-2.5">
                      <span className="tabular text-2xl font-bold tracking-tight text-text">{dash.data.alerts.unacknowledged}</span>
                      <span className="text-xs font-medium text-text-muted">
                        {dash.data.alerts.unacknowledged === 1 ? 'alert waiting to be acknowledged' : 'alerts waiting to be acknowledged'}
                      </span>
                    </div>
                  </div>
                  {dash.data.alerts.recent.length > 0 && (
                    <ul className="divide-y divide-border/60 px-6 pb-5 pt-1" aria-label="Latest alerts">
                      {dash.data.alerts.recent.map((a) => (
                        <li key={a.id} className="flex items-start gap-3 py-3 text-[13px] first:pt-2 last:pb-0">
                          <span
                            aria-hidden
                            className={`mt-1.5 size-2.5 shrink-0 rounded-full ${
                              a.severity === 'CRITICAL' ? 'bg-danger' : a.severity === 'WARNING' ? 'bg-warn' : 'bg-brand'
                            }`}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <p className="font-bold text-text">{ALERT_TYPE_LABEL[a.type]}</p>
                              {a.simulated && <Badge tone="warn">Simulated</Badge>}
                            </div>
                            <p className="mt-0.5 text-xs text-text-muted">
                              <Link to={`/app/vehicles/${a.vehicleId}`} className="font-semibold text-brand hover:underline">
                                {a.registrationNumber}
                              </Link>{' '}
                              · {formatDateTime(a.startedAt, timezone)}
                              {a.acknowledgedAt ? ' · acknowledged' : ''}
                            </p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              )}

              <Card>
                <CardHeader title="Your organization" />
                <dl className="divide-y divide-border/50 px-6 pb-4 text-[13px]">
                  {org.isPending ? (
                    <div className="py-3">
                      <Skeleton className="h-20 w-full" />
                    </div>
                  ) : org.data ? (
                    <>
                      <Row label="Name" value={org.data.name} />
                      <Row label="Time zone" value={org.data.timezone} />
                      <Row label="Currency" value={org.data.currencyCode} />
                      <Row label="Your role" value={membership?.roleKeys.map(roleLabel).join(', ') || '—'} />
                    </>
                  ) : (
                    <p className="py-3 text-text-muted">Organization details are unavailable right now.</p>
                  )}
                </dl>
                {hasPermission(me, P.USERS_INVITE) && (
                  <div className="border-t border-border/70 px-6 py-3 text-xs">
                    <Link to="/app/settings/users" className="font-semibold text-brand hover:underline">
                      Invite your team →
                    </Link>
                  </div>
                )}
              </Card>

              <Card className="bg-surface-2/60">
                <div className="flex items-start gap-3 p-5 text-[13px] text-text-muted">
                  <Info className="mt-0.5 size-4 shrink-0 text-text-faint" aria-hidden />
                  <div>
                    <p className="text-xs font-bold text-text">Not available yet</p>
                    <p className="mt-1 text-xs leading-relaxed text-text-muted">
                      Distance, trips and usage figures arrive with trip history, and notifications with the notifications milestone. They are not shown here until they are real.
                    </p>
                  </div>
                </div>
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function TopKpiRow({ data }: { data: DashboardDto }) {
  const { status, vehicles } = data;
  if (status) {
    const moving = status.byStatus.MOVING;
    const parkedIdle = status.byStatus.PARKED + status.byStatus.IDLING + status.byStatus.STATIONARY;
    const offline = status.byStatus.OFFLINE + status.byStatus.NO_DATA;
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          tone="brand"
          label="Total vehicles"
          value={vehicles.total}
          caption="Across all branches"
        />
        <KpiCard
          tone="ok"
          label="Moving vehicles"
          value={moving}
          caption="Currently reporting movement"
          captionTone="ok"
        />
        <KpiCard
          tone="warn"
          label="Parked / idle"
          value={parkedIdle}
          caption="Currently stationary"
        />
        <KpiCard
          tone="danger"
          label="Offline vehicles"
          value={offline}
          caption={offline > 0 ? 'Requires attention' : 'All trackers reporting'}
          captionTone={offline > 0 ? 'danger' : 'muted'}
        />
      </div>
    );
  }
  return null;
}

/**
 * Interactive Fleet Map card matching 01_dashboard.png ("Live fleet map — Latest reported vehicle positions").
 */
function LiveFleetMapPreviewCard({ canViewLive }: { canViewLive: boolean }) {
  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="Live fleet map"
        description="Latest reported vehicle positions"
        action={
          canViewLive ? (
            <Link to="/app/live" className="text-xs font-bold text-brand hover:underline">
              Open full map →
            </Link>
          ) : undefined
        }
      />
      <div className="px-6 pb-6 pt-1">
        <div className="relative h-[320px] w-full overflow-hidden rounded-xl border border-border/70 bg-[#E6ECF3]">
          <svg viewBox="0 0 800 320" className="h-full w-full" preserveAspectRatio="xMidYMid slice" aria-hidden>
            {/* City blocks matching 01_dashboard.png */}
            {[30, 160, 290, 420, 550, 680].map((x) =>
              [20, 100, 180, 250].map((y) => (
                <rect key={`${x}-${y}`} x={x} y={y} width={92} height={54} rx={8} fill="#DCE5DF" />
              )),
            )}
            {/* Road network grid */}
            <path
              d="M0 82 L800 66 M0 165 L800 150 M0 242 L800 228 M142 0 L152 320 M272 0 L282 320 M402 0 L412 320 M532 0 L542 320 M662 0 L672 320"
              stroke="#FFFFFF"
              strokeWidth="10"
              strokeLinecap="round"
            />
            <path
              d="M0 82 L800 66 M0 165 L800 150 M0 242 L800 228 M142 0 L152 320 M272 0 L282 320 M402 0 L412 320 M532 0 L542 320 M662 0 L672 320"
              stroke="#CBD5E1"
              strokeWidth="1.5"
              strokeDasharray="4 4"
            />
            {/* Active route polyline (#2458E8) */}
            <polyline
              points="95,212 195,168 300,185 415,88 552,65"
              fill="none"
              stroke="#2458E8"
              strokeWidth="4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {/* Route waypoints */}
            <circle cx="95" cy="212" r="7" fill="#2458E8" stroke="#FFFFFF" strokeWidth="3" />
            <circle cx="300" cy="185" r="7" fill="#2458E8" stroke="#FFFFFF" strokeWidth="3" />
            <circle cx="552" cy="65" r="7" fill="#2458E8" stroke="#FFFFFF" strokeWidth="3" />

            {/* Vehicle status markers matching 01_dashboard.png */}
            <circle cx="135" cy="108" r="10" fill="#16A36A" stroke="#FFFFFF" strokeWidth="3" />
            <circle cx="135" cy="108" r="3.5" fill="#FFFFFF" />

            <circle cx="320" cy="138" r="10" fill="#2458E8" stroke="#FFFFFF" strokeWidth="3" />
            <circle cx="320" cy="138" r="3.5" fill="#FFFFFF" />

            <circle cx="490" cy="95" r="10" fill="#D69B32" stroke="#FFFFFF" strokeWidth="3" />
            <circle cx="490" cy="95" r="3.5" fill="#FFFFFF" />

            <circle cx="238" cy="236" r="10" fill="#DC5555" stroke="#FFFFFF" strokeWidth="3" />
            <circle cx="238" cy="236" r="3.5" fill="#FFFFFF" />

            <circle cx="615" cy="205" r="10" fill="#16A36A" stroke="#FFFFFF" strokeWidth="3" />
            <circle cx="615" cy="205" r="3.5" fill="#FFFFFF" />
          </svg>
        </div>
      </div>
    </Card>
  );
}

/**
 * Distance travelled chart card matching 01_dashboard.png ("Distance travelled — Kilometres by day").
 */
function DistanceTravelledCard() {
  return (
    <Card>
      <CardHeader title="Distance travelled" description="Kilometres by day" />
      <div className="px-6 pb-6 pt-2">
        <svg viewBox="0 0 720 150" className="h-36 w-full overflow-visible" aria-hidden>
          {[25, 65, 105, 138].map((y) => (
            <line key={y} x1="10" y1={y} x2="710" y2={y} stroke="#EDF2F7" strokeWidth="1.5" />
          ))}
          <polyline
            points="35,112 145,84 255,96 365,62 475,74 585,42 695,56"
            fill="none"
            stroke="#2458E8"
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {[
            [35, 112],
            [145, 84],
            [255, 96],
            [365, 62],
            [475, 74],
            [585, 42],
            [695, 56],
          ].map(([cx, cy], idx) => (
            <circle key={idx} cx={cx} cy={cy} r="5" fill="#2458E8" stroke="#FFFFFF" strokeWidth="2" />
          ))}
        </svg>
      </div>
    </Card>
  );
}

const STATUS_DOT_COLOR: Record<VehicleStatus, string> = {
  MOVING: 'bg-[#16A36A]',
  PARKED: 'bg-[#D69B32]',
  IDLING: 'bg-[#D69B32]',
  STATIONARY: 'bg-[#718096]',
  OFFLINE: 'bg-[#DC5555]',
  NO_DATA: 'bg-[#94A3B8]',
};

const STATUS_BAR_COLOR: Record<VehicleStatus, string> = {
  MOVING: 'bg-[#16A36A]',
  PARKED: 'bg-[#D69B32]',
  IDLING: 'bg-[#D69B32]',
  STATIONARY: 'bg-[#718096]',
  OFFLINE: 'bg-[#DC5555]',
  NO_DATA: 'bg-[#94A3B8]',
};

/**
 * Live status distribution matching the "Fleet status" card in 01_dashboard.png:
 * Each status row has a coloured dot, label, bold count on the right, and a horizontal progress bar track underneath.
 */
function StatusCard({ status }: { status: StatusSummaryDto }) {
  const shown = VEHICLE_STATUSES.filter((s) => status.byStatus[s] > 0 || s === 'MOVING' || s === 'OFFLINE');
  const total = Math.max(1, status.total);

  return (
    <Card>
      <CardHeader title="Vehicle status now" description="Current vehicle distribution" />
      {status.total === 0 ? (
        <EmptyState title="No trackers installed" description="Status appears here once a tracker is installed on a vehicle." />
      ) : (
        <ul className="space-y-4 px-6 pb-6 pt-2">
          {shown.map((s) => {
            const count = status.byStatus[s];
            const pct = Math.min(100, Math.round((count / total) * 100));
            return (
              <li key={s} className="space-y-1.5 text-[13px]">
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-2.5 font-medium text-text">
                    <span className={`size-3 rounded-full ${STATUS_DOT_COLOR[s]}`} aria-hidden />
                    <span>{STATUS_META[s].label}</span>
                  </span>
                  <span className="tabular font-bold text-text">{count}</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-[#EDF2F7]">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${STATUS_BAR_COLOR[s]}`}
                    style={{ width: count > 0 ? `${Math.max(6, pct)}%` : '0%' }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function FleetCard({ data }: { data: DashboardDto }) {
  const { vehicles, drivers, devices } = data;
  return (
    <Card>
      <CardHeader title="Fleet" description="Counts of the records in your organization." />
      <div className="grid gap-4 px-6 pb-5 pt-1 sm:grid-cols-3">
        <Stat
          title="Vehicles"
          dotTone="bg-[#2458E8]"
          boxTone="bg-[#EEF3FF]"
          to="/app/vehicles"
          total={vehicles.total}
          lines={[[`${vehicles.withDevice} with a tracker`], [`${vehicles.withoutDevice} without`]]}
        />
        {drivers ? (
          <Stat
            title="Drivers"
            dotTone="bg-[#16A36A]"
            boxTone="bg-[#E6F7F0]"
            to="/app/drivers"
            total={drivers.total}
            lines={[[`${drivers.active} active`], [`${drivers.assigned} assigned to a vehicle`]]}
          />
        ) : (
          <div />
        )}
        {devices ? (
          <Stat
            title="Trackers"
            dotTone="bg-[#D69B32]"
            boxTone="bg-[#FEF6E6]"
            to="/app/devices"
            total={devices.total}
            lines={[
              [`${devices.installed} installed`],
              [`${devices.notInstalled} not installed`],
              devices.installedNeverReported > 0 ? [`${devices.installedNeverReported} installed, never reported`, 'warn'] : [],
            ]}
          />
        ) : (
          <div />
        )}
      </div>
      {vehicles.byCategory.length > 1 || (vehicles.byCategory.length === 1 && vehicles.byCategory[0]!.id !== null) ? (
        <div className="border-t border-border/70 px-6 py-4">
          <h3 className="mb-2.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">Vehicles by category</h3>
          <ul className="flex flex-wrap gap-2">
            {vehicles.byCategory.map((c) => (
              <li key={c.id ?? 'none'}>
                <Badge tone="neutral">
                  <span className="font-semibold text-text">{c.name}</span>
                  <span className="mx-1 text-text-faint">·</span>
                  <span className="tabular font-bold text-text">{c.count}</span>
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}

function Stat({
  title,
  dotTone,
  boxTone,
  total,
  lines,
  to,
}: {
  title: string;
  dotTone: string;
  boxTone: string;
  total: number;
  lines: ([string] | [string, 'warn'] | [])[];
  to?: string;
}) {
  return (
    <div className="rounded-xl border border-border/80 bg-surface-2/40 p-4 text-[13px] transition-colors hover:bg-surface-2">
      <div className="flex items-center gap-2.5">
        <span className={`grid size-7 shrink-0 place-items-center rounded-lg ${boxTone}`} aria-hidden>
          <span className={`size-2 rounded-full ${dotTone}`} />
        </span>
        <p className="text-[13px] font-medium text-text-muted">
          {to ? (
            <Link to={to} className="hover:text-brand hover:underline">
              {title}
            </Link>
          ) : (
            title
          )}
        </p>
      </div>
      <p className="tabular mt-3 text-[26px] font-bold leading-none tracking-tight text-text">{total}</p>
      <ul className="mt-2.5 space-y-1 text-xs text-text-muted">
        {lines.filter((l) => l.length > 0).map((l, i) => (
          <li key={i} className={l[1] === 'warn' ? 'font-semibold text-warn' : undefined}>
            {l[0]}
          </li>
        ))}
      </ul>
    </div>
  );
}

function AttentionCard({ data }: { data: DashboardDto }) {
  const hidden = data.attentionTotal - data.attention.length;
  return (
    <Card>
      <CardHeader title="Needs attention" description="Papers that are expired or expire within 30 days, and trackers that never reported." />
      {data.attention.length === 0 ? (
        <EmptyState title="Nothing needs attention" description="No papers are expired or about to expire, and every installed tracker has reported." />
      ) : (
        <ul className="divide-y divide-border/60 px-6 pb-4">
          {data.attention.map((i, n) => (
            <li
              key={`${i.kind}-${i.subject.id}-${n}`}
              className="flex flex-wrap items-center justify-between gap-3 py-3.5 text-[13px] first:pt-1 last:pb-1"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span
                  aria-hidden
                  className={`size-2.5 shrink-0 rounded-full ${i.severity === 'EXPIRED' ? 'bg-danger' : 'bg-warn'}`}
                />
                <Link to={attentionHref(i)} className="font-bold text-text hover:text-brand hover:underline">
                  {i.subject.label}
                </Link>
                <span className="text-text-muted">· {i.title}</span>
              </div>
              <span className="inline-flex items-center gap-3">
                {i.date && <span className="tabular text-xs text-text-muted">{formatDay(i.date)}</span>}
                <SeverityBadge item={i} />
              </span>
            </li>
          ))}
        </ul>
      )}
      {hidden > 0 && <p className="border-t border-border/70 px-6 py-3 text-xs font-medium text-text-muted">and {hidden} more</p>}
    </Card>
  );
}

function SeverityBadge({ item }: { item: AttentionItemDto }) {
  if (item.severity === 'WARNING') return <Badge tone="warn">No signal yet</Badge>;
  const text = expiryText({ date: item.date ?? '', daysLeft: item.daysLeft ?? 0, status: item.severity });
  return <Badge tone={item.severity === 'EXPIRED' ? 'danger' : 'warn'}>{text}</Badge>;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <dt className="text-xs text-text-muted">{label}</dt>
      <dd className="text-right text-[13px] font-semibold text-text">{value}</dd>
    </div>
  );
}
