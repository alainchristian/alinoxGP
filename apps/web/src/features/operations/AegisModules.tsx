import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  Download,
  Pause,
  Play,
  Plus,
  Search,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import { P, type AlertDto, type DeviceDto, type VehicleDto } from '@gps/shared';
import { Badge, Button, Card, CardHeader, EmptyState, Input, KpiCard, PageHeader, Select, Skeleton, Table, Td, Th } from '@/components/ui/primitives';
import { ExpiryBadge } from '@/features/fleet/fleet-ui';
import { ALERT_TYPE_LABEL, agoLabel } from '@/features/monitor/monitor-model';
import { useNow } from '@/features/live/use-now';
import { api, apiPaged } from '@/lib/api';
import { hasPermission, useAuthStore } from '@/lib/auth-store';
import { formatDateTime, formatRelative } from '@/lib/utils';

// ============================================================================
// 1. TRIPS & PLAYBACK (matches design_references/05_trips_playback.png)
// ============================================================================

export function TripsPlaybackPage() {
  const orgId = useAuthStore((s) => s.me?.activeOrganizationId ?? '');
  const vehicles = useQuery({
    queryKey: ['org', orgId, 'vehicles', 'trips-select'],
    queryFn: () => apiPaged<VehicleDto>('/vehicles?pageSize=100'),
    enabled: !!orgId,
  });
  const list = vehicles.data?.data ?? [];
  const [selectedVehicle, setSelectedVehicle] = useState('');
  const [date, setDate] = useState('2026-11-03');
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<'1x' | '2x' | '4x'>('1x');
  const [progress, setProgress] = useState(64);

  const activeReg = list.find((v) => v.id === selectedVehicle)?.registrationNumber ?? list[0]?.registrationNumber ?? 'RAE 123A';

  return (
    <div className="space-y-6">
      <PageHeader title="Trips & Playback" description="Investigate journeys, stops and route activity" />

      <Card className="p-6 space-y-6">
        <div className="space-y-3">
          <div>
            <h2 className="text-[16px] font-bold tracking-tight text-text">Trip history</h2>
            <p className="text-xs text-text-muted">Select a vehicle and time range to review completed journeys</p>
          </div>
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Select
              aria-label="Select vehicle"
              className="w-60 bg-surface-2/80 font-semibold"
              value={selectedVehicle}
              onChange={(e) => setSelectedVehicle(e.target.value)}
            >
              {list.length === 0 ? (
                <option value="">Vehicle: RAE 123A</option>
              ) : (
                list.map((v) => (
                  <option key={v.id} value={v.id}>
                    Vehicle: {v.registrationNumber}
                  </option>
                ))
              )}
            </Select>
            <Input
              type="date"
              aria-label="Trip date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-48 bg-surface-2/80 font-semibold"
            />
            <Button onClick={() => setPlaying(false)}>Apply filters</Button>
          </div>
        </div>

        {/* Route Map (left 2/3) + Journey Summary Card (right 1/3) matching 05_trips_playback.png */}
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="relative h-[420px] overflow-hidden rounded-xl border border-border/80 bg-[#E6ECF3] lg:col-span-2">
            <svg viewBox="0 0 800 420" className="h-full w-full" preserveAspectRatio="xMidYMid slice" aria-hidden>
              {[30, 160, 290, 420, 550, 680].map((x) =>
                [25, 125, 225, 325].map((y) => (
                  <rect key={`${x}-${y}`} x={x} y={y} width={92} height={66} rx={8} fill="#DCE5DF" />
                )),
              )}
              <path
                d="M0 104 L800 84 M0 208 L800 188 M0 310 L800 290 M142 0 L154 420 M272 0 L284 420 M402 0 L414 420 M532 0 L544 420 M662 0 L674 420"
                stroke="#FFFFFF"
                strokeWidth="11"
              />
              <polyline
                points="85,325 205,264 315,286 435,162 585,126"
                fill="none"
                stroke="#2458E8"
                strokeWidth="4.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx="85" cy="325" r="7" fill="#2458E8" stroke="#FFFFFF" strokeWidth="3" />
              <circle cx="315" cy="286" r="7" fill="#2458E8" stroke="#FFFFFF" strokeWidth="3" />
              <circle cx="585" cy="126" r="7" fill="#2458E8" stroke="#FFFFFF" strokeWidth="3" />
              <circle cx="135" cy="108" r="10" fill="#16A36A" stroke="#FFFFFF" strokeWidth="3" />
              <circle cx="135" cy="108" r="3.5" fill="#FFFFFF" />
              <circle cx="320" cy="128" r="10" fill="#2458E8" stroke="#FFFFFF" strokeWidth="3" />
              <circle cx="320" cy="128" r="3.5" fill="#FFFFFF" />
              <circle cx="490" cy="95" r="10" fill="#D69B32" stroke="#FFFFFF" strokeWidth="3" />
              <circle cx="490" cy="95" r="3.5" fill="#FFFFFF" />
              <circle cx="242" cy="240" r="10" fill="#DC5555" stroke="#FFFFFF" strokeWidth="3" />
              <circle cx="242" cy="240" r="3.5" fill="#FFFFFF" />
              <circle cx="628" cy="212" r="10" fill="#16A36A" stroke="#FFFFFF" strokeWidth="3" />
              <circle cx="628" cy="212" r="3.5" fill="#FFFFFF" />
            </svg>
          </div>

          <div className="rounded-xl border border-border/90 bg-surface p-5">
            <h3 className="text-[16px] font-bold tracking-tight text-text">Journey summary</h3>
            <p className="mt-0.5 text-xs text-text-muted">Selected trip · {activeReg}</p>
            <dl className="mt-4 divide-y divide-border/60 text-[13px]">
              <SummaryRow label="Start" value="Kigali Warehouse" />
              <SummaryRow label="Destination" value="Kicukiro Depot" />
              <SummaryRow label="Departure" value="08:14 AM" />
              <SummaryRow label="Arrival" value="09:02 AM" />
              <SummaryRow label="Distance" value="18.6 km" />
              <SummaryRow label="Duration" value="48 minutes" />
              <SummaryRow label="Max speed" value="72 km/h" />
            </dl>
          </div>
        </div>

        {/* Route playback bar matching 05_trips_playback.png */}
        <div className="rounded-xl border border-border/90 bg-surface-2/50 p-5">
          <p className="text-[11px] font-bold uppercase tracking-wider text-text-muted">Route playback</p>
          <div className="mt-3 flex items-center gap-4">
            <button
              type="button"
              onClick={() => setPlaying((p) => !p)}
              aria-label={playing ? 'Pause playback' : 'Play route'}
              className="grid size-8 place-items-center rounded-lg text-brand hover:bg-brand-soft"
            >
              {playing ? <Pause className="size-4 fill-current" /> : <Play className="size-4 fill-current" />}
            </button>
            <button
              type="button"
              onClick={() => setSpeed((s) => (s === '1x' ? '2x' : s === '2x' ? '4x' : '1x'))}
              className="text-xs font-bold text-brand hover:underline tabular"
            >
              {speed}
            </button>
            <input
              type="range"
              min={0}
              max={100}
              value={progress}
              onChange={(e) => setProgress(Number(e.target.value))}
              aria-label="Playback timeline"
              className="h-1.5 w-full max-w-xl cursor-pointer accent-brand"
            />
            <span className="tabular text-xs font-bold text-brand">09:02</span>
          </div>
          <div className="mt-3 flex flex-wrap gap-6 text-xs text-text-muted tabular">
            <span>08:14 Start</span>
            <span>08:32 Stop 1</span>
            <span>08:47 Stop 2</span>
            <span>09:02 Destination</span>
          </div>
        </div>
      </Card>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <dt className="text-xs text-text-muted">{label}</dt>
      <dd className="text-right text-[13px] font-bold text-text tabular">{value}</dd>
    </div>
  );
}

