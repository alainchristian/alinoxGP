import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Tags } from 'lucide-react';
import { P, VEHICLE_SORTS, type VehicleCategoryDto, type VehicleDto } from '@gps/shared';
import { Badge, Button, Card, EmptyState, Input, KpiCard, PageHeader, Select, Skeleton, Table, Td, Th } from '@/components/ui/primitives';
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

/**
 * Vehicles page matching design_references/03_vehicles.png:
 * 4 KPI summary cards on top + rounded Vehicle registry card with integrated header & filter bar.
 * The page remounts when the active organization changes, so nothing of the previous tenant survives in state.
 */
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

  const rows = vehicles.data?.data ?? [];
  const totalCount = vehicles.data?.meta.total ?? 0;
  const withDeviceCount = rows.filter((r) => r.device !== null).length;
  const withoutDriverCount = rows.filter((r) => r.driver === null).length;
  const withoutDeviceCount = rows.filter((r) => r.device === null).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Vehicles"
        description="Manage fleet records, assignments and tracking status"
        actions={
          <div className="flex gap-2">
            {(canManageCategories || cats.length > 0) && (
              <Button variant="secondary" onClick={() => setCategoriesOpen(true)}>
                <Tags className="size-4 text-text-muted" aria-hidden /> Categories
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

      {/* Top 4 KPI summary cards matching 03_vehicles.png */}
      {vehicles.data && totalCount > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard tone="brand" label="Total vehicles" value={totalCount} />
          <KpiCard tone="brand" label="With tracker" value={withDeviceCount} caption="On current page" />
          <KpiCard tone="brand" label="Unassigned driver" value={withoutDriverCount} caption="On current page" />
          <KpiCard tone="brand" label="Without device" value={withoutDeviceCount} caption="On current page" />
        </div>
      )}

      <Card className="overflow-hidden">
        <div className="space-y-3 border-b border-border/80 px-6 pt-5 pb-4">
          <div>
            <h2 className="text-[16px] font-bold tracking-tight text-text">Vehicle registry</h2>
            <p className="text-xs text-text-muted">Search, filter and manage registered vehicles</p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5 pt-1">
            <div className="relative min-w-56 flex-1">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-text-faint" aria-hidden />
              <Input
                aria-label="Search vehicles"
                placeholder="Search registration, make, model or VIN"
                className="pl-9"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
              />
            </div>
            <Select aria-label="Category" className="w-40 bg-surface" value={categoryId} onChange={change(setCategoryId)}>
              <option value="">All categories</option>
              {cats.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
            <Select aria-label="Tracker" className="w-40 bg-surface" value={hasDevice} onChange={change(setHasDevice)}>
              <option value="">Any tracker status</option>
              <option value="true">With a tracker</option>
              <option value="false">Without a tracker</option>
            </Select>
            <Select aria-label="Driver" className="w-40 bg-surface" value={hasDriver} onChange={change(setHasDriver)}>
              <option value="">Any driver status</option>
              <option value="true">With a driver</option>
              <option value="false">Without a driver</option>
            </Select>
            <Select
              aria-label="Sort"
              className="w-44 bg-surface"
              value={sort}
              onChange={(e) => {
                setSort(e.target.value as typeof sort);
                setPage(1);
              }}
            >
              {VEHICLE_SORTS.map((s) => (
                <option key={s} value={s}>
                  {SORT_LABEL[s]}
                </option>
              ))}
            </Select>
          </div>
        </div>

        {vehicles.isPending ? (
          <div className="space-y-2.5 p-6">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
        ) : vehicles.isError ? (
          <QueryError query={vehicles} what="vehicles" />
        ) : vehicles.data.data.length === 0 ? (
          filtered ? (
            <EmptyState
              title="No vehicles match"
              description="Try a different search or clear the filters."
              action={
                <Button
                  variant="secondary"
                  onClick={() => {
                    setSearch('');
                    setCategoryId('');
                    setHasDevice('');
                    setHasDriver('');
                    setPage(1);
                  }}
                >
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              title="No vehicles yet"
              description={canCreate ? 'Add your first vehicle, then attach a tracker to see it on the map.' : 'An administrator can add vehicles.'}
              action={
                canCreate ? (
                  <Button onClick={() => setFormOpen(true)}>
                    <Plus className="size-4" aria-hidden /> Add your first vehicle
                  </Button>
                ) : undefined
              }
            />
          )
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Vehicle</Th>
                  <Th>Category</Th>
                  <Th>Assigned driver</Th>
                  <Th>Tracker</Th>
                  <Th>Insurance</Th>
                  <Th>Inspection</Th>
                </tr>
              </thead>
              <tbody>
                {vehicles.data.data.map((v) => (
                  <tr key={v.id} className="transition-colors hover:bg-surface-2/70">
                    <Td>
                      <Link to={`/app/vehicles/${v.id}`} className="font-bold text-text hover:text-brand hover:underline">
                        {v.registrationNumber}
                      </Link>
                      {vehicleSubtitle(v) && <div className="text-xs text-text-muted">{vehicleSubtitle(v)}</div>}
                    </Td>
                    <Td>{v.category ? <Badge>{v.category.name}</Badge> : <span className="text-text-muted">—</span>}</Td>
                    <Td>
                      {v.driver ? (
                        <span className="font-medium text-text">{v.driver.fullName}</span>
                      ) : (
                        <span className="text-text-muted">None</span>
                      )}
                    </Td>
                    <Td>
                      {v.device ? (
                        <span className="inline-flex items-center gap-2">
                          <span className="tabular font-medium text-text-muted">{v.device.uniqueId}</span>
                          {isSimulatedDevice(v.device.uniqueId) && <SimulatedBadge />}
                        </span>
                      ) : (
                        <span className="text-text-muted">None</span>
                      )}
                    </Td>
                    <Td>
                      <ExpiryBadge expiry={v.insurance} />
                    </Td>
                    <Td>
                      <ExpiryBadge expiry={v.inspection} />
                    </Td>
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
    </div>
  );
}
