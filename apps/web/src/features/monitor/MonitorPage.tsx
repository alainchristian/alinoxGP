import { useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import {
  P,
  VEHICLE_STATUSES,
  type AlertDto,
  type AlertRuleDto,
  type VehicleStatus,
} from '@gps/shared';
import { Alert, Badge, Button, Card, CardHeader, EmptyState, Input, PageHeader, Skeleton, Table, Td, Th } from '@/components/ui/primitives';
import { ApiError, api, apiPaged } from '@/lib/api';
import { hasPermission, useAuthStore } from '@/lib/auth-store';
import { cn } from '@/lib/utils';
import {
  ALERT_TYPE_LABEL,
  STATUS_META,
  agoLabel,
  clockLabel,
  coordinatesLabel,
  ignitionLabel,
  isReceiving,
  pushLog,
  speedLabel,
  visibleRows,
  type LogEntry,
  type VehicleRow,
} from './monitor-model';
import { useLiveFleet } from '../live/useLiveFleet';
import { useNow } from '../live/use-now';
import { StatusBadge, STATUS_ICON } from './status-badge';
import type { ConnectionState } from './useLiveFeed';

const CONNECTION_COPY: Record<ConnectionState, { label: string; className: string }> = {
  connecting: { label: 'Connecting…', className: 'bg-[#EDF2F7] text-[#718096]' },
  live: { label: 'Live', className: 'bg-[#E6F7F0] text-[#16A36A]' },
  reconnecting: { label: 'Reconnecting…', className: 'bg-[#FEF6E6] text-[#B7791F]' },
  refused: { label: 'Disconnected', className: 'bg-[#FDEEEE] text-[#DC5555]' },
};

function absolute(iso: string | null, timeZone: string): string {
  return iso ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'short', timeStyle: 'medium', hour12: false, timeZone }).format(new Date(iso)) : 'No value';
}

function describeError(err: unknown): string {
  if (err instanceof ApiError && err.status === 403) return 'You do not have permission to see this.';
  return 'This could not be loaded right now.';
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader title={title} description={description} />
      {children}
    </Card>
  );
}

/**
 * Diagnostics page for the position pipeline (Milestone 3a). It shows, live, exactly what the position pipeline holds for the active
 * organization: REST snapshot first, then pushed deltas over the same Socket.IO feed the real map will use.
 * The live map is the Live tracking page (M4); this page stays as the place to inspect the raw feed, alert rules and thresholds.
 */
export function MonitorPage() {
  const orgId = useAuthStore((s) => s.me?.activeOrganizationId ?? null);
  // Keyed by organization: when the user switches organization the whole page remounts, so nothing of the previous tenant survives.
  return <MonitorView key={orgId ?? 'none'} />;
}

