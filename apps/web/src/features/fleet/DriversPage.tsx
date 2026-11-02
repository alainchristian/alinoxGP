import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
import { P, type DriverDto } from '@gps/shared';
import { Dialog } from '@/components/ui/dialog';
import { Alert, Badge, Button, Card, EmptyState, Field, Input, PageHeader, Select, Skeleton, Table, Td, Th } from '@/components/ui/primitives';
import { ApiError, api, apiPaged } from '@/lib/api';
import { hasPermission, useAuthStore } from '@/lib/auth-store';
import { applyApiError } from '@/lib/forms';
import { errorMessage } from '@/lib/i18n';
import { driverFormToPayload, driverStatusOptions, driverToForm, emptyDriverForm, type DriverFormValues } from './fleet-model';
import { ExpiryBadge, Pager, QueryError, useDebounced } from './fleet-ui';

const PAGE_SIZE = 25;

export function DriversPage() {
  const orgId = useAuthStore((s) => s.me?.activeOrganizationId ?? null);
  return <DriversView key={orgId ?? 'none'} orgId={orgId ?? ''} />;
}

function DriversView({ orgId }: { orgId: string }) {
  const me = useAuthStore((s) => s.me);
  const queryClient = useQueryClient();
  const canManage = hasPermission(me, P.DRIVERS_MANAGE);
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim());
  const [status, setStatus] = useState('');
  const [assigned, setAssigned] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<DriverDto | 'new' | null>(null);
  const [deleting, setDeleting] = useState<DriverDto | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (q) params.set('q', q);
  if (status) params.set('status', status);
  if (assigned) params.set('assigned', assigned);
  const filtered = !!(q || status || assigned);

  const drivers = useQuery({
    queryKey: ['org', orgId, 'drivers', params.toString()],
    queryFn: () => apiPaged<DriverDto>(`/drivers?${params}`),
    enabled: !!orgId,
    placeholderData: keepPreviousData,
  });
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['org', orgId, 'drivers'] }),
      queryClient.invalidateQueries({ queryKey: ['org', orgId, 'dashboard'] }),
    ]);
  const remove = useMutation({
    mutationFn: (id: string) => api(`/drivers/${id}`, { method: 'DELETE' }),
    onSuccess: async () => { setDeleting(null); setActionError(null); await refresh(); },
    onError: (e) => { setDeleting(null); setActionError(e instanceof ApiError ? errorMessage(e.code) : errorMessage(undefined)); },
  });

  return (
    <>
      <PageHeader
        title="Drivers"
        description="The people who drive your vehicles. A driver is assigned to a vehicle from the vehicle's page; the platform does not claim the assigned person is driving at any given moment."
        actions={canManage ? <Button onClick={() => setEditing('new')}><Plus className="size-4" aria-hidden /> Add driver</Button> : undefined}
      />
      {actionError && <div className="mb-4"><Alert>{actionError}</Alert></div>}
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
          <div className="relative min-w-52 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-faint" aria-hidden />
            <Input aria-label="Search drivers" placeholder="Search name, phone or licence number" className="pl-9" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          </div>
          <Select aria-label="Status" className="w-36" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">Any status</option>
            {driverStatusOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
          <Select aria-label="Assignment" className="w-44" value={assigned} onChange={(e) => { setAssigned(e.target.value); setPage(1); }}>
            <option value="">Assigned or not</option>
            <option value="true">Assigned to a vehicle</option>
            <option value="false">Not assigned</option>
          </Select>
        </div>
        {drivers.isPending ? (
          <div className="space-y-2 p-5"><Skeleton className="h-8" /><Skeleton className="h-8" /><Skeleton className="h-8" /></div>
        ) : drivers.isError ? (
          <QueryError query={drivers} what="drivers" />
        ) : drivers.data.data.length === 0 ? (
          filtered ? (
            <EmptyState title="No drivers match" description="Try a different search or clear the filters." action={<Button variant="secondary" onClick={() => { setSearch(''); setStatus(''); setAssigned(''); setPage(1); }}>Clear filters</Button>} />
          ) : (
            <EmptyState
              title="No drivers yet"
              description={canManage ? 'Add your drivers, then assign each to a vehicle.' : 'An administrator can add drivers.'}
              action={canManage ? <Button onClick={() => setEditing('new')}><Plus className="size-4" aria-hidden /> Add your first driver</Button> : undefined}
            />
          )
        ) : (
          <>
            <Table>
              <thead><tr><Th>Name</Th><Th>Phone</Th><Th>Licence</Th><Th>Licence validity</Th><Th>Status</Th><Th>Assigned vehicle</Th>{canManage && <Th className="text-right">Actions</Th>}</tr></thead>
              <tbody>
                {drivers.data.data.map((d) => (
                  <tr key={d.id} className="hover:bg-surface-2">
                    <Td className="font-medium">{d.fullName}{d.email && <div className="text-xs font-normal text-text-muted">{d.email}</div>}</Td>
                    <Td className="tabular">{d.phone ?? '—'}</Td>
                    <Td>{d.licenseNumber ? <>{d.licenseNumber}{d.licenseClass && <span className="text-text-muted"> · class {d.licenseClass}</span>}</> : '—'}</Td>
                    <Td><ExpiryBadge expiry={d.license} /></Td>
                    <Td><Badge tone={d.status === 'ACTIVE' ? 'ok' : 'neutral'}>{d.status === 'ACTIVE' ? 'Active' : 'Inactive'}</Badge></Td>
                    <Td>{d.vehicle ? <Link className="text-brand hover:underline" to={`/app/vehicles/${d.vehicle.id}`}>{d.vehicle.registrationNumber}</Link> : <span className="text-text-muted">None</span>}</Td>
                    {canManage && (
                      <Td className="text-right">
                        <span className="inline-flex gap-1">
                          <Button size="sm" variant="ghost" aria-label={`Edit ${d.fullName}`} onClick={() => setEditing(d)}>Edit</Button>
                          <Button size="sm" variant="ghost" className="text-danger" aria-label={`Delete ${d.fullName}`} onClick={() => setDeleting(d)}>Delete</Button>
                        </span>
                      </Td>
                    )}
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pager page={page} pageSize={PAGE_SIZE} total={drivers.data.meta.total} onPage={setPage} />
          </>
        )}
      </Card>

      <DriverFormDialog driver={editing === 'new' ? undefined : (editing ?? undefined)} open={editing !== null} onOpenChange={(o) => !o && setEditing(null)} onSaved={refresh} />

      <Dialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)} title="Delete driver" description={deleting ? `${deleting.fullName} will be removed from your driver list. Past assignments stay in the vehicle history.` : undefined}>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setDeleting(null)}>Cancel</Button>
          <Button variant="danger" loading={remove.isPending} onClick={() => deleting && remove.mutate(deleting.id)}>Delete driver</Button>
        </div>
      </Dialog>
    </>
  );
}

