import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, MapPin, Pencil, Plus, Trash2 } from 'lucide-react';
import { P, type DriverAssignmentDto, type DriverDto, type VehicleCategoryDto, type VehicleDocumentDto, type VehicleDto } from '@gps/shared';
import { Dialog } from '@/components/ui/dialog';
import { Alert, Badge, Button, Card, CardHeader, EmptyState, Field, Input, PageHeader, Select, Skeleton, Table, Td, Th } from '@/components/ui/primitives';
import { ApiError, api, apiPaged } from '@/lib/api';
import { hasPermission, useAuthStore } from '@/lib/auth-store';
import { applyApiError } from '@/lib/forms';
import { errorMessage } from '@/lib/i18n';
import { formatDateTime } from '@/lib/utils';
import { categoriesKey } from './CategoriesDialog';
import {
  DOCUMENT_TYPE_LABEL, documentFormToPayload, documentToForm, documentTypeOptions, emptyDocumentForm, formatDay, FUEL_TYPE_LABEL, vehicleSubtitle, VEHICLE_TYPE_LABEL,
  type DocumentFormValues,
} from './fleet-model';
import { DetailRow, ExpiryBadge, isSimulatedDevice, QueryError, SimulatedBadge } from './fleet-ui';
import { VehicleFormDialog } from './VehicleFormDialog';

export function VehicleDetailPage() {
  const orgId = useAuthStore((s) => s.me?.activeOrganizationId ?? null);
  const { vehicleId = '' } = useParams();
  return <VehicleDetailView key={`${orgId ?? 'none'}:${vehicleId}`} orgId={orgId ?? ''} vehicleId={vehicleId} />;
}