// ============================================================================
// 2. ALERTS & EVENTS (matches design_references/06_alerts_events.png)
// ============================================================================

export function AlertsEventsPage() {
  const now = useNow(5000);
  const orgId = useAuthStore((s) => s.me?.activeOrganizationId ?? '');
  const me = useAuthStore((s) => s.me);
  const queryClient = useQueryClient();
  const canAck = hasPermission(me, P.ALERTS_ACKNOWLEDGE);
  const [search, setSearch] = useState('');
  const [severityFilter, setSeverityFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const alerts = useQuery({
    queryKey: ['alerts', 'incident-centre', orgId],
    queryFn: () => apiPaged<AlertDto>('/alerts?page=1&pageSize=50'),
    enabled: !!orgId,
    refetchInterval: 15_000,
  });

  const acknowledge = useMutation({
    mutationFn: (id: string) => api(`/alerts/${id}/acknowledge`, { method: 'PATCH' }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['alerts'] }),
  });

  const rows = alerts.data?.data ?? [];
  const filtered = rows.filter((a) => {
    if (severityFilter && a.severity !== severityFilter) return false;
    if (statusFilter === 'OPEN' && a.acknowledgedAt !== null) return false;
    if (statusFilter === 'ACKNOWLEDGED' && a.acknowledgedAt === null) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      return a.registrationNumber.toLowerCase().includes(q) || ALERT_TYPE_LABEL[a.type].toLowerCase().includes(q);
    }
    return true;
  });

  const openCount = rows.filter((r) => r.acknowledgedAt === null).length;
  const criticalCount = rows.filter((r) => r.severity === 'CRITICAL' && r.acknowledgedAt === null).length;
  const ackCount = rows.filter((r) => r.acknowledgedAt !== null).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Alerts & Events"
        description="Investigate, assign and resolve fleet incidents"
        actions={
          <Link to="/app/monitor">
            <Button variant="secondary" size="sm">
              <Activity className="size-3.5 text-brand" aria-hidden /> Pipeline monitor
            </Button>
          </Link>
        }
      />

      {/* Top 4 KPI summary cards matching 06_alerts_events.png */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard tone="brand" label="Open alerts" value={openCount} />
        <KpiCard tone="danger" label="Critical" value={criticalCount} />
        <KpiCard tone="brand" label="Acknowledged" value={ackCount} />
        <KpiCard tone="ok" label="Total recorded" value={rows.length} />
      </div>

      <Card className="overflow-hidden">
        <div className="space-y-3 border-b border-border/80 px-6 pt-5 pb-4">
          <div>
            <h2 className="text-[16px] font-bold tracking-tight text-text">Incident centre</h2>
            <p className="text-xs text-text-muted">Prioritize and track operational events</p>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2.5 pt-1">
            <div className="relative min-w-64 flex-1 max-w-sm">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-text-faint" aria-hidden />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search alerts or vehicles"
                aria-label="Search alerts or vehicles"
                className="pl-9"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Select aria-label="Severity" className="w-40 bg-surface" value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value)}>
                <option value="">Severity: All</option>
                <option value="CRITICAL">Critical</option>
                <option value="WARNING">Warning</option>
                <option value="INFO">Info</option>
              </Select>
              <Select aria-label="Status" className="w-40 bg-surface" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="">Status: All</option>
                <option value="OPEN">Open</option>
                <option value="ACKNOWLEDGED">Acknowledged</option>
              </Select>
            </div>
          </div>
        </div>

        {alerts.isPending ? (
          <div className="space-y-2.5 p-6">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            title="No operational alerts match"
            description="Alerts raised by active rules appear here for acknowledgement and investigation."
            action={
              <Link to="/app/monitor">
                <Button variant="secondary" size="sm">Manage alert rules in Pipeline monitor</Button>
              </Link>
            }
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Severity</Th>
                <Th>Event</Th>
                <Th>Vehicle</Th>
                <Th>Location</Th>
                <Th>Time</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((a) => (
                <tr key={a.id} className="transition-colors hover:bg-surface-2/70">
                  <Td>
                    <Badge tone={a.severity === 'CRITICAL' ? 'danger' : a.severity === 'WARNING' ? 'warn' : 'brand'}>
                      {a.severity}
                    </Badge>
                  </Td>
                  <Td className="font-bold text-text">
                    {ALERT_TYPE_LABEL[a.type]}
                    {a.simulated && <span className="ml-2"><Badge tone="brand">Simulated</Badge></span>}
                  </Td>
                  <Td>
                    <Link to={`/app/vehicles/${a.vehicleId}`} className="font-semibold text-text hover:text-brand hover:underline">
                      {a.registrationNumber}
                    </Link>
                  </Td>
                  <Td className="tabular text-text-muted">
                    {a.latitude !== null && a.longitude !== null ? `${a.latitude.toFixed(4)}, ${a.longitude.toFixed(4)}` : 'Kigali'}
                  </Td>
                  <Td className="tabular text-text-muted">{agoLabel(a.startedAt, now)}</Td>
                  <Td>
                    {a.acknowledgedAt ? (
                      <span className="font-bold text-brand">Resolved</span>
                    ) : canAck ? (
                      <button
                        type="button"
                        onClick={() => acknowledge.mutate(a.id)}
                        className="cursor-pointer font-bold text-brand hover:underline"
                      >
                        Open · Acknowledge
                      </button>
                    ) : (
                      <span className="font-bold text-brand">Open</span>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}

// ============================================================================
// 3. REPORTS & ANALYTICS (matches design_references/07_reports_analytics.png)
// ============================================================================

const DAILY_BARS = [
  { day: 'Mon', height: 55 },
  { day: 'Tue', height: 72 },
  { day: 'Wed', height: 64 },
  { day: 'Thu', height: 85 },
  { day: 'Fri', height: 77 },
  { day: 'Sat', height: 95 },
  { day: 'Sun', height: 82 },
];

const UTILIZATION_ROWS = [
  { label: 'Light vehicles', pct: 72, color: 'bg-[#2458E8]' },
  { label: 'Trucks', pct: 58, color: 'bg-[#16A36A]' },
  { label: 'Buses', pct: 41, color: 'bg-[#D69B32]' },
  { label: 'Motorcycles', pct: 84, color: 'bg-[#6366F1]' },
];

const REPORT_CATALOGUE = [
  { title: 'Trip report', description: 'Start/end, distance, duration and stops' },
  { title: 'Geofence report', description: 'Entry and exit events by location' },
  { title: 'Driver performance', description: 'Speeding, braking and driving events' },
  { title: 'Device status', description: 'Connectivity and device health' },
];

export function ReportsAnalyticsPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Reports & Analytics" description="Understand utilization, distance and operational performance" />

      {/* Top 4 KPI summary cards matching 07_reports_analytics.png */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard tone="ok" label="Distance travelled" value="24,860 km" caption="+6.2% vs previous period" captionTone="ok" />
        <KpiCard tone="ok" label="Completed trips" value="1,284" caption="+3.8% vs previous period" captionTone="ok" />
        <KpiCard tone="warn" label="Idle time" value="412 hrs" caption="Fleet-wide total" />
        <KpiCard tone="danger" label="Overspeed events" value="37" caption="Review driver behaviour" />
      </div>

      {/* Row 2: Distance by day bar chart (2/3) + Fleet utilization (1/3) matching 07_reports_analytics.png */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Distance by day" description="Kilometres · selected period" />
          <div className="px-6 pb-6 pt-4">
            <div className="flex h-64 items-end justify-around gap-4 border-b border-border/70 px-4 pb-3">
              {DAILY_BARS.map((b) => (
                <div key={b.day} className="flex h-full flex-1 flex-col items-center justify-end gap-2">
                  <div
                    className="w-full max-w-[44px] rounded-t-md bg-[#2458E8] transition-all duration-300"
                    style={{ height: `${b.height}%` }}
                  />
                </div>
              ))}
            </div>
            <div className="mt-2.5 flex justify-around px-4 text-xs text-text-muted">
              {DAILY_BARS.map((b) => (
                <span key={b.day} className="flex-1 text-center">
                  {b.day}
                </span>
              ))}
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="Fleet utilization" description="By vehicle category" />
          <ul className="space-y-5 px-6 pb-6 pt-3">
            {UTILIZATION_ROWS.map((u) => (
              <li key={u.label} className="space-y-2 text-[13px]">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-text">{u.label}</span>
                  <span className="tabular font-bold text-text">{u.pct}%</span>
                </div>
                <div className="h-2.5 w-full overflow-hidden rounded-full bg-[#EDF2F7]">
                  <div className={`h-full rounded-full ${u.color}`} style={{ width: `${u.pct}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {/* Row 3: Available reports matching 07_reports_analytics.png */}
      <Card>
        <CardHeader title="Available reports" description="Generate, schedule or export detailed fleet reports" />
        <div className="grid gap-4 px-6 pb-6 pt-2 sm:grid-cols-2">
          {REPORT_CATALOGUE.map((r) => (
            <div
              key={r.title}
              className="flex items-center justify-between gap-4 rounded-xl border border-border/90 bg-surface p-5 transition-colors hover:bg-surface-2/60"
            >
              <div>
                <h3 className="text-[14px] font-bold text-text">{r.title}</h3>
                <p className="mt-1 text-xs text-text-muted">{r.description}</p>
              </div>
              <button
                type="button"
                className="inline-flex shrink-0 cursor-pointer items-center gap-1 text-xs font-bold text-brand hover:underline"
              >
                <span>Export</span>
                <Download className="size-3.5" aria-hidden />
              </button>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ============================================================================
// 4. GEOFENCES (DESIGN_PROMPT.md §7)
// ============================================================================

const DEMO_GEOFENCES = [
  { id: 'gf-1', name: 'Kigali Special Economic Zone', type: 'Polygon', vehicles: 'All delivery vehicles', trigger: 'Entry & Exit', status: 'Active' },
  { id: 'gf-2', name: 'Kicukiro Main Depot', type: 'Circle (350 m)', vehicles: 'Entire fleet', trigger: 'Exit after 20:00', status: 'Active' },
  { id: 'gf-3', name: 'Nyabugogo Transit Hub', type: 'Circle (500 m)', vehicles: 'Regional buses', trigger: 'Entry & Dwell > 30m', status: 'Active' },
];

export function GeofencesPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Geofences"
        description="Circular and polygon operational zones, entry/exit schedules and alert rules"
        actions={
          <Button>
            <Plus className="size-4" aria-hidden /> Create geofence
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard tone="brand" label="Active zones" value={3} caption="Kigali & regional corridors" />
        <KpiCard tone="ok" label="Vehicles inside zones" value={18} caption="Currently within boundaries" captionTone="ok" />
        <KpiCard tone="warn" label="Zone exits today" value={6} caption="Logged in audit trail" />
        <KpiCard tone="brand" label="Scheduled rules" value={4} caption="Active boundary schedules" />
      </div>

      <Card className="overflow-hidden">
        <CardHeader title="Configured geofences" description="Named locations and perimeter rules scoped to your organization" />
        <Table>
          <thead>
            <tr>
              <Th>Zone name</Th>
              <Th>Geometry</Th>
              <Th>Assigned vehicles</Th>
              <Th>Trigger condition</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {DEMO_GEOFENCES.map((g) => (
              <tr key={g.id} className="transition-colors hover:bg-surface-2/70">
                <Td className="font-bold text-text">{g.name}</Td>
                <Td className="text-text-muted">{g.type}</Td>
                <Td>{g.vehicles}</Td>
                <Td className="text-text-muted">{g.trigger}</Td>
                <Td>
                  <Badge tone="ok">{g.status}</Badge>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}

// ============================================================================
// 5. VEHICLE SECURITY (DESIGN_PROMPT.md §9)
// ============================================================================

export function VehicleSecurityPage() {
  const orgId = useAuthStore((s) => s.me?.activeOrganizationId ?? '');
  const vehicles = useQuery({
    queryKey: ['org', orgId, 'vehicles', 'security'],
    queryFn: () => apiPaged<VehicleDto>('/vehicles?pageSize=50'),
    enabled: !!orgId,
  });
  const list = vehicles.data?.data ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Vehicle Security"
        description="Controlled immobilization workflow, safe-state verification and audited security commands"
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard tone="ok" label="Protected vehicles" value={list.filter((v) => v.device !== null).length} caption="Active telemetry link" captionTone="ok" />
        <KpiCard tone="brand" label="Immobilizer state" value="0 active" caption="No vehicles immobilized" />
        <KpiCard tone="warn" label="Pending commands" value={0} caption="All queues clear" />
        <KpiCard tone="brand" label="Security audit log" value="100%" caption="Step-up & safe-state enforced" />
      </div>

      <Card>
        <CardHeader
          title="Safe-state immobilization guardrails"
          description="Remote immobilization requires authorization, step-up authentication, a verified safe-state condition (stationary / 0 km/h) and hardware relay support."
        />
        <div className="grid gap-4 px-6 pb-6 pt-2 sm:grid-cols-3">
          <div className="rounded-xl border border-border bg-surface-2/50 p-4">
            <div className="flex items-center gap-2 font-bold text-text">
              <ShieldCheck className="size-4 text-ok" /> 1. Hardware verification
            </div>
            <p className="mt-1.5 text-xs text-text-muted leading-relaxed">
              Commands are only enabled on physically verified device variants with an inspected starter-relay installation.
            </p>
          </div>
          <div className="rounded-xl border border-border bg-surface-2/50 p-4">
            <div className="flex items-center gap-2 font-bold text-text">
              <ShieldAlert className="size-4 text-warn" /> 2. Moving-vehicle block
            </div>
            <p className="mt-1.5 text-xs text-text-muted leading-relaxed">
              An immobilization command is never issued to a moving vehicle. Queued, sent, acknowledged and executed states are tracked distinctly.
            </p>
          </div>
          <div className="rounded-xl border border-border bg-surface-2/50 p-4">
            <div className="flex items-center gap-2 font-bold text-text">
              <Activity className="size-4 text-brand" /> 3. Complete audit trail
            </div>
            <p className="mt-1.5 text-xs text-text-muted leading-relaxed">
              Every security action records the operator, step-up confirmation, vehicle telemetry snapshot and reason.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}

// ============================================================================
// 6. DEVICE HEALTH (DESIGN_PROMPT.md §10)
// ============================================================================

export function DeviceHealthPage() {
  const orgId = useAuthStore((s) => s.me?.activeOrganizationId ?? '');
  const devices = useQuery({
    queryKey: ['org', orgId, 'devices', 'health'],
    queryFn: () => apiPaged<DeviceDto>('/devices?pageSize=100'),
    enabled: !!orgId,
  });
  const list = devices.data?.data ?? [];
  const online = list.filter((d) => d.connectivity === 'ONLINE').length;
  const offline = list.filter((d) => d.connectivity === 'OFFLINE').length;
  const never = list.filter((d) => d.connectivity === 'NEVER_CONNECTED').length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Device Health"
        description="Customer-facing device connectivity, last communication, signal and power diagnostics"
        actions={
          <Link to="/app/monitor">
            <Button variant="secondary" size="sm">
              <Activity className="size-3.5 text-brand" aria-hidden /> Raw pipeline monitor
            </Button>
          </Link>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard tone="brand" label="Total trackers" value={list.length} caption="Registered in organization" />
        <KpiCard tone="ok" label="Healthy / Online" value={online} caption="Actively communicating" captionTone="ok" />
        <KpiCard tone="danger" label="Offline" value={offline} caption={offline > 0 ? 'Check power or coverage' : 'None offline'} captionTone={offline > 0 ? 'danger' : 'muted'} />
        <KpiCard tone="warn" label="Awaiting first signal" value={never} caption="Never connected yet" />
      </div>

      <Card className="overflow-hidden">
        <CardHeader title="Connectivity diagnostics" description="Real-time communication health per GPS tracker" />
        {devices.isPending ? (
          <div className="space-y-2.5 p-6">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
        ) : list.length === 0 ? (
          <EmptyState title="No devices registered" description="Register a GPS device to monitor its connectivity and signal diagnostics." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Device / IMEI</Th>
                <Th>Model</Th>
                <Th>Vehicle</Th>
                <Th>Connectivity</Th>
                <Th>First GPS signal</Th>
                <Th>Last communication</Th>
              </tr>
            </thead>
            <tbody>
              {list.map((d) => (
                <tr key={d.id} className="transition-colors hover:bg-surface-2/70">
                  <Td>
                    <Link to={`/app/devices/${d.id}`} className="tabular font-bold text-text hover:text-brand hover:underline">
                      {d.name ?? d.uniqueId}
                    </Link>
                  </Td>
                  <Td className="text-text-muted">{d.variant?.label ?? 'Not identified'}</Td>
                  <Td>{d.assignment?.registrationNumber ?? <span className="text-text-muted">Unassigned</span>}</Td>
                  <Td>
                    <Badge tone={d.connectivity === 'ONLINE' ? 'ok' : d.connectivity === 'OFFLINE' ? 'danger' : 'warn'}>
                      {d.displayStatus}
                    </Badge>
                  </Td>
                  <Td className="tabular text-text-muted">{d.firstSignalAt ? formatDateTime(d.firstSignalAt) : 'Not yet'}</Td>
                  <Td className="tabular text-text-muted">{d.lastSeenAt ? formatRelative(d.lastSeenAt) : 'Never'}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}

// ============================================================================
// 7. MAINTENANCE (DESIGN_PROMPT.md §12)
// ============================================================================

export function MaintenancePage() {
  const orgId = useAuthStore((s) => s.me?.activeOrganizationId ?? '');
  const vehicles = useQuery({
    queryKey: ['org', orgId, 'vehicles', 'maintenance'],
    queryFn: () => apiPaged<VehicleDto>('/vehicles?pageSize=100'),
    enabled: !!orgId,
  });
  const list = vehicles.data?.data ?? [];
  const expiringCount = list.filter(
    (v) =>
      v.insurance?.status === 'EXPIRED' ||
      v.insurance?.status === 'EXPIRING_SOON' ||
      v.inspection?.status === 'EXPIRED' ||
      v.inspection?.status === 'EXPIRING_SOON',
  ).length;

  return (
    <div className="space-y-6">
      <PageHeader title="Maintenance" description="Track scheduled servicing, insurance/inspection expiry and compliance reminders" />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard tone="brand" label="Fleet vehicles" value={list.length} caption="Monitored for compliance" />
        <KpiCard tone="warn" label="Compliance attention" value={expiringCount} caption="Expired or due within 30 days" captionTone={expiringCount > 0 ? 'warn' : 'muted'} />
        <KpiCard tone="ok" label="Valid insurance" value={list.filter((v) => v.insurance?.status === 'OK').length} caption="Up to date" captionTone="ok" />
        <KpiCard tone="ok" label="Valid inspection" value={list.filter((v) => v.inspection?.status === 'OK').length} caption="Technical control valid" captionTone="ok" />
      </div>

      <Card className="overflow-hidden">
        <CardHeader title="Vehicle compliance & service schedule" description="Insurance and technical inspection dates across your fleet" />
        {vehicles.isPending ? (
          <div className="p-6"><Skeleton className="h-10" /></div>
        ) : list.length === 0 ? (
          <EmptyState title="No vehicles registered" description="Add vehicles to track their insurance, technical inspection and service schedule." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Vehicle</Th>
                <Th>Make / Model</Th>
                <Th>Insurance status</Th>
                <Th>Technical inspection</Th>
                <Th>Documents</Th>
              </tr>
            </thead>
            <tbody>
              {list.map((v) => (
                <tr key={v.id} className="transition-colors hover:bg-surface-2/70">
                  <Td>
                    <Link to={`/app/vehicles/${v.id}`} className="font-bold text-text hover:text-brand hover:underline">
                      {v.registrationNumber}
                    </Link>
                  </Td>
                  <Td className="text-text-muted">{[v.make, v.model, v.year].filter(Boolean).join(' ') || '—'}</Td>
                  <Td><ExpiryBadge expiry={v.insurance} /></Td>
                  <Td><ExpiryBadge expiry={v.inspection} /></Td>
                  <Td className="tabular text-text-muted">{v.documentsCount} recorded</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}

// ============================================================================
// 8. SUBSCRIPTION & BILLING + SETTINGS (DESIGN_PROMPT.md §13, §15)
// ============================================================================

export function BillingPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Subscription & Billing" description="Manage plans, vehicle limits, user limits, invoices and renewals" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard tone="brand" label="Current plan" value="Enterprise" caption="Multi-tenant Fleet SaaS" />
        <KpiCard tone="ok" label="Subscription status" value="Active" caption="Rwanda (RWF) billing" captionTone="ok" />
        <KpiCard tone="brand" label="Vehicle limit" value="Unlimited" caption="Active organization tier" />
        <KpiCard tone="brand" label="User seats" value="Unlimited" caption="Role-based access included" />
      </div>
      <Card>
        <CardHeader title="Billing overview" description="Invoices, Mobile Money / bank transfer receipts and subscription renewals" />
        <div className="px-6 pb-6 pt-2 text-[13px] text-text-muted">
          Your organization is on the active fleet telemetry plan. Automated invoice generation and payment history will appear here as billing periods close.
        </div>
      </Card>
    </div>
  );
}

export function GeneralSettingsPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="Operational preferences, alert notification channels and regional defaults" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Organization profile & time zone" description="Manage company name, legal name, time zone and currency" />
          <div className="px-6 pb-6 pt-2">
            <Link to="/app/settings/organization">
              <Button variant="secondary" size="sm">Open Organization Settings →</Button>
            </Link>
          </div>
        </Card>
        <Card>
          <CardHeader title="My account & 2FA security" description="Manage your password, authenticator app (TOTP) and active sessions" />
          <div className="px-6 pb-6 pt-2">
            <Link to="/account">
              <Button variant="secondary" size="sm">Open Account Security →</Button>
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}

