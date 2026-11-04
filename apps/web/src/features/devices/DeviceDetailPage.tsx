import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import {
  CAPABILITY_LABEL,
  CAPABILITY_STATE_LABEL,
  P,
  type CatalogueModelDto,
  type DeviceCapabilitiesDto,
  type DeviceConfigurationDto,
  type DeviceDto,
  type DeviceStatusHistoryDto,
  type VehicleDto,
} from '@gps/shared';
import { Alert, Badge, Button, Card, CardHeader, EmptyState, PageHeader, Select, Skeleton, Table, Td, Th } from '@/components/ui/primitives';
import { DetailRow, isSimulatedDevice, QueryError, SimulatedBadge } from '@/features/fleet/fleet-ui';
import { ApiError, api, apiPaged } from '@/lib/api';
import { hasPermission, useAuthStore } from '@/lib/auth-store';
import { errorMessage } from '@/lib/i18n';
import { formatDateTime } from '@/lib/utils';
import { devicesKey } from './DevicesPage';
import { CAPABILITY_TONE, canConfirmConfigured, displayStatusTone, isWaitingForSignal, LIFECYCLE_LABEL, OBSERVED_LABEL } from './device-model';

export function DeviceDetailPage() {
  const orgId = useAuthStore((s) => s.me?.activeOrganizationId ?? null);
  const { deviceId = '' } = useParams();
  return <DeviceDetailView key={`${orgId ?? 'none'}:${deviceId}`} orgId={orgId ?? ''} deviceId={deviceId} />;
}

const fail = (e: unknown) => (e instanceof ApiError ? errorMessage(e.code) : errorMessage(undefined));

function DeviceDetailView({ orgId, deviceId }: { orgId: string; deviceId: string }) {
  const me = useAuthStore((s) => s.me);
  const queryClient = useQueryClient();
  const canRegister = hasPermission(me, P.DEVICES_REGISTER);
  const canAssign = hasPermission(me, P.DEVICES_ASSIGN);
  const canCaps = hasPermission(me, P.DEVICES_CAPABILITIES_READ);
  const timezone = me?.memberships.find((m) => m.organization.id === orgId)?.organization.timezone;
  const base = [...devicesKey(orgId), deviceId];

  // While we wait for the first signal the page checks by itself; otherwise it does not poll.
  const device = useQuery({
    queryKey: base,
    queryFn: () => api<DeviceDto>(`/devices/${deviceId}`),
    enabled: !!orgId,
    refetchInterval: (q) => (q.state.data && isWaitingForSignal(q.state.data.lifecycleStatus) ? 5000 : false),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: [...devicesKey(orgId)] });

  if (device.isPending) return <div className="space-y-3"><Skeleton className="h-8 w-64" /><Skeleton className="h-40" /><Skeleton className="h-40" /></div>;
  if (device.isError) {
    const notFound = device.error instanceof ApiError && device.error.status === 404;
    return (
      <>
        <Back />
        <Card>{notFound ? <EmptyState title="Device not found" description="It may belong to another organization, or it no longer exists." action={<Link className="text-[13px] text-brand underline" to="/app/devices">Back to devices</Link>} /> : <QueryError query={device} what="this device" />}</Card>
      </>
    );
  }
  const d = device.data;

  return (
    <div className="space-y-5">
      <Back />
      <PageHeader
        title={d.name ?? d.uniqueId}
        description={d.name ? d.uniqueId : undefined}
        actions={<div className="flex items-center gap-2">{isSimulatedDevice(d.uniqueId) && <SimulatedBadge />}<Badge tone={displayStatusTone(d)}>{d.displayStatus}</Badge></div>}
      />
      <OnboardingCard device={d} canRegister={canRegister} onChanged={refresh} />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Details" />
          <dl className="px-6 py-3 text-[13px]">
            <DetailRow label="Identifier"><span className="tabular">{d.uniqueId}</span></DetailRow>
            <DetailRow label="Model">{d.variant ? d.variant.label : 'Not identified'}</DetailRow>
            <DetailRow label="Firmware">{d.firmwareVersion ?? '—'}</DetailRow>
            <DetailRow label="Serial number">{d.serialNumber ?? '—'}</DetailRow>
            <DetailRow label="SIM number (ICCID)"><span className="tabular">{d.simIccid ?? '—'}</span></DetailRow>
            <DetailRow label="Registered">{formatDateTime(d.createdAt, timezone)}</DetailRow>
            <DetailRow label="First GPS signal">{d.firstSignalAt ? formatDateTime(d.firstSignalAt, timezone) : 'Not yet'}</DetailRow>
            <DetailRow label="Last heard from">{d.lastSeenAt ? formatDateTime(d.lastSeenAt, timezone) : 'Never'}</DetailRow>
          </dl>
          {canRegister && <IdentifyModel device={d} orgId={orgId} onChanged={refresh} />}
        </Card>
        <InstallationCard device={d} orgId={orgId} canAssign={canAssign} onChanged={refresh} />
      </div>
      {canCaps && <CapabilitiesCard deviceId={deviceId} orgId={orgId} refreshKey={d.lifecycleStatus + (d.lastSeenAt ?? '')} />}
      <HistoryCard deviceId={deviceId} orgId={orgId} timezone={timezone} refreshKey={d.lifecycleStatus} />
    </div>
  );
}