function VehicleDetailView({ orgId, vehicleId }: { orgId: string; vehicleId: string }) {
  const me = useAuthStore((s) => s.me);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canUpdate = hasPermission(me, P.VEHICLES_UPDATE);
  const canDelete = hasPermission(me, P.VEHICLES_DELETE);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const timezone = me?.memberships.find((m) => m.organization.id === orgId)?.organization.timezone;

  const key = ['org', orgId, 'vehicle', vehicleId];
  const vehicle = useQuery({ queryKey: key, queryFn: () => api<VehicleDto>(`/vehicles/${vehicleId}`), enabled: !!orgId });
  const categories = useQuery({ queryKey: categoriesKey(orgId), queryFn: () => api<VehicleCategoryDto[]>('/vehicle-categories'), enabled: !!orgId });
  const refreshAll = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: key }),
      queryClient.invalidateQueries({ queryKey: ['org', orgId, 'vehicles'] }),
      queryClient.invalidateQueries({ queryKey: ['org', orgId, 'drivers'] }),
      queryClient.invalidateQueries({ queryKey: ['org', orgId, 'dashboard'] }),
    ]);

  const remove = useMutation({
    mutationFn: () => api(`/vehicles/${vehicleId}`, { method: 'DELETE' }),
    onSuccess: async () => {
      await refreshAll();
      navigate('/app/vehicles');
    },
    onError: (e) => {
      setDeleteOpen(false);
      setActionError(e instanceof ApiError ? errorMessage(e.code) : errorMessage(undefined));
    },
  });

  if (vehicle.isPending) return <div className="space-y-3"><Skeleton className="h-8 w-64" /><Skeleton className="h-40" /><Skeleton className="h-40" /></div>;
  if (vehicle.isError) {
    const notFound = vehicle.error instanceof ApiError && vehicle.error.status === 404;
    return (
      <>
        <BackLink />
        <Card>{notFound ? <EmptyState title="Vehicle not found" description="It may have been deleted, or it belongs to another organization." action={<Link className="text-[13px] text-brand underline" to="/app/vehicles">Back to vehicles</Link>} /> : <QueryError query={vehicle} what="this vehicle" />}</Card>
      </>
    );
  }
  const v = vehicle.data;

  return (
    <div className="space-y-5">
      <BackLink />
      <PageHeader
        title={v.registrationNumber}
        description={vehicleSubtitle(v) || undefined}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {v.category && <Badge>{v.category.name}</Badge>}
            {isSimulatedDevice(v.device?.uniqueId) && <SimulatedBadge />}
            {hasPermission(me, P.TRACKING_LIVE_VIEW) && v.device && (
              <Link to="/app/live" className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border-strong/80 bg-surface px-3 text-[13px] font-medium text-slate-800 shadow-xs transition-colors hover:bg-surface-2"><MapPin className="size-4 text-brand" aria-hidden /> Live map</Link>
            )}
            {canUpdate && <Button size="sm" variant="secondary" onClick={() => setEditOpen(true)}><Pencil className="size-4" aria-hidden /> Edit</Button>}
            {canDelete && <Button size="sm" variant="secondary" className="text-danger" onClick={() => setDeleteOpen(true)}><Trash2 className="size-4" aria-hidden /> Delete</Button>}
          </div>
        }
      />
      {actionError && <div className="mb-4"><Alert>{actionError}</Alert></div>}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Details" />
          <dl className="px-6 py-3 text-[13px]">
            <DetailRow label="Registration number">{v.registrationNumber}</DetailRow>
            <DetailRow label="Make">{v.make ?? '—'}</DetailRow>
            <DetailRow label="Model">{v.model ?? '—'}</DetailRow>
            <DetailRow label="Year">{v.year ?? '—'}</DetailRow>
            <DetailRow label="Colour">{v.color ?? '—'}</DetailRow>
            <DetailRow label="Type">{v.vehicleType ? VEHICLE_TYPE_LABEL[v.vehicleType] : 'Unknown'}</DetailRow>
            <DetailRow label="Fuel">{v.fuelType ? FUEL_TYPE_LABEL[v.fuelType] : 'Unknown'}</DetailRow>
            <DetailRow label="VIN / chassis">{v.vin ? <span className="tabular">{v.vin}</span> : '—'}</DetailRow>
            <DetailRow label="Category">{v.category?.name ?? '—'}</DetailRow>
            {v.notes && <DetailRow label="Notes"><span className="whitespace-pre-wrap font-normal">{v.notes}</span></DetailRow>}
          </dl>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Papers" description="Valid-through dates you entered. Add document records below for permits and other papers." />
            <dl className="px-6 py-3 text-[13px]">
              <DetailRow label="Insurance"><span className="inline-flex flex-wrap items-center justify-end gap-2">{v.insurance && <span className="tabular font-normal">{formatDay(v.insurance.date)}</span>}<ExpiryBadge expiry={v.insurance} /></span></DetailRow>
              <DetailRow label="Inspection"><span className="inline-flex flex-wrap items-center justify-end gap-2">{v.inspection && <span className="tabular font-normal">{formatDay(v.inspection.date)}</span>}<ExpiryBadge expiry={v.inspection} /></span></DetailRow>
            </dl>
          </Card>
          <Card>
            <CardHeader title="Tracker" />
            <dl className="px-6 py-3 text-[13px]">
              {v.device ? (
                <>
                  <DetailRow label="Device"><span className="inline-flex items-center gap-2"><span className="tabular">{v.device.uniqueId}</span>{isSimulatedDevice(v.device.uniqueId) && <SimulatedBadge />}</span></DetailRow>
                  <DetailRow label="Installed since">{formatDateTime(v.device.since, timezone)}</DetailRow>
                </>
              ) : (
                <p className="py-1.5 text-text-muted">No tracker is installed on this vehicle.</p>
              )}
            </dl>
          </Card>
        </div>
      </div>

      <DriverCard vehicle={v} orgId={orgId} timezone={timezone} onChanged={refreshAll} />
      <DocumentsCard vehicleId={vehicleId} orgId={orgId} onChanged={refreshAll} />

      <VehicleFormDialog open={editOpen} onOpenChange={setEditOpen} vehicle={v} categories={categories.data ?? []} onSaved={refreshAll} />
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen} title="Delete vehicle" description={`${v.registrationNumber} will be removed from your fleet. A vehicle with a tracker or an assigned driver cannot be deleted until they are removed.`}>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setDeleteOpen(false)}>Cancel</Button>
          <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}>Delete vehicle</Button>
        </div>
      </Dialog>
    </div>
  );
}