function MonitorView() {
  const now = useNow();
  const [log, setLog] = useState<LogEntry[]>([]);
  const fleet = useLiveFleet({
    onEvent: (kind, text) => {
      if (kind === 'alert') return; // logged below with a readable alert name
      setLog((l) => pushLog(l, kind, text));
    },
    onAlert: (a) => setLog((l) => pushLog(l, 'alert', `Alert: ${ALERT_TYPE_LABEL[a.type]} on ${a.registrationNumber}`)),
  });
  const { me, orgId, queryClient, timeZone, rows, total, positions, summary, config, feed } = fleet;

  const canAlerts = hasPermission(me, P.ALERTS_READ);
  const canAck = hasPermission(me, P.ALERTS_ACKNOWLEDGE);
  const canRules = hasPermission(me, P.ALERT_RULES_MANAGE);

  const alerts = useQuery({
    queryKey: ['alerts', 'monitor', orgId],
    queryFn: () => apiPaged<AlertDto>('/alerts?page=1&pageSize=8'),
    enabled: !!orgId && canAlerts,
    refetchInterval: 15_000,
  });
  const rules = useQuery({ queryKey: ['rules', 'monitor', orgId], queryFn: () => api<AlertRuleDto[]>('/alert-rules'), enabled: !!orgId && canAlerts });

  const [statusFilter, setStatusFilter] = useState<VehicleStatus | null>(null);
  const [query, setQuery] = useState('');

  const shown = useMemo(() => visibleRows(rows, { status: statusFilter, query }), [rows, statusFilter, query]);
  const counts = summary.data?.byStatus;

  // ---------------------------------------------------------------- actions
  const addDemoRules = useMutation({
    mutationFn: async () => {
      await api('/alert-rules', { method: 'POST', body: { type: 'OVERSPEED', params: { speedLimitKmh: 37, minDurationSec: 5 }, severity: 'WARNING', cooldownSeconds: 60 } });
      await api('/alert-rules', { method: 'POST', body: { type: 'DEVICE_OFFLINE', params: {}, severity: 'CRITICAL', cooldownSeconds: 60 } });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['rules', 'monitor'] }),
  });
  const acknowledge = useMutation({
    mutationFn: (id: string) => api(`/alerts/${id}/acknowledge`, { method: 'PATCH' }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['alerts'] }),
  });

  const connection = CONNECTION_COPY[feed.connection];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pipeline monitor"
        description="Diagnostics for the position pipeline (Milestone 3a): what the platform holds for this organization, the raw live feed, alert rules and the thresholds in force. The map is under Live tracking."
        actions={
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs" role="status" aria-live="polite">
            <span className={cn('inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-semibold', connection.className)}>
              <span aria-hidden className={cn('size-2 rounded-full bg-current', feed.connection === 'live' && 'animate-live-pulse')} />
              {connection.label}
            </span>
            <span className="text-text-muted">
              Tracking engine: {feed.engineConnected === null ? 'waiting for status' : feed.engineConnected ? 'connected' : 'unavailable'}
            </span>
            <span className="text-text-muted tabular-nums">
              Live messages received: {feed.messages}
              {feed.lastMessageAt ? ` · last ${agoLabel(new Date(feed.lastMessageAt).toISOString(), now)}` : ''}
            </span>
          </div>
        }
      />

      {feed.connection === 'refused' && <div><Alert tone="danger">The live connection was closed by the server. Reload the page or sign in again.</Alert></div>}
      {feed.engineConnected === false && <div><Alert tone="warn">The tracking engine is unavailable. Positions below may be out of date until it reconnects.</Alert></div>}

      {/* Status counts: from the API (one shared status function), not computed here. */}
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by status">
        <button
          type="button"
          aria-pressed={statusFilter === null}
          onClick={() => setStatusFilter(null)}
          className={cn(
            'inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-[10px] border px-3.5 text-[13px] transition-all duration-150',
            statusFilter === null
              ? 'border-[#B8CEFF] bg-[#EEF3FF] font-bold text-[#2458E8]'
              : 'border-border bg-surface font-medium text-text hover:bg-surface-2',
          )}
        >
          All <span className={cn('ml-0.5 tabular-nums font-bold', statusFilter === null ? 'text-[#2458E8]' : 'text-text-muted')}>{summary.data ? summary.data.total : '—'}</span>
        </button>
        {VEHICLE_STATUSES.map((s) => {
          const Icon = STATUS_ICON[s];
          const active = statusFilter === s;
          return (
            <button
              key={s}
              type="button"
              aria-pressed={active}
              title={STATUS_META[s].hint}
              onClick={() => setStatusFilter(active ? null : s)}
              className={cn(
                'inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-[10px] border px-3.5 text-[13px] transition-all duration-150',
                active
                  ? 'border-[#B8CEFF] bg-[#EEF3FF] font-bold text-[#2458E8]'
                  : 'border-border bg-surface font-medium text-text hover:bg-surface-2',
              )}
            >
              <Icon className="size-3.5" aria-hidden />
              {STATUS_META[s].label}
              <span className={cn('ml-0.5 tabular-nums font-bold', active ? 'text-[#2458E8]' : 'text-text-muted')}>{counts ? counts[s] : '—'}</span>
            </button>
          );
        })}
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-3">
        <Card className="overflow-hidden lg:col-span-2">
          <CardHeader
            title="Vehicles"
            description="Latest known state per vehicle. Unknown values are shown as Unknown or —, never as 0 or Off."
            action={
              <div className="relative w-56">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-faint" aria-hidden />
                <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search registration" aria-label="Search by registration number" className="h-9 pl-9 text-xs" />
              </div>
            }
          />
          {positions.isPending ? (
            <div className="space-y-2.5 p-6">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : positions.isError ? (
            <div className="p-6">
              <Alert tone="danger">{describeError(positions.error)}</Alert>
              <Button className="mt-3" variant="secondary" size="sm" onClick={() => void positions.refetch()}>Try again</Button>
            </div>
          ) : rows.size === 0 ? (
            <EmptyState
              title="No vehicle has reported yet"
              description="Vehicles appear here as soon as a registered GPS device sends its first position. For a demo, run the simulator: pnpm sim fleet --count 6 --interval 5 --duration 1800 (organization must be a sandbox)."
            />
          ) : shown.length === 0 ? (
            <EmptyState title="No vehicle matches" description="Clear the search or the status filter to see all vehicles." action={<Button variant="secondary" size="sm" onClick={() => { setQuery(''); setStatusFilter(null); }}>Clear filters</Button>} />
          ) : (
            <>
              <Table>
                <caption className="sr-only">Vehicles with their latest known state</caption>
                <thead>
                  <tr>
                    <Th>Vehicle</Th>
                    <Th>Status</Th>
                    <Th className="text-right">Speed (km/h)</Th>
                    <Th>Ignition</Th>
                    <Th>Position</Th>
                    <Th>Last fix</Th>
                    <Th>Last message</Th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <VehicleTableRow key={r.vehicleId} row={r} now={now} timeZone={timeZone} />
                  ))}
                </tbody>
              </Table>
              {total > rows.size && <p className="border-t border-border/70 px-6 py-3 text-xs font-medium text-text-muted">Showing the {rows.size} most recently active of {total} vehicles.</p>}
            </>
          )}
        </Card>

        <div className="space-y-6">
          {canAlerts && (
            <Section title="Alerts" description="Most recent first. Raised only where an alert rule exists.">
              {alerts.isPending ? (
                <Skeleton className="m-6 h-16" />
              ) : alerts.isError ? (
                <div className="p-6"><Alert tone="danger">{describeError(alerts.error)}</Alert></div>
              ) : alerts.data.data.length === 0 ? (
                <EmptyState title="No alerts" description={rules.data && rules.data.length > 0 ? 'Nothing has triggered a rule yet.' : 'There are no alert rules, so no alerts are raised. Add the demo rules below to see some.'} />
              ) : (
                <ul className="divide-y divide-border/60">
                  {alerts.data.data.map((a) => (
                    <li key={a.id} className="flex items-start justify-between gap-3 px-6 py-3.5 text-[13px]">
                      <div>
                        <p className="font-bold text-text">
                          {ALERT_TYPE_LABEL[a.type]} <span className="font-normal text-text-muted">· {a.registrationNumber}</span>
                        </p>
                        <p className="mt-0.5 text-xs text-text-muted" title={absolute(a.startedAt, timeZone)}>{agoLabel(a.startedAt, now)}</p>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          <Badge tone={a.severity === 'CRITICAL' ? 'danger' : a.severity === 'WARNING' ? 'warn' : 'neutral'}>{a.severity.toLowerCase()}</Badge>
                          {a.simulated && <Badge tone="brand">Simulated</Badge>}
                          {a.delayed && <Badge tone="warn">Delayed data</Badge>}
                        </div>
                      </div>
                      {a.acknowledgedAt ? (
                        <span className="text-xs font-medium text-text-muted">Acknowledged</span>
                      ) : (
                        canAck && <Button size="sm" variant="secondary" loading={acknowledge.isPending && acknowledge.variables === a.id} onClick={() => acknowledge.mutate(a.id)}>Acknowledge</Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          )}

          <Section title="Live feed" description="What arrives over the socket, newest first.">
            {log.length === 0 ? (
              <p className="px-6 py-4 text-[13px] text-text-muted">Waiting for the first live update…</p>
            ) : (
              <ul className="max-h-72 divide-y divide-border/60 overflow-y-auto">
                {log.map((e) => (
                  <li key={e.id} className="flex gap-3 px-6 py-2.5 text-xs">
                    <span className="shrink-0 tabular-nums text-text-faint">{clockLabel(e.at, timeZone)}</span>
                    <span className={cn(e.kind === 'alert' && 'font-semibold text-danger', e.kind === 'engine' && 'font-medium text-warn')}>{e.text}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {canAlerts && (
            <Section title="Alert rules">
              {rules.isPending ? (
                <Skeleton className="m-6 h-12" />
              ) : rules.isError ? (
                <div className="p-6"><Alert tone="danger">{describeError(rules.error)}</Alert></div>
              ) : rules.data.length === 0 ? (
                <EmptyState
                  title="No alert rules"
                  description="Without a rule nothing is alerted. Default rules arrive with notifications (M8)."
                  action={
                    canRules ? (
                      <Button size="sm" loading={addDemoRules.isPending} onClick={() => addDemoRules.mutate()}>
                        Add demo rules (overspeed over 37 km/h for 5 s, device offline)
                      </Button>
                    ) : undefined
                  }
                />
              ) : (
                <ul className="divide-y divide-border/60">
                  {rules.data.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-3 px-6 py-3 text-[13px]">
                      <span className="font-medium text-text">
                        {ALERT_TYPE_LABEL[r.type]}
                        {r.type === 'OVERSPEED' && typeof r.params['speedLimitKmh'] === 'number' ? ` over ${r.params['speedLimitKmh']} km/h` : ''}
                      </span>
                      <span className="text-xs font-medium text-text-muted">{r.enabled ? `cooldown ${r.cooldownSeconds} s` : 'disabled'}</span>
                    </li>
                  ))}
                </ul>
              )}
              {addDemoRules.isError && <div className="px-6 pb-4"><Alert tone="danger">{describeError(addDemoRules.error)}</Alert></div>}
            </Section>
          )}

          <Section title="Thresholds in force" description="From the server; nothing is hard-coded in this page.">
            {config.data ? (
              <dl className="divide-y divide-border/50 px-6 pb-4 text-[13px]">
                <Row label="Offline after" value={`${config.data.thresholds.offlineAfterSec} s without a message`} />
                <Row label="Moving from" value={`${config.data.thresholds.movingSpeedKmh} km/h`} />
                <Row label="Idling after" value={`${config.data.thresholds.idleAfterSec} s stopped, ignition on`} />
                <Row label="Parked after" value={`${config.data.thresholds.parkedAfterSec} s stopped, ignition unknown`} />
              </dl>
            ) : config.isError ? (
              <p className="px-6 py-4 text-[13px] text-text-muted">Thresholds are unavailable right now.</p>
            ) : (
              <Skeleton className="m-6 h-16" />
            )}
          </Section>

        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 py-2.5">
      <dt className="text-text-muted">{label}</dt>
      <dd className="text-right font-semibold text-text tabular-nums">{value}</dd>
    </div>
  );
}

function VehicleTableRow({ row, now, timeZone }: { row: VehicleRow; now: number; timeZone: string }) {
  const receiving = isReceiving(row.lastSeenAt, now);
  return (
    <tr className="transition-colors hover:bg-surface-2/70">
      <Td className="font-bold text-text">
        <span className="inline-flex items-center gap-2">
          <span
            aria-hidden
            title={receiving ? 'Receiving data now' : undefined}
            className={cn('size-2 rounded-full', receiving ? 'bg-status-moving animate-live-pulse' : 'bg-transparent')}
          />
          {row.registrationNumber}
        </span>
        {(row.simulated || row.lastFixDelayed || row.lastFixInvalid) && (
          <span className="mt-1 flex flex-wrap gap-1 pl-4 font-normal">
            {row.simulated && <Badge tone="brand">Simulated</Badge>}
            {row.lastFixDelayed && <Badge tone="warn">Delayed</Badge>}
            {row.lastFixInvalid && <Badge tone="warn">No fix</Badge>}
          </span>
        )}
      </Td>
      <Td><StatusBadge status={row.status} /></Td>
      <Td className="text-right font-semibold tabular-nums">{speedLabel(row.speedKmh)}</Td>
      <Td>{ignitionLabel(row.ignition)}</Td>
      <Td className="whitespace-nowrap tabular-nums text-text-muted">{coordinatesLabel(row.latitude, row.longitude)}</Td>
      <Td className="whitespace-nowrap text-text-muted" title={absolute(row.lastFixAt, timeZone)}>{agoLabel(row.lastFixAt, now)}</Td>
      <Td className="whitespace-nowrap text-text-muted" title={absolute(row.lastSeenAt, timeZone)}>{agoLabel(row.lastSeenAt, now)}</Td>
    </tr>
  );
}