function DriverFormDialog({ driver, open, onOpenChange, onSaved }: { driver?: DriverDto; open: boolean; onOpenChange: (o: boolean) => void; onSaved: () => Promise<unknown> }) {
  const [formError, setFormError] = useState<string | null>(null);
  const { register, handleSubmit, reset, setError, formState: { errors, isSubmitting } } = useForm<DriverFormValues>({ defaultValues: emptyDriverForm });
  useEffect(() => {
    if (open) {
      reset(driver ? driverToForm(driver) : emptyDriverForm);
      setFormError(null);
    }
  }, [open, driver, reset]);

  async function onSubmit(values: DriverFormValues) {
    setFormError(null);
    if (!values.fullName.trim()) {
      setError('fullName', { message: 'Enter the driver’s name' });
      return;
    }
    try {
      await api(driver ? `/drivers/${driver.id}` : '/drivers', { method: driver ? 'PATCH' : 'POST', body: driverFormToPayload(values) });
      await onSaved();
      onOpenChange(false);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'DRIVER_LICENSE_TAKEN') setError('licenseNumber', { message: 'Already used by another driver' });
      else setFormError(applyApiError(err, setError));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="lg" title={driver ? 'Edit driver' : 'Add driver'} description="Only the name is required. The platform keeps minimal personal data: no national ID, photo or address.">
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
        {formError && <Alert>{formError}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" htmlFor="d-name" error={errors.fullName?.message}>
            <Input id="d-name" autoFocus invalid={!!errors.fullName} {...register('fullName')} />
          </Field>
          <Field label="Status" htmlFor="d-status" error={errors.status?.message}>
            <Select id="d-status" {...register('status')}>
              {driverStatusOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          </Field>
          <Field label="Phone" htmlFor="d-phone" error={errors.phone?.message} hint="International format, e.g. +250788123456">
            <Input id="d-phone" type="tel" invalid={!!errors.phone} {...register('phone')} />
          </Field>
          <Field label="Email" htmlFor="d-email" error={errors.email?.message}>
            <Input id="d-email" type="email" invalid={!!errors.email} {...register('email')} />
          </Field>
          <Field label="Licence number" htmlFor="d-lic" error={errors.licenseNumber?.message}>
            <Input id="d-lic" invalid={!!errors.licenseNumber} {...register('licenseNumber')} />
          </Field>
          <Field label="Licence class" htmlFor="d-class" error={errors.licenseClass?.message}>
            <Input id="d-class" {...register('licenseClass')} />
          </Field>
          <Field label="Licence valid through" htmlFor="d-exp" error={errors.licenseExpiry?.message}>
            <Input id="d-exp" type="date" invalid={!!errors.licenseExpiry} {...register('licenseExpiry')} />
          </Field>
        </div>
        <Field label="Notes" htmlFor="d-notes" error={errors.notes?.message}>
          <textarea id="d-notes" rows={3} className="w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-text" {...register('notes')} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" loading={isSubmitting}>{driver ? 'Save changes' : 'Add driver'}</Button>
        </div>
      </form>
    </Dialog>
  );
}
