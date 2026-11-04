import { useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { ProviderFleetSnapshotDto, VehicleStatus } from '@gps/shared';
import { VEHICLE_STATUSES } from '@gps/shared';
import { Badge, Card, EmptyState, Input, PageHeader, Select, Skeleton, Table, Td, Th } from '@/components/ui/primitives';
import { QueryError } from '@/features/fleet/fleet-ui';
import { StatusBadge } from '@/features/monitor/status-badge';
import { STATUS_META } from '@/features/monitor/monitor-model';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { formatRelative } from '@/lib/utils';

/** How often the list is re-read. The provider-wide map with live pushes follows; this page is honest about being a refresh. */
const REFRESH_MS = 15_000;

/** Every vehicle of every customer you may see, with the customer’s name. Opening the page is recorded in each customer’s access log. */
export function ProviderFleetPage() {
  const orgId = useAuthStore((s) => s.me?.activeOrganizationId ?? '');
  const [customer, setCustomer] = useState('');
  const [status, setStatus] = useState<VehicleStatus | ''>('');
  const [search, setSearch] = useState('');
  const snap = useQuery({
    queryKey: ['provider', orgId, 'fleet'],
    queryFn: () => api<ProviderFleetSnapshotDto>(`/organizations/${orgId}/provider/fleet/snapshot`),
    refetchInterval: REFRESH_MS,
    placeholderData: keepPreviousData,
  });

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (snap.data?.vehicles ?? []).filter(
      (v) => (!customer || v.customerId === customer) && (!status || v.status === status) && (!q || v.registrationNumber.toLowerCase().includes(q)),
    );
  }, [snap.data, customer, status, search]);

  return (
    <>
      <PageHeader title="All vehicles" description="The latest known position state of every vehicle of your customers. Refreshes every 15 seconds." />
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-border/80 px-6 pt-5 pb-4">
          <Input aria-label="Search vehicles" placeholder="Registration number" className="w-52" value={search} onChange={(e) => setSearch(e.target.value)} />
          <Select aria-label="Customer" className="w-52" value={customer} onChange={(e) => setCustomer(e.target.value)}>
            <option value="">All customers</option>
            {snap.data?.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          <Select aria-label="Status" className="w-44" value={status} onChange={(e) => setStatus(e.target.value as VehicleStatus | '')}>
            <option value="">Any status</option>
            {VEHICLE_STATUSES.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
          </Select>
        </div>
        {snap.isPending ? (
          <div className="p-5"><Skeleton className="h-8" /></div>
        ) : snap.isError ? (
          <QueryError query={snap} what="the vehicles" />
        ) : snap.data.total === 0 ? (
          <EmptyState title="No vehicle has reported yet" description="Vehicles appear here once a device installed on them sends its first position." />
        ) : rows.length === 0 ? (
          <EmptyState title="No vehicle matches" description="Change the filters." />
        ) : (
          <>
            {snap.data.truncated && <p className="border-b border-border/70 bg-amber-50 px-6 py-2 text-xs text-amber-900">Showing the first {snap.data.vehicles.length} of {snap.data.total} vehicles. Filter by customer to see the rest.</p>}
            <Table>
              <thead><tr><Th>Vehicle</Th><Th>Customer</Th><Th>Status</Th><Th className="text-right">Speed (km/h)</Th><Th>Last seen</Th></tr></thead>
              <tbody>
                {rows.map((v) => (
                  <tr key={`${v.customerId}-${v.vehicleId}`}>
                    <Td><span className="font-medium">{v.registrationNumber}</span>{v.simulated && <span className="ml-2"><Badge tone="warn">Simulated</Badge></span>}</Td>
                    <Td>{v.customerName}</Td>
                    <Td><StatusBadge status={v.status} /></Td>
                    <Td className="tabular text-right">{v.speedKmh === null ? '—' : Math.round(v.speedKmh)}</Td>
                    <Td className="tabular" title={v.lastSeenAt}>{formatRelative(v.lastSeenAt)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <p className="border-t border-border/70 bg-slate-50/40 px-4 py-3 text-xs font-medium text-text-muted">{rows.length} shown · {snap.data.total} in total</p>
          </>
        )}
      </Card>
    </>
  );
}
