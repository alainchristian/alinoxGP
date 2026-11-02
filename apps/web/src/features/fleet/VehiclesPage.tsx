import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Tags } from 'lucide-react';
import { P, VEHICLE_SORTS, type VehicleCategoryDto, type VehicleDto } from '@gps/shared';
import { Badge, Button, Card, EmptyState, Input, PageHeader, Select, Skeleton, Table, Td, Th } from '@/components/ui/primitives';
import { api, apiPaged } from '@/lib/api';
import { hasPermission, useAuthStore } from '@/lib/auth-store';
import { CategoriesDialog, categoriesKey } from './CategoriesDialog';
import { vehicleSubtitle } from './fleet-model';
import { ExpiryBadge, isSimulatedDevice, Pager, QueryError, SimulatedBadge, useDebounced } from './fleet-ui';
import { VehicleFormDialog } from './VehicleFormDialog';

const PAGE_SIZE = 25;
const SORT_LABEL: Record<(typeof VEHICLE_SORTS)[number], string> = {
  'registration:asc': 'Registration A–Z',
  'registration:desc': 'Registration Z–A',
  'created:desc': 'Newest first',
  'created:asc': 'Oldest first',
  'year:desc': 'Newest model year',
  'year:asc': 'Oldest model year',
};

/** The page remounts when the active organization changes, so nothing of the previous tenant survives in state. */
export function VehiclesPage() {
  const orgId = useAuthStore((s) => s.me?.activeOrganizationId ?? null);
  return <VehiclesView key={orgId ?? 'none'} orgId={orgId ?? ''} />;
}

