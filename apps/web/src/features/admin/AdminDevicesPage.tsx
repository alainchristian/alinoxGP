import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Search } from 'lucide-react';
import { CAPABILITY_LABEL, CAPABILITY_STATE_LABEL, DEVICE_LIFECYCLE_STATUSES, type AdminDeviceRowDto, type CatalogueModelDto, type DeviceDiagnosticsDto, type DeviceLifecycleStatus } from '@gps/shared';
import { Dialog } from '@/components/ui/dialog';
import { Alert, Badge, Button, Card, CardHeader, EmptyState, Field, Input, PageHeader, Select, Skeleton, Table, Td, Th } from '@/components/ui/primitives';
import { CAPABILITY_TONE, LIFECYCLE_LABEL, OBSERVED_LABEL, displayStatusTone } from '@/features/devices/device-model';
import { DetailRow, Pager, QueryError, SimulatedBadge, useDebounced } from '@/features/fleet/fleet-ui';
import { ApiError, api, apiPaged } from '@/lib/api';
import { errorMessage } from '@/lib/i18n';
import { formatDateTime, formatRelative } from '@/lib/utils';

const PAGE_SIZE = 25;
const fail = (e: unknown) => (e instanceof ApiError ? errorMessage(e.code) : errorMessage(undefined));

