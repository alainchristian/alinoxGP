import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Card, EmptyState, PageHeader, Skeleton, Table, Td, Th } from '@/components/ui/primitives';
import { Pager, QueryError } from '@/features/fleet/fleet-ui';
import { apiPaged } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { formatDateTime } from '@/lib/utils';

interface AccessEntry {
  at: string;
  action: string;
  area: string | null;
  actorName: string | null;
  actorOrganization: string;
}

const AREA_LABEL: Record<string, string> = {
  live: 'Live map',
  vehicles: 'Vehicles',
  drivers: 'Drivers',
  devices: 'Devices',
  tracking: 'Tracking',
  members: 'Users',
  alerts: 'Alerts',
  dashboard: 'Dashboard',
  organization: 'Organization',
};

/** Who at your provider or the platform looked at your organization’s data, and when. Only the owner can read it. */
export function AccessLogPage() {
  const orgId = useAuthStore((s) => s.me?.activeOrganizationId ?? '');
  const [page, setPage] = useState(1);
  const list = useQuery({
    queryKey: ['access-log', orgId, page],
    queryFn: () => apiPaged<AccessEntry>(`/organizations/${orgId}/access-log?page=${page}&pageSize=25`),
    placeholderData: keepPreviousData,
  });
  return (
    <>
      <PageHeader title="Access log" description="Staff of your provider can help you by looking at your vehicles. Every time they do, it is recorded here." />
      <Card className="overflow-hidden">
        {list.isPending ? (
          <div className="p-5"><Skeleton className="h-8" /></div>
        ) : list.isError ? (
          <QueryError query={list} what="the access log" />
        ) : list.data.data.length === 0 ? (
          <EmptyState title="Nobody has looked at your data" description="When someone from your provider opens your vehicles or live map, it appears here." />
        ) : (
          <>
            <Table>
              <thead><tr><Th>When</Th><Th>Who</Th><Th>From</Th><Th>What they opened</Th></tr></thead>
              <tbody>
                {list.data.data.map((e, i) => (
                  <tr key={`${e.at}-${i}`}>
                    <Td className="tabular">{formatDateTime(e.at)}</Td>
                    <Td className="font-medium">{e.actorName ?? 'A staff member'}</Td>
                    <Td>{e.actorOrganization}</Td>
                    <Td>{(e.area && AREA_LABEL[e.area]) ?? e.area ?? '—'}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pager page={page} pageSize={25} total={list.data.meta.total} onPage={setPage} />
          </>
        )}
      </Card>
    </>
  );
}
