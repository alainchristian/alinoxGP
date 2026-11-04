import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { P, type DeviceDto } from '@gps/shared';
import { Button, Card, EmptyState, KpiCard, PageHeader, Skeleton, Table, Td, Th } from '@/components/ui/primitives';
import { isSimulatedDevice, QueryError, SimulatedBadge } from '@/features/fleet/fleet-ui';
import { apiPaged } from '@/lib/api';
import { hasPermission, useAuthStore } from '@/lib/auth-store';
import { formatDateTime, formatRelative } from '@/lib/utils';
import { displayStatusTone } from './device-model';

export const devicesKey = (orgId: string) => ['org', orgId, 'devices'];

/**
 * GPS Devices page matching design_references/04_gps_devices.png:
 * 4 KPI summary cards on top + Device inventory card with status dot + colored status label.
 * Remounts when the active organization changes, so nothing of the previous tenant survives in state.
 */
export function DevicesPage() {
  const orgId = useAuthStore((s) => s.me?.activeOrganizationId ?? null);
  return <DevicesView key={orgId ?? 'none'} orgId={orgId ?? ''} />;
}

const STATUS_DOT_CLASSES = {
  ok: { dot: 'bg-[#16A36A]', text: 'text-[#16A36A]' },
  warn: { dot: 'bg-[#D69B32]', text: 'text-[#B7791F]' },
  danger: { dot: 'bg-[#DC5555]', text: 'text-[#DC5555]' },
  brand: { dot: 'bg-[#2458E8]', text: 'text-[#2458E8]' },
  neutral: { dot: 'bg-[#94A3B8]', text: 'text-[#718096]' },
} as const;

function DevicesView({ orgId }: { orgId: string }) {
  const me = useAuthStore((s) => s.me);
  const canRegister = hasPermission(me, P.DEVICES_REGISTER);
  const timezone = me?.memberships.find((m) => m.organization.id === orgId)?.organization.timezone;
  const devices = useQuery({ queryKey: [...devicesKey(orgId), 'list'], queryFn: () => apiPaged<DeviceDto>('/devices?pageSize=100'), enabled: !!orgId });

  const list = devices.data?.data ?? [];
  const totalCount = devices.data?.meta.total ?? 0;
  const onlineCount = list.filter((d) => d.connectivity === 'ONLINE').length;
  const offlineCount = list.filter((d) => d.connectivity === 'OFFLINE').length;
  const notInstalledCount = list.filter((d) => d.assignment === null).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="GPS Devices"
        description="Device inventory, connectivity and diagnostics"
        actions={canRegister ? <Link to="/app/devices/new"><Button><Plus className="size-4" aria-hidden /> Add device</Button></Link> : undefined}
      />

      {/* Top 4 KPI summary cards matching 04_gps_devices.png */}
      {devices.data && totalCount > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard tone="brand" label="Registered devices" value={totalCount} caption="All device models" />
          <KpiCard tone="ok" label="Online devices" value={onlineCount} caption="Currently connected" captionTone="ok" />
          <KpiCard tone="danger" label="Offline devices" value={offlineCount} caption={offlineCount > 0 ? 'Needs investigation' : 'No offline devices'} captionTone={offlineCount > 0 ? 'danger' : 'muted'} />
          <KpiCard tone="warn" label="Awaiting installation" value={notInstalledCount} caption="Awaiting assignment" />
        </div>
      )}

      <Card className="overflow-hidden">
        <div className="border-b border-border/80 px-6 pt-5 pb-4">
          <h2 className="text-[16px] font-bold tracking-tight text-text">Device inventory</h2>
          <p className="mt-0.5 text-xs text-text-muted">Monitor communication and installation status</p>
        </div>

        {devices.isPending ? (
          <div className="space-y-2.5 p-6"><Skeleton className="h-10" /><Skeleton className="h-10" /><Skeleton className="h-10" /></div>
        ) : devices.isError ? (
          <QueryError query={devices} what="devices" />
        ) : devices.data.data.length === 0 ? (
          <EmptyState
            title="No devices yet"
            description={canRegister ? 'Register a tracker, set it up with the instructions we give you, and install it on a vehicle.' : 'An administrator can register devices.'}
            action={canRegister ? <Link to="/app/devices/new"><Button><Plus className="size-4" aria-hidden /> Add your first device</Button></Link> : undefined}
          />
        ) : (
          <>
            <Table>
              <thead><tr><Th>IMEI / Device</Th><Th>Model</Th><Th>Installed on</Th><Th>Status</Th><Th>Last heard from</Th></tr></thead>
              <tbody>
                {devices.data.data.map((d) => {
                  const tone = displayStatusTone(d);
                  const style = STATUS_DOT_CLASSES[tone];
                  return (
                    <tr key={d.id} className="hover:bg-surface-2/70 transition-colors">
                      <Td>
                        <Link to={`/app/devices/${d.id}`} className="tabular font-bold text-text hover:text-brand hover:underline">{d.name ?? d.uniqueId}</Link>
                        {d.name && <div className="tabular text-xs text-text-muted">{d.uniqueId}</div>}
                        {isSimulatedDevice(d.uniqueId) && <div className="mt-1"><SimulatedBadge /></div>}
                      </Td>
                      <Td>{d.variant ? <span className="font-medium text-text">{d.variant.label}</span> : <span className="text-text-muted">Not identified</span>}</Td>
                      <Td>{d.assignment ? <Link to={`/app/vehicles/${d.assignment.vehicleId}`} className="font-semibold text-text hover:text-brand hover:underline">{d.assignment.registrationNumber}</Link> : <span className="text-text-muted">Not installed</span>}</Td>
                      <Td>
                        <span className={`inline-flex items-center gap-2 font-bold ${style.text}`}>
                          <span aria-hidden className={`size-2 rounded-full ${style.dot}`} />
                          {d.displayStatus}
                        </span>
                      </Td>
                      <Td className="tabular text-text-muted">
                        {d.lastSeenAt ? <span title={formatDateTime(d.lastSeenAt, timezone)}>{formatRelative(d.lastSeenAt)}</span> : <span>Never</span>}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
            <p className="border-t border-border/70 px-6 py-3.5 text-xs font-medium text-text-muted">{devices.data.meta.total} in total</p>
          </>
        )}
      </Card>
    </div>
  );
}
