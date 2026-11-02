import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { P, VEHICLE_STATUSES, type AttentionItemDto, type DashboardDto, type OrganizationDto, type StatusSummaryDto } from '@gps/shared';
import { Badge, Button, Card, CardHeader, EmptyState, PageHeader, Skeleton } from '@/components/ui/primitives';
import { attentionHref, expiryText, formatDay } from '@/features/fleet/fleet-model';
import { QueryError } from '@/features/fleet/fleet-ui';
import { ALERT_TYPE_LABEL } from '@/features/monitor/monitor-model';
import { StatusBadge } from '@/features/monitor/status-badge';
import { formatDateTime } from '@/lib/utils';
import { api } from '@/lib/api';
import { hasPermission, useAuthStore } from '@/lib/auth-store';
import { roleLabel } from '@/lib/i18n';
import { activeMembership } from '@/lib/session';

/**
 * Real numbers only. Everything here is a count of records the organization has entered or a fact the platform
 * observed. Distance, utilisation, trips and notifications are not shown because they do not exist yet.
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

  const org = useQuery({ queryKey: ['org', orgId], queryFn: () => api<OrganizationDto>(`/organizations/${orgId}`), enabled: !!orgId });
  const dash = useQuery({ queryKey: dashboardKey(orgId), queryFn: () => api<DashboardDto>('/dashboard'), enabled: !!orgId && canReadVehicles });

  return (
    <>
      <PageHeader title="Dashboard" description={membership ? membership.organization.name : undefined} />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {!canReadVehicles ? (
            <Card><EmptyState title="Your role cannot see fleet numbers" description="Ask an administrator for access to vehicles if you need them here." /></Card>
          ) : dash.isPending ? (
            <Card><div className="space-y-3 p-5"><Skeleton className="h-6 w-48" /><Skeleton className="h-24" /></div></Card>
          ) : dash.isError ? (
            <Card><QueryError query={dash} what="the dashboard" /></Card>
          ) : dash.data.vehicles.total === 0 && (dash.data.drivers?.total ?? 0) === 0 ? (
            <Card>
              <CardHeader title="Fleet" />
              <EmptyState
                title="Your fleet is empty"
                description="Add your vehicles and drivers. Once a tracker is installed on a vehicle you can follow it on the live map."
                action={canCreateVehicle ? <Link to="/app/vehicles"><Button>Add your first vehicle</Button></Link> : undefined}
              />
            </Card>
          ) : (
            <>
              <FleetCard data={dash.data} />
              {dash.data.status && <StatusCard status={dash.data.status} />}
              <AttentionCard data={dash.data} />
            </>
          )}
        </div>

        <div className="space-y-4">
          {dash.data?.alerts && (
            <Card>
              <CardHeader title="Alerts" />
              <div className="px-5 py-4 text-[13px]">
                <p className="tabular text-2xl font-semibold">{dash.data.alerts.unacknowledged}</p>
                <p className="text-text-muted">{dash.data.alerts.unacknowledged === 1 ? 'alert waiting to be acknowledged' : 'alerts waiting to be acknowledged'}</p>
              </div>
              {dash.data.alerts.recent.length > 0 && (
                <ul className="divide-y divide-border border-t border-border" aria-label="Latest alerts">
                  {dash.data.alerts.recent.map((a) => (
                    <li key={a.id} className="px-5 py-2.5 text-[13px]">
                      <div className="flex items-center justify-between gap-2">
                        <Link to={`/app/vehicles/${a.vehicleId}`} className="font-medium text-brand hover:underline">{a.registrationNumber}</Link>
                        {a.simulated && <Badge tone="warn">Simulated</Badge>}
                      </div>
                      <p className="text-text-muted">
                        {ALERT_TYPE_LABEL[a.type]} · {formatDateTime(a.startedAt, timezone)}
                        {a.acknowledgedAt ? ' · acknowledged' : ''}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
          <Card>
            <CardHeader title="Your organization" />
            <dl className="space-y-3 px-5 py-4 text-[13px]">
              {org.isPending ? (
                <Skeleton className="h-16 w-full" />
              ) : org.data ? (
                <>
                  <Row label="Name" value={org.data.name} />
                  <Row label="Time zone" value={org.data.timezone} />
                  <Row label="Currency" value={org.data.currencyCode} />
                  <Row label="Your role" value={membership?.roleKeys.map(roleLabel).join(', ') || '—'} />
                </>
              ) : (
                <p className="text-text-muted">Organization details are unavailable right now.</p>
              )}
            </dl>
            {hasPermission(me, P.USERS_INVITE) && (
              <div className="border-t border-border px-5 py-3 text-[13px]">
                <Link to="/app/settings/users" className="text-brand underline">Invite your team</Link>
              </div>
            )}
          </Card>
          <Card>
            <div className="px-5 py-4 text-[13px] text-text-muted">
              <p className="font-medium text-text">Not available yet</p>
              <p className="mt-1">Distance, trips and usage figures arrive with trip history, and notifications with the notifications milestone. They are not shown here until they are real.</p>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

/** Live status of vehicles that have a tracker: the same derivation as the map, with the map's labels and shapes. */
function StatusCard({ status }: { status: StatusSummaryDto }) {
  const shown = VEHICLE_STATUSES.filter((s) => status.byStatus[s] > 0 || s === 'MOVING' || s === 'OFFLINE');
  return (
    <Card>
      <CardHeader title="Vehicle status now" description="Vehicles with a tracker, by what they last reported." />
      {status.total === 0 ? (
        <EmptyState title="No trackers installed" description="Status appears here once a tracker is installed on a vehicle." />
      ) : (
        <ul className="flex flex-wrap gap-x-6 gap-y-3 px-5 py-4">
          {shown.map((s) => (
            <li key={s} className="text-[13px]">
              <StatusBadge status={s} />
              <p className="tabular mt-1 text-xl font-semibold">{status.byStatus[s]}</p>
            </li>
          ))}
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
      <div className="grid gap-px bg-border sm:grid-cols-3">
        <Stat title="Vehicles" to="/app/vehicles" total={vehicles.total} lines={[[`${vehicles.withDevice} with a tracker`], [`${vehicles.withoutDevice} without`]]} />
        {drivers ? (
          <Stat title="Drivers" to="/app/drivers" total={drivers.total} lines={[[`${drivers.active} active`], [`${drivers.assigned} assigned to a vehicle`]]} />
        ) : (
          <div className="bg-surface" />
        )}
        {devices ? (
          <Stat
            title="Trackers"
            total={devices.total}
            lines={[[`${devices.installed} installed`], [`${devices.notInstalled} not installed`], devices.installedNeverReported > 0 ? [`${devices.installedNeverReported} installed, never reported`, 'warn'] : []]}
          />
        ) : (
          <div className="bg-surface" />
        )}
      </div>
      {vehicles.byCategory.length > 1 || (vehicles.byCategory.length === 1 && vehicles.byCategory[0]!.id !== null) ? (
        <div className="border-t border-border px-5 py-3">
          <h3 className="mb-2 text-xs font-semibold text-text-muted">Vehicles by category</h3>
          <ul className="flex flex-wrap gap-2">
            {vehicles.byCategory.map((c) => (
              <li key={c.id ?? 'none'}><Badge>{c.name} · <span className="tabular">{c.count}</span></Badge></li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}

function Stat({ title, total, lines, to }: { title: string; total: number; lines: ([string] | [string, 'warn'] | [])[]; to?: string }) {
  return (
    <div className="bg-surface px-5 py-4 text-[13px]">
      <p className="text-text-muted">{to ? <Link to={to} className="hover:text-text hover:underline">{title}</Link> : title}</p>
      <p className="tabular mt-1 text-2xl font-semibold">{total}</p>
      <ul className="mt-2 space-y-0.5 text-text-muted">
        {lines.filter((l) => l.length > 0).map((l, i) => (
          <li key={i} className={l[1] === 'warn' ? 'text-warn' : undefined}>{l[0]}</li>
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
        <ul className="divide-y divide-border">
          {data.attention.map((i, n) => (
            <li key={`${i.kind}-${i.subject.id}-${n}`} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5 text-[13px]">
              <div className="min-w-0">
                <Link to={attentionHref(i)} className="font-medium text-brand hover:underline">{i.subject.label}</Link>
                <span className="text-text-muted"> · {i.title}</span>
              </div>
              <span className="inline-flex items-center gap-2">
                {i.date && <span className="tabular text-text-muted">{formatDay(i.date)}</span>}
                <SeverityBadge item={i} />
              </span>
            </li>
          ))}
        </ul>
      )}
      {hidden > 0 && <p className="border-t border-border px-5 py-2.5 text-xs text-text-muted">and {hidden} more</p>}
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
    <div className="flex justify-between gap-4">
      <dt className="text-text-muted">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}