function VehiclesView({ orgId }: { orgId: string }) {
  const me = useAuthStore((s) => s.me);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canCreate = hasPermission(me, P.VEHICLES_CREATE);
  const canManageCategories = hasPermission(me, P.VEHICLES_CATEGORIES_MANAGE);

  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim());
  const [categoryId, setCategoryId] = useState('');
  const [hasDevice, setHasDevice] = useState('');
  const [hasDriver, setHasDriver] = useState('');
  const [sort, setSort] = useState<(typeof VEHICLE_SORTS)[number]>('registration:asc');
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [categoriesOpen, setCategoriesOpen] = useState(false);

  const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), sort });
  if (q) params.set('q', q);
  if (categoryId) params.set('categoryId', categoryId);
  if (hasDevice) params.set('hasDevice', hasDevice);
  if (hasDriver) params.set('hasDriver', hasDriver);
  const filtered = !!(q || categoryId || hasDevice || hasDriver);

  const vehicles = useQuery({
    queryKey: ['org', orgId, 'vehicles', params.toString()],
    queryFn: () => apiPaged<VehicleDto>(`/vehicles?${params}`),
    enabled: !!orgId,
    placeholderData: keepPreviousData,
  });
  const categories = useQuery({ queryKey: categoriesKey(orgId), queryFn: () => api<VehicleCategoryDto[]>('/vehicle-categories'), enabled: !!orgId });
  const cats = categories.data ?? [];
  const change = (set: (v: string) => void) => (e: { target: { value: string } }) => { set(e.target.value); setPage(1); };

  return (
    <>
      <PageHeader
        title="Vehicles"
        description="Your vehicles, their details, assigned drivers and the dates their papers expire."
        actions={
          <div className="flex gap-2">
            {(canManageCategories || cats.length > 0) && (
              <Button variant="secondary" onClick={() => setCategoriesOpen(true)}>
                <Tags className="size-4" aria-hidden /> Categories
              </Button>
            )}
            {canCreate && (
              <Button onClick={() => setFormOpen(true)}>
                <Plus className="size-4" aria-hidden /> Add vehicle
              </Button>
            )}
          </div>
        }
      />

      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
          <div className="relative min-w-52 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-faint" aria-hidden />
            <Input aria-label="Search vehicles" placeholder="Search registration, make, model or VIN" className="pl-9" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          </div>
          <Select aria-label="Category" className="w-40" value={categoryId} onChange={change(setCategoryId)}>
            <option value="">All categories</option>
            {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          <Select aria-label="Tracker" className="w-40" value={hasDevice} onChange={change(setHasDevice)}>
            <option value="">Any tracker status</option>
            <option value="true">With a tracker</option>
            <option value="false">Without a tracker</option>
          </Select>
          <Select aria-label="Driver" className="w-40" value={hasDriver} onChange={change(setHasDriver)}>
            <option value="">Any driver status</option>
            <option value="true">With a driver</option>
            <option value="false">Without a driver</option>
          </Select>
          <Select aria-label="Sort" className="w-44" value={sort} onChange={(e) => { setSort(e.target.value as typeof sort); setPage(1); }}>
            {VEHICLE_SORTS.map((s) => <option key={s} value={s}>{SORT_LABEL[s]}</option>)}
          </Select>
        </div>

        {vehicles.isPending ? (
          <div className="space-y-2 p-5"><Skeleton className="h-8" /><Skeleton className="h-8" /><Skeleton className="h-8" /></div>
        ) : vehicles.isError ? (
          <QueryError query={vehicles} what="vehicles" />
        ) : vehicles.data.data.length === 0 ? (
          filtered ? (
            <EmptyState
              title="No vehicles match"
              description="Try a different search or clear the filters."
              action={<Button variant="secondary" onClick={() => { setSearch(''); setCategoryId(''); setHasDevice(''); setHasDriver(''); setPage(1); }}>Clear filters</Button>}
            />
          ) : (
            <EmptyState
              title="No vehicles yet"
              description={canCreate ? 'Add your first vehicle, then attach a tracker to see it on the map.' : 'An administrator can add vehicles.'}
              action={canCreate ? <Button onClick={() => setFormOpen(true)}><Plus className="size-4" aria-hidden /> Add your first vehicle</Button> : undefined}
            />
          )
        ) : (
          <>
            <Table>
              <thead>
                <tr><Th>Vehicle</Th><Th>Category</Th><Th>Assigned driver</Th><Th>Tracker</Th><Th>Insurance</Th><Th>Inspection</Th></tr>
              </thead>
              <tbody>
                {vehicles.data.data.map((v) => (
                  <tr key={v.id} className="hover:bg-surface-2">
                    <Td>
                      <Link to={`/app/vehicles/${v.id}`} className="font-medium text-brand hover:underline">{v.registrationNumber}</Link>
                      {vehicleSubtitle(v) && <div className="text-xs text-text-muted">{vehicleSubtitle(v)}</div>}
                    </Td>
                    <Td>{v.category ? <Badge>{v.category.name}</Badge> : <span className="text-text-muted">—</span>}</Td>
                    <Td>{v.driver ? v.driver.fullName : <span className="text-text-muted">None</span>}</Td>
                    <Td>
                      {v.device ? (
                        <span className="inline-flex items-center gap-2"><span className="tabular">{v.device.uniqueId}</span>{isSimulatedDevice(v.device.uniqueId) && <SimulatedBadge />}</span>
                      ) : (
                        <span className="text-text-muted">None</span>
                      )}
                    </Td>
                    <Td><ExpiryBadge expiry={v.insurance} /></Td>
                    <Td><ExpiryBadge expiry={v.inspection} /></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pager page={page} pageSize={PAGE_SIZE} total={vehicles.data.meta.total} onPage={setPage} />
          </>
        )}
      </Card>

      <VehicleFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        categories={cats}
        onSaved={(v) => {
          void queryClient.invalidateQueries({ queryKey: ['org', orgId, 'vehicles'] });
          void queryClient.invalidateQueries({ queryKey: ['org', orgId, 'dashboard'] });
          navigate(`/app/vehicles/${v.id}`);
        }}
      />
      <CategoriesDialog open={categoriesOpen} onOpenChange={setCategoriesOpen} orgId={orgId} categories={cats} canManage={canManageCategories} />
    </>
  );
}