function BackLink() {
  return (
    <Link to="/app/vehicles" className="mb-1 inline-flex items-center gap-1.5 text-[13px] font-medium text-text-muted transition-colors hover:text-slate-900">
      <ArrowLeft className="size-4" aria-hidden /> Vehicles
    </Link>
  );
}

// ---------------------------------------------------------------- assigned driver

function DriverCard({ vehicle, orgId, timezone, onChanged }: { vehicle: VehicleDto; orgId: string; timezone?: string; onChanged: () => Promise<unknown> }) {
  const me = useAuthStore((s) => s.me);
  const canManage = hasPermission(me, P.DRIVERS_MANAGE);
  const canRead = hasPermission(me, P.DRIVERS_READ);
  const [pick, setPick] = useState('');
  const [error, setError] = useState<string | null>(null);

  const history = useQuery({
    queryKey: ['org', orgId, 'vehicle', vehicle.id, 'driver-history'],
    queryFn: () => api<DriverAssignmentDto[]>(`/vehicles/${vehicle.id}/driver-history`),
    enabled: !!orgId && canRead,
  });
  // Only drivers who can actually be assigned: active and not on another vehicle.
  const available = useQuery({
    queryKey: ['org', orgId, 'drivers', 'available'],
    queryFn: () => apiPaged<DriverDto>('/drivers?status=ACTIVE&assigned=false&pageSize=100'),
    enabled: !!orgId && canManage && !vehicle.driver,
  });
  const fail = (e: unknown) => setError(e instanceof ApiError ? errorMessage(e.code) : errorMessage(undefined));
  const done = async () => { setError(null); setPick(''); await Promise.all([onChanged(), history.refetch()]); };
  const assign = useMutation({ mutationFn: () => api(`/vehicles/${vehicle.id}/driver`, { method: 'POST', body: { driverId: pick } }), onSuccess: done, onError: fail });
  const unassign = useMutation({ mutationFn: () => api(`/vehicles/${vehicle.id}/driver`, { method: 'DELETE', body: {} }), onSuccess: done, onError: fail });

  return (
    <Card className="mt-4 overflow-hidden">
      <CardHeader title="Assigned driver" description="Who this vehicle is assigned to. This is not a statement about who is driving right now." />
      <div className="px-6 py-4 text-[13px]">
        {error && <div className="mb-3"><Alert>{error}</Alert></div>}
        {vehicle.driver ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-bold text-text">{vehicle.driver.fullName}</p>
              <p className="text-text-muted">Assigned since {formatDateTime(vehicle.driver.since, timezone)}</p>
            </div>
            {canManage && <Button size="sm" variant="secondary" loading={unassign.isPending} onClick={() => unassign.mutate()}>Unassign driver</Button>}
          </div>
        ) : canManage ? (
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-52 flex-1">
              <label htmlFor="assign-driver" className="mb-1.5 block font-medium">No driver assigned. Assign one</label>
              <Select id="assign-driver" value={pick} onChange={(e) => setPick(e.target.value)} disabled={available.isPending}>
                <option value="">{available.isPending ? 'Loading drivers…' : (available.data?.data.length ?? 0) === 0 ? 'No unassigned active drivers' : 'Choose a driver'}</option>
                {(available.data?.data ?? []).map((d) => <option key={d.id} value={d.id}>{d.fullName}</option>)}
              </Select>
            </div>
            <Button loading={assign.isPending} disabled={!pick} onClick={() => assign.mutate()}>Assign</Button>
          </div>
        ) : (
          <p className="text-text-muted">No driver is assigned to this vehicle.</p>
        )}
      </div>
      {canRead && (
        <div className="border-t border-border/70">
          <h3 className="px-6 pt-3.5 text-xs font-bold uppercase tracking-wider text-text-muted">Assignment history</h3>
          {history.isPending ? (
            <div className="p-6"><Skeleton className="h-8" /></div>
          ) : history.isError ? (
            <QueryError query={history} what="the assignment history" />
          ) : history.data.length === 0 ? (
            <p className="px-6 py-4 text-[13px] text-text-muted">No driver has been assigned to this vehicle yet.</p>
          ) : (
            <Table>
              <thead><tr><Th>Driver</Th><Th>From</Th><Th>Until</Th><Th>Note</Th></tr></thead>
              <tbody>
                {history.data.map((h) => (
                  <tr key={h.id} className="transition-colors hover:bg-surface-2/70">
                    <Td className="font-bold text-text">{h.driver.fullName}</Td>
                    <Td className="tabular text-text-muted">{formatDateTime(h.assignedAt, timezone)}</Td>
                    <Td className="tabular text-text-muted">{h.unassignedAt ? formatDateTime(h.unassignedAt, timezone) : <Badge tone="ok">Current</Badge>}</Td>
                    <Td className="text-text-muted">{h.reason ?? '—'}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- document records

function DocumentsCard({ vehicleId, orgId, onChanged }: { vehicleId: string; orgId: string; onChanged: () => Promise<unknown> }) {
  const me = useAuthStore((s) => s.me);
  const canManage = hasPermission(me, P.VEHICLES_DOCUMENTS_MANAGE);
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<VehicleDocumentDto | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = ['org', orgId, 'vehicle', vehicleId, 'documents'];
  const docs = useQuery({ queryKey: key, queryFn: () => api<VehicleDocumentDto[]>(`/vehicles/${vehicleId}/documents`), enabled: !!orgId });
  const refresh = async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: key }), onChanged()]); };
  const remove = useMutation({
    mutationFn: (id: string) => api(`/vehicles/${vehicleId}/documents/${id}`, { method: 'DELETE' }),
    onSuccess: async () => { setError(null); await refresh(); },
    onError: (e) => setError(e instanceof ApiError ? errorMessage(e.code) : errorMessage(undefined)),
  });

  return (
    <Card className="mt-4 overflow-hidden">
      <CardHeader
        title="Documents"
        description="Records of insurance, inspection, registration and permits. The paper itself is not stored here."
        action={canManage ? <Button size="sm" onClick={() => setEditing('new')}><Plus className="size-4" aria-hidden /> Add record</Button> : undefined}
      />
      {error && <div className="px-6 pb-4"><Alert>{error}</Alert></div>}
      {docs.isPending ? (
        <div className="p-6"><Skeleton className="h-8" /></div>
      ) : docs.isError ? (
        <QueryError query={docs} what="the documents" />
      ) : docs.data.length === 0 ? (
        <EmptyState title="No document records" description={canManage ? 'Record a permit or any paper with an expiry date to be reminded before it runs out.' : 'Document records added by your team appear here.'} />
      ) : (
        <Table>
          <thead><tr><Th>Type</Th><Th>Title</Th><Th>Reference</Th><Th>Issued</Th><Th>Valid through</Th>{canManage && <Th className="text-right">Actions</Th>}</tr></thead>
          <tbody>
            {docs.data.map((d) => (
              <tr key={d.id} className="transition-colors hover:bg-surface-2/70">
                <Td>{DOCUMENT_TYPE_LABEL[d.type]}</Td>
                <Td className="font-bold text-text">{d.title}</Td>
                <Td className="text-text-muted">{d.referenceNumber ?? '—'}</Td>
                <Td className="tabular text-text-muted">{formatDay(d.issuedOn)}</Td>
                <Td><span className="inline-flex flex-wrap items-center gap-2"><span className="tabular">{formatDay(d.expiresOn)}</span>{d.expiry && <ExpiryBadge expiry={d.expiry} />}</span></Td>
                {canManage && (
                  <Td className="text-right">
                    <span className="inline-flex gap-1">
                      <Button size="sm" variant="ghost" aria-label={`Edit ${d.title}`} onClick={() => setEditing(d)}>Edit</Button>
                      <Button size="sm" variant="ghost" className="text-danger" aria-label={`Delete ${d.title}`} loading={remove.isPending && remove.variables === d.id} onClick={() => remove.mutate(d.id)}>Delete</Button>
                    </span>
                  </Td>
                )}
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <DocumentDialog vehicleId={vehicleId} doc={editing === 'new' ? undefined : (editing ?? undefined)} open={editing !== null} onOpenChange={(o) => !o && setEditing(null)} onSaved={refresh} />
    </Card>
  );
}

function DocumentDialog({ vehicleId, doc, open, onOpenChange, onSaved }: { vehicleId: string; doc?: VehicleDocumentDto; open: boolean; onOpenChange: (o: boolean) => void; onSaved: () => Promise<unknown> }) {
  const [formError, setFormError] = useState<string | null>(null);
  const { register, handleSubmit, reset, setError, formState: { errors, isSubmitting } } = useForm<DocumentFormValues>({ defaultValues: emptyDocumentForm });
  useEffect(() => {
    if (open) {
      reset(doc ? documentToForm(doc) : emptyDocumentForm);
      setFormError(null);
    }
  }, [open, doc, reset]);

  async function onSubmit(values: DocumentFormValues) {
    setFormError(null);
    if (!values.title.trim()) {
      setError('title', { message: 'Enter a title' });
      return;
    }
    try {
      await api(doc ? `/vehicles/${vehicleId}/documents/${doc.id}` : `/vehicles/${vehicleId}/documents`, { method: doc ? 'PATCH' : 'POST', body: documentFormToPayload(values) });
      await onSaved();
      onOpenChange(false);
    } catch (err) {
      setFormError(applyApiError(err, setError));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={doc ? 'Edit document record' : 'Add document record'} description="Keep the details and the date it runs out. Uploading the paper itself is not available yet.">
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
        {formError && <Alert>{formError}</Alert>}
        <Field label="Type" htmlFor="doc-type" error={errors.type?.message}>
          <Select id="doc-type" {...register('type')}>{documentTypeOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>
        </Field>
        <Field label="Title" htmlFor="doc-title" error={errors.title?.message}>
          <Input id="doc-title" autoFocus invalid={!!errors.title} {...register('title')} />
        </Field>
        <Field label="Reference number" htmlFor="doc-ref" error={errors.referenceNumber?.message}>
          <Input id="doc-ref" {...register('referenceNumber')} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Issued on" htmlFor="doc-issued" error={errors.issuedOn?.message}>
            <Input id="doc-issued" type="date" invalid={!!errors.issuedOn} {...register('issuedOn')} />
          </Field>
          <Field label="Valid through" htmlFor="doc-expires" error={errors.expiresOn?.message}>
            <Input id="doc-expires" type="date" invalid={!!errors.expiresOn} {...register('expiresOn')} />
          </Field>
        </div>
        <Field label="Notes" htmlFor="doc-notes" error={errors.notes?.message}>
          <textarea id="doc-notes" rows={2} className="w-full rounded-[10px] border border-border bg-surface-2/80 px-3.5 py-2 text-sm text-text" {...register('notes')} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" loading={isSubmitting}>{doc ? 'Save changes' : 'Add record'}</Button>
        </div>
      </form>
    </Dialog>
  );
}