const Back = () => (
  <Link to="/app/devices" className="mb-1 inline-flex items-center gap-1.5 text-[13px] font-medium text-text-muted transition-colors hover:text-slate-900"><ArrowLeft className="size-4" aria-hidden /> Devices</Link>
);

// ---------------------------------------------------------------- onboarding

function OnboardingCard({ device: d, canRegister, onChanged }: { device: DeviceDto; canRegister: boolean; onChanged: () => Promise<unknown> }) {
  const [error, setError] = useState<string | null>(null);
  const showConfig = canConfirmConfigured(d.lifecycleStatus) || isWaitingForSignal(d.lifecycleStatus);
  const config = useQuery({ queryKey: ['device-config', d.id, d.variant?.id ?? 'none'], queryFn: () => api<DeviceConfigurationDto>(`/devices/${d.id}/configuration`), enabled: showConfig });
  const confirm = useMutation({
    mutationFn: () => api(`/devices/${d.id}/configured`, { method: 'POST' }),
    onSuccess: async () => { setError(null); await onChanged(); },
    onError: (e) => setError(fail(e)),
  });

  if (d.lifecycleStatus === 'ACTIVE') {
    return (
      <Alert tone={d.connectivity === 'ONLINE' ? 'ok' : 'neutral'}>
        {d.connectivity === 'ONLINE' ? 'This device is sending data.' : 'This device has sent data before but has not been heard from recently.'}
        {!d.assignment && ' It is not installed on a vehicle yet, so it does not appear on the map.'}
      </Alert>
    );
  }
  if (d.lifecycleStatus === 'SUSPENDED') return <Alert tone="danger">This device is suspended. Contact support to find out why.</Alert>;
  if (d.lifecycleStatus === 'RETIRED') return <Alert tone="neutral">This device has been retired.</Alert>;

  return (
    <Card>
      <CardHeader title={isWaitingForSignal(d.lifecycleStatus) ? 'Waiting for the first GPS signal' : 'Set up the device'} description={isWaitingForSignal(d.lifecycleStatus) ? 'This page checks by itself every few seconds.' : 'Point the device at the platform, then tell us when it is done.'} />
      <div className="space-y-4 px-5 py-4 text-[13px]">
        {error && <Alert>{error}</Alert>}
        {d.lifecycleStatus === 'CONFIGURATION_ERROR' && <Alert tone="danger">A technician found a problem with the configuration. Check the settings below and confirm again.</Alert>}
        {config.isPending ? (
          <Skeleton className="h-24" />
        ) : config.isError ? (
          <QueryError query={config} what="the setup instructions" />
        ) : (
          <>
            <dl>
              <DetailRow label="Server address">{config.data.serverHost ?? 'Not available yet'}</DetailRow>
              <DetailRow label="Port">{config.data.port ?? 'Not available yet'}</DetailRow>
              <DetailRow label="Protocol">{config.data.protocol ?? 'Not available yet'}</DetailRow>
              <DetailRow label="Device identifier"><span className="tabular">{config.data.identifier}</span></DetailRow>
            </dl>
            {config.data.notes && <p className="whitespace-pre-wrap rounded-md bg-surface-2 p-3">{config.data.notes}</p>}
            {config.data.missing.length > 0 && (
              <Alert tone="warn">
                <p className="font-medium">We do not have all the information yet:</p>
                <ul className="ml-4 list-disc">{config.data.missing.map((m) => <li key={m}>{m}</li>)}</ul>
                <p className="mt-1">We never guess these. Contact support if you need them.</p>
              </Alert>
            )}
          </>
        )}
        {canConfirmConfigured(d.lifecycleStatus) && canRegister && (
          <div className="flex justify-end"><Button loading={confirm.isPending} onClick={() => confirm.mutate()}>I have configured the device</Button></div>
        )}
        {isWaitingForSignal(d.lifecycleStatus) && (
          <p className="text-text-muted">
            {d.lastSeenAt ? 'The device has contacted the platform but has not sent a usable position yet. Make sure it has a GPS view of the sky.' : 'Nothing has been received from this device yet. Power it on, check the SIM has data and the settings above.'}
          </p>
        )}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- identify the model

function IdentifyModel({ device: d, orgId, onChanged }: { device: DeviceDto; orgId: string; onChanged: () => Promise<unknown> }) {
  const [variantId, setVariantId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const catalogue = useQuery({ queryKey: ['catalogue', orgId], queryFn: () => api<CatalogueModelDto[]>('/catalogue/models'), enabled: !d.variant });
  const save = useMutation({
    mutationFn: () => api(`/devices/${d.id}/variant`, { method: 'PUT', body: { variantId } }),
    onSuccess: async () => { setError(null); await onChanged(); },
    onError: (e) => setError(fail(e)),
  });
  if (d.variant) return null;
  return (
    <div className="space-y-2 border-t border-border px-5 py-4 text-[13px]">
      {error && <Alert>{error}</Alert>}
      <label htmlFor="identify-model" className="block font-medium">Identify the model</label>
      <div className="flex gap-2">
        <Select id="identify-model" value={variantId} onChange={(e) => setVariantId(e.target.value)}>
          <option value="">Choose a model…</option>
          {(catalogue.data ?? []).flatMap((m) => m.variants.map((v) => <option key={v.id} value={v.id}>{m.manufacturer.name} {m.name}{v.hardwareRevision ? ` rev ${v.hardwareRevision}` : ''}</option>))}
        </Select>
        <Button loading={save.isPending} disabled={!variantId} onClick={() => save.mutate()}>Save</Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- installation

function InstallationCard({ device: d, orgId, canAssign, onChanged }: { device: DeviceDto; orgId: string; canAssign: boolean; onChanged: () => Promise<unknown> }) {
  const [vehicleId, setVehicleId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const free = useQuery({
    queryKey: ['org', orgId, 'vehicles', 'without-device'],
    queryFn: () => apiPaged<VehicleDto>('/vehicles?hasDevice=false&pageSize=100'),
    enabled: !!orgId && canAssign && !d.assignment,
  });
  const qc = useQueryClient();
  const run = (path: string, body: object) =>
    api(`/devices/${d.id}/${path}`, { method: 'POST', body }).then(async () => {
      setError(null);
      setVehicleId('');
      await Promise.all([onChanged(), qc.invalidateQueries({ queryKey: ['org', orgId, 'vehicles'] }), qc.invalidateQueries({ queryKey: ['org', orgId, 'dashboard'] })]);
    });
  const assign = useMutation({ mutationFn: () => run('assign', { vehicleId }), onError: (e) => setError(fail(e)) });
  const unassign = useMutation({ mutationFn: () => run('unassign', {}), onError: (e) => setError(fail(e)) });

  return (
    <Card>
      <CardHeader title="Installation" />
      <div className="px-5 py-4 text-[13px]">
        {error && <div className="mb-3"><Alert>{error}</Alert></div>}
        {d.assignment ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p>Installed on <Link to={`/app/vehicles/${d.assignment.vehicleId}`} className="font-medium text-brand hover:underline">{d.assignment.registrationNumber}</Link></p>
            {canAssign && <Button size="sm" variant="secondary" loading={unassign.isPending} onClick={() => unassign.mutate()}>Remove from vehicle</Button>}
          </div>
        ) : canAssign ? (
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-52 flex-1">
              <label htmlFor="assign-vehicle" className="mb-1.5 block font-medium">Not installed. Install on a vehicle</label>
              <Select id="assign-vehicle" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} disabled={free.isPending}>
                <option value="">{free.isPending ? 'Loading vehicles…' : (free.data?.data.length ?? 0) === 0 ? 'No vehicles without a tracker' : 'Choose a vehicle'}</option>
                {(free.data?.data ?? []).map((v) => <option key={v.id} value={v.id}>{v.registrationNumber}</option>)}
              </Select>
            </div>
            <Button loading={assign.isPending} disabled={!vehicleId} onClick={() => assign.mutate()}>Install</Button>
          </div>
        ) : (
          <p className="text-text-muted">This device is not installed on a vehicle.</p>
        )}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- capabilities

function CapabilitiesCard({ deviceId, orgId, refreshKey }: { deviceId: string; orgId: string; refreshKey: string }) {
  const caps = useQuery({ queryKey: [...devicesKey(orgId), deviceId, 'capabilities', refreshKey], queryFn: () => api<DeviceCapabilitiesDto>(`/devices/${deviceId}/capabilities`), enabled: !!orgId });
  return (
    <Card className="mt-4">
      <CardHeader title="What this device can do" description="From the catalogue and from what the device has actually sent. The model name alone is never used, and what is not known is shown as unknown." />
      {caps.isPending ? (
        <div className="p-5"><Skeleton className="h-32" /></div>
      ) : caps.isError ? (
        <QueryError query={caps} what="the capabilities" />
      ) : (
        <>
          {!caps.data.variant && <div className="px-5 pt-4"><Alert tone="neutral">The model of this device has not been identified, so nothing can be confirmed yet.</Alert></div>}
          <Table>
            <thead><tr><Th>Capability</Th><Th>Status</Th><Th>Why</Th></tr></thead>
            <tbody>
              {caps.data.capabilities.map((c) => (
                <tr key={c.key}>
                  <Td className="font-medium">{CAPABILITY_LABEL[c.key]}</Td>
                  <Td><Badge tone={CAPABILITY_TONE[c.state]}>{CAPABILITY_STATE_LABEL[c.state]}</Badge></Td>
                  <Td className="text-text-muted">
                    {c.reason}
                    <span className="mt-0.5 block text-xs">{OBSERVED_LABEL[c.observed]}</span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- history

function HistoryCard({ deviceId, orgId, timezone, refreshKey }: { deviceId: string; orgId: string; timezone?: string; refreshKey: string }) {
  const history = useQuery({ queryKey: [...devicesKey(orgId), deviceId, 'history', refreshKey], queryFn: () => api<DeviceStatusHistoryDto[]>(`/devices/${deviceId}/history`), enabled: !!orgId });
  return (
    <Card className="mt-4">
      <CardHeader title="Status history" />
      {history.isPending ? (
        <div className="p-5"><Skeleton className="h-16" /></div>
      ) : history.isError ? (
        <QueryError query={history} what="the history" />
      ) : (
        <Table>
          <thead><tr><Th>When</Th><Th>Change</Th><Th>By</Th><Th>Reason</Th></tr></thead>
          <tbody>
            {history.data.map((h) => (
              <tr key={h.id}>
                <Td className="tabular">{formatDateTime(h.at, timezone)}</Td>
                <Td>{h.fromStatus ? `${LIFECYCLE_LABEL[h.fromStatus]} → ` : ''}<strong>{LIFECYCLE_LABEL[h.toStatus]}</strong></Td>
                <Td>{h.byUser ? 'A person' : 'The platform'}</Td>
                <Td className="text-text-muted">{h.reason ?? '—'}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}