/** Technical administrators: find any device, see why it is not communicating. Read-only apart from three audited actions. */
export function AdminDevicesPage() {
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim());
  const [status, setStatus] = useState('');
  const [stuck, setStuck] = useState(false);
  const [page, setPage] = useState(1);
  const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (q) params.set('q', q);
  if (status) params.set('status', status);
  if (stuck) params.set('stuck', 'true');
  const devices = useQuery({ queryKey: ['admin', 'devices', params.toString()], queryFn: () => apiPaged<AdminDeviceRowDto>(`/admin/devices?${params}`), placeholderData: keepPreviousData });

  return (
    <>
      <PageHeader title="Devices" description="Every device on the platform, across organizations. Open one to see why it may not be communicating." />
      <Card className="overflow-hidden">
        <div className="space-y-3 border-b border-border/80 px-6 pt-5 pb-4">
          <div>
            <h2 className="text-[16px] font-bold tracking-tight text-text">Platform device inventory</h2>
            <p className="text-xs text-text-muted">Filter by identifier, lifecycle state or onboarding delay</p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5 pt-1">
            <div className="relative min-w-52 flex-1">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-text-faint" aria-hidden />
              <Input aria-label="Search devices" placeholder="Search identifier, name or serial number" className="pl-9" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
            </div>
            <Select aria-label="Lifecycle status" className="w-52 bg-surface" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
              <option value="">Any lifecycle status</option>
              {DEVICE_LIFECYCLE_STATUSES.map((s) => <option key={s} value={s}>{LIFECYCLE_LABEL[s]}</option>)}
            </Select>
            <label className="flex cursor-pointer items-center gap-2 rounded-[10px] border border-border bg-surface px-3.5 h-10 text-xs font-medium text-text hover:bg-surface-2">
              <input type="checkbox" className="size-4 accent-brand" checked={stuck} onChange={(e) => { setStuck(e.target.checked); setPage(1); }} /> Waiting over 24 h for a first signal
            </label>
          </div>
        </div>
        {devices.isPending ? (
          <div className="space-y-2 p-5"><Skeleton className="h-8" /><Skeleton className="h-8" /></div>
        ) : devices.isError ? (
          <QueryError query={devices} what="devices" />
        ) : devices.data.data.length === 0 ? (
          <EmptyState title="No devices match" description="Try a different search or clear the filters." />
        ) : (
          <>
            <Table>
              <thead><tr><Th>Identifier</Th><Th>Organization</Th><Th>Model</Th><Th>Status</Th><Th>Last heard from</Th></tr></thead>
              <tbody>
                {devices.data.data.map((d) => (
                  <tr key={d.id} className="hover:bg-surface-2">
                    <Td><Link to={`/admin/devices/${d.id}`} className="tabular font-medium text-brand hover:underline">{d.uniqueId}</Link>{d.isSimulated && <span className="ml-2"><SimulatedBadge /></span>}</Td>
                    <Td>{d.organizationName ?? '—'}</Td>
                    <Td>{d.variantLabel ?? <span className="text-text-muted">Not identified</span>}</Td>
                    <Td>
                      <Badge tone={displayStatusTone({ lifecycleStatus: d.lifecycleStatus, displayStatus: d.displayStatus })}>{d.displayStatus}</Badge>
                      {d.awaitingFirstSignalTooLong && <div className="mt-1"><Badge tone="warn">Waiting over 24 h</Badge></div>}
                    </Td>
                    <Td className="tabular">{d.lastSeenAt ? formatRelative(d.lastSeenAt) : <span className="text-text-muted">Never</span>}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pager page={page} pageSize={PAGE_SIZE} total={devices.data.meta.total} onPage={setPage} />
          </>
        )}
      </Card>
    </>
  );
}

export function AdminDeviceDetailPage() {
  const { deviceId = '' } = useParams();
  const queryClient = useQueryClient();
  const key = ['admin', 'device', deviceId];
  const diag = useQuery({ queryKey: key, queryFn: () => api<DeviceDiagnosticsDto>(`/admin/devices/${deviceId}/diagnostics`) });
  const [lifecycleOpen, setLifecycleOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const put = (d: DeviceDiagnosticsDto) => { queryClient.setQueryData(key, d); void queryClient.invalidateQueries({ queryKey: ['admin', 'devices'] }); };
  const resync = useMutation({ mutationFn: () => api<DeviceDiagnosticsDto>(`/admin/devices/${deviceId}/resync`, { method: 'POST' }), onSuccess: (d) => { setError(null); put(d); }, onError: (e) => setError(fail(e)) });

  const Back = () => <Link to="/admin/devices" className="mb-3 inline-flex items-center gap-1 text-[13px] text-text-muted hover:text-text"><ArrowLeft className="size-4" aria-hidden /> Devices</Link>;
  if (diag.isPending) return <div className="space-y-3"><Skeleton className="h-8 w-64" /><Skeleton className="h-40" /></div>;
  if (diag.isError) return <><Back /><Card>{diag.error instanceof ApiError && diag.error.status === 404 ? <EmptyState title="Device not found" description="It may have been removed." /> : <QueryError query={diag} what="the diagnostics" />}</Card></>;
  const { device: d, engine, notes, capabilities, history } = diag.data;

  return (
    <>
      <Back />
      <PageHeader
        title={d.uniqueId}
        description={d.organization?.name}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {d.isSimulated && <SimulatedBadge />}
            <Badge tone={displayStatusTone({ lifecycleStatus: d.lifecycleStatus, displayStatus: d.displayStatus })}>{d.displayStatus}</Badge>
            <Button size="sm" variant="secondary" loading={resync.isPending} onClick={() => resync.mutate()}>Re-sync with the GPS engine</Button>
            <Button size="sm" onClick={() => setLifecycleOpen(true)}>Change status</Button>
          </div>
        }
      />
      {error && <div className="mb-4"><Alert>{error}</Alert></div>}
      <Card className="mb-4">
        <CardHeader title="What we found" description="Plain-language findings from the device record, the GPS engine and what the platform has received." />
        {notes.length === 0 ? <p className="px-5 py-4 text-[13px] text-text-muted">Nothing unusual found.</p> : <ul className="list-disc space-y-1 px-9 py-4 text-[13px]">{notes.map((n) => <li key={n}>{n}</li>)}</ul>}
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Device" />
          <dl className="px-5 py-3 text-[13px]">
            <DetailRow label="Lifecycle">{LIFECYCLE_LABEL[d.lifecycleStatus]}</DetailRow>
            <DetailRow label="Connectivity">{d.connectivity === 'ONLINE' ? 'Online' : d.connectivity === 'OFFLINE' ? 'Offline' : 'Never connected'}</DetailRow>
            <DetailRow label="Model">{d.variantLabel ?? 'Not identified'}</DetailRow>
            <DetailRow label="Firmware">{d.firmwareVersion ?? '—'}</DetailRow>
            <DetailRow label="Serial number">{d.serialNumber ?? '—'}</DetailRow>
            <DetailRow label="SIM (ICCID)"><span className="tabular">{d.simIccid ?? '—'}</span></DetailRow>
            <DetailRow label="Registered">{formatDateTime(d.createdAt)}</DetailRow>
            <DetailRow label="First GPS signal">{d.firstSignalAt ? formatDateTime(d.firstSignalAt) : 'Not yet'}</DetailRow>
            <DetailRow label="Last heard from">{d.lastSeenAt ? formatDateTime(d.lastSeenAt) : 'Never'}</DetailRow>
          </dl>
          <IdentifyModel deviceId={deviceId} current={d.variantLabel} onDone={put} />
        </Card>
        <Card>
          <CardHeader title="GPS engine" />
          <dl className="px-5 py-3 text-[13px]">
            <DetailRow label="Reachable">{engine.reachable ? 'Yes' : 'No — the engine could not be asked'}</DetailRow>
            <DetailRow label="Knows this identifier">{!engine.reachable ? 'Unknown' : engine.known ? 'Yes' : 'No'}</DetailRow>
            <DetailRow label="Engine status">{engine.engineStatus ?? 'Unknown'}</DetailRow>
            <DetailRow label="Engine last update">{engine.lastUpdate ? formatDateTime(engine.lastUpdate) : '—'}</DetailRow>
            <DetailRow label="Synchronisation">{engine.syncStatus.toLowerCase()}</DetailRow>
            {engine.syncError && <DetailRow label="Last sync error"><span className="font-normal">{engine.syncError}</span></DetailRow>}
            <DetailRow label="Protocol (catalogue)">{engine.protocol ?? 'Unknown'}</DetailRow>
          </dl>
        </Card>
      </div>
      <Card className="mt-4">
        <CardHeader title="Effective capabilities" />
        <Table>
          <thead><tr><Th>Capability</Th><Th>Status</Th><Th>Why</Th></tr></thead>
          <tbody>
            {capabilities.map((c) => (
              <tr key={c.key}>
                <Td className="font-medium">{CAPABILITY_LABEL[c.key]}</Td>
                <Td><Badge tone={CAPABILITY_TONE[c.state]}>{CAPABILITY_STATE_LABEL[c.state]}</Badge></Td>
                <Td className="text-text-muted">{c.reason}<span className="mt-0.5 block text-xs">{OBSERVED_LABEL[c.observed]}</span></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
      <Card className="mt-4">
        <CardHeader title="Status history" />
        <Table>
          <thead><tr><Th>When</Th><Th>Change</Th><Th>By</Th><Th>Reason</Th></tr></thead>
          <tbody>
            {history.map((h) => (
              <tr key={h.id}>
                <Td className="tabular">{formatDateTime(h.at)}</Td>
                <Td>{h.fromStatus ? `${LIFECYCLE_LABEL[h.fromStatus]} → ` : ''}<strong>{LIFECYCLE_LABEL[h.toStatus]}</strong></Td>
                <Td>{h.byUser ? 'Staff or customer' : 'The platform'}</Td>
                <Td className="text-text-muted">{h.reason ?? '—'}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
      <LifecycleDialog open={lifecycleOpen} onOpenChange={setLifecycleOpen} deviceId={deviceId} current={d.lifecycleStatus} onDone={put} />
    </>
  );
}

function IdentifyModel({ deviceId, current, onDone }: { deviceId: string; current: string | null; onDone: (d: DeviceDiagnosticsDto) => void }) {
  const [variantId, setVariantId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const catalogue = useQuery({ queryKey: ['admin', 'catalogue'], queryFn: () => api<CatalogueModelDto[]>('/admin/catalogue/models') });
  const save = useMutation({
    mutationFn: () => api<DeviceDiagnosticsDto>(`/admin/devices/${deviceId}/variant`, { method: 'PUT', body: { variantId: variantId || null } }),
    onSuccess: (d) => { setError(null); onDone(d); },
    onError: (e) => setError(fail(e)),
  });
  return (
    <div className="space-y-2 border-t border-border px-5 py-4 text-[13px]">
      {error && <Alert>{error}</Alert>}
      <label htmlFor="adm-variant" className="block font-medium">{current ? 'Change the model' : 'Identify the model'}</label>
      <div className="flex gap-2">
        <Select id="adm-variant" value={variantId} onChange={(e) => setVariantId(e.target.value)}>
          <option value="">{current ? 'Clear the model (unknown)' : 'Choose a model…'}</option>
          {(catalogue.data ?? []).flatMap((m) => m.variants.map((v) => <option key={v.id} value={v.id}>{m.manufacturer.name} {m.name}{v.hardwareRevision ? ` rev ${v.hardwareRevision}` : ''}</option>))}
        </Select>
        <Button loading={save.isPending} disabled={!variantId && !current} onClick={() => save.mutate()}>Save</Button>
      </div>
    </div>
  );
}

function LifecycleDialog({ open, onOpenChange, deviceId, current, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; deviceId: string; current: DeviceLifecycleStatus; onDone: (d: DeviceDiagnosticsDto) => void }) {
  const [status, setStatus] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => api<DeviceDiagnosticsDto>(`/admin/devices/${deviceId}/lifecycle`, { method: 'POST', body: { status, reason: reason.trim() } }),
    onSuccess: (d) => { setError(null); setStatus(''); setReason(''); onDone(d); onOpenChange(false); },
    onError: (e) => setError(fail(e)),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Change device status" description={`Now: ${LIFECYCLE_LABEL[current]}. The change and your reason are recorded in the device history and the audit log.`}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (status && reason.trim()) save.mutate(); }}>
        {error && <Alert>{error}</Alert>}
        <Field label="New status" htmlFor="lc-status">
          <Select id="lc-status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Choose…</option>
            {DEVICE_LIFECYCLE_STATUSES.filter((s) => s !== current).map((s) => <option key={s} value={s}>{LIFECYCLE_LABEL[s]}</option>)}
          </Select>
        </Field>
        <Field label="Reason" htmlFor="lc-reason"><Input id="lc-reason" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} /></Field>
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" loading={save.isPending} disabled={!status || !reason.trim()}>Change status</Button></div>
      </form>
    </Dialog>
  );
}
