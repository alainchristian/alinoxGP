import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { P, type DeviceDto } from '@gps/shared';
import { Badge, Button, Card, EmptyState, PageHeader, Skeleton, Table, Td, Th } from '@/components/ui/primitives';
import { isSimulatedDevice, QueryError, SimulatedBadge } from '@/features/fleet/fleet-ui';
import { apiPaged } from '@/lib/api';
import { hasPermission, useAuthStore } from '@/lib/auth-store';
import { formatDateTime, formatRelative } from '@/lib/utils';
import { displayStatusTone } from './device-model';

export const devicesKey = (orgId: string) => ['org', orgId, 'devices'];

/** Remounts when the active organization changes, so nothing of the previous tenant survives in state. */
export function DevicesPage() {
  const orgId = useAuthStore((s) => s.me?.activeOrganizationId ?? null);
  return <DevicesView key={orgId ?? 'none'} orgId={orgId ?? ''} />;
}

function DevicesView({ orgId }: { orgId: string }) {
  const me = useAuthStore((s) => s.me);
  const canRegister = hasPermission(me, P.DEVICES_REGISTER);
  const timezone = me?.memberships.find((m) => m.organization.id === orgId)?.organization.timezone;
  const devices = useQuery({ queryKey: [...devicesKey(orgId), 'list'], queryFn: () => apiPaged<DeviceDto>('/devices?pageSize=100'), enabled: !!orgId });

  return (
    <>
      <PageHeader
        title="Devices"
        description="The GPS trackers of your organization: what each one is, where it is installed and what it can do."
        actions={canRegister ? <Link to="/app/devices/new"><Button><Plus className="size-4" aria-hidden /> Add device</Button></Link> : undefined}
      />
      <Card>
        {devices.isPending ? (
          <div className="space-y-2 p-5"><Skeleton className="h-8" /><Skeleton className="h-8" /><Skeleton className="h-8" /></div>
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
              <thead><tr><Th>Device</Th><Th>Model</Th><Th>Status</Th><Th>Installed on</Th><Th>Last heard from</Th></tr></thead>
              <tbody>
                {devices.data.data.map((d) => (
                  <tr key={d.id} className="hover:bg-surface-2">
                    <Td>
                      <Link to={`/app/devices/${d.id}`} className="font-medium text-brand hover:underline">{d.name ?? d.uniqueId}</Link>
                      {d.name && <div className="tabular text-xs text-text-muted">{d.uniqueId}</div>}
                      {isSimulatedDevice(d.uniqueId) && <div className="mt-0.5"><SimulatedBadge /></div>}
                    </Td>
                    <Td>{d.variant ? d.variant.label : <span className="text-text-muted">Not identified</span>}</Td>
                    <Td><Badge tone={displayStatusTone(d)}>{d.displayStatus}</Badge></Td>
                    <Td>{d.assignment ? <Link to={`/app/vehicles/${d.assignment.vehicleId}`} className="text-brand hover:underline">{d.assignment.registrationNumber}</Link> : <span className="text-text-muted">Not installed</span>}</Td>
                    <Td className="tabular">
                      {d.lastSeenAt ? <span title={formatDateTime(d.lastSeenAt, timezone)}>{formatRelative(d.lastSeenAt)}</span> : <span className="text-text-muted">Never</span>}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <p className="border-t border-border px-4 py-2.5 text-xs text-text-muted">{devices.data.meta.total} in total</p>
          </>
        )}
      </Card>
    </>
  );
}
