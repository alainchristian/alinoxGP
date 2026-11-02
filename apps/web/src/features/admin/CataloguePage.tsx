import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import {
  CAPABILITY_KEYS,
  CAPABILITY_LABEL,
  CAPABILITY_SUPPORTS,
  COMPATIBILITY_STATUSES,
  IDENTIFIER_TYPES,
  type CapabilityKey,
  type CapabilitySupport,
  type CatalogueModelDto,
  type VariantDto,
} from '@gps/shared';
import { Dialog } from '@/components/ui/dialog';
import { Alert, Badge, Button, Card, CardHeader, EmptyState, Field, Input, PageHeader, Select, Skeleton, Table, Td, Th } from '@/components/ui/primitives';
import { QueryError } from '@/features/fleet/fleet-ui';
import { COMPATIBILITY_TONE, compatibilityLabel, firmwareRange } from '@/features/devices/device-model';
import { ApiError, api } from '@/lib/api';
import { errorMessage } from '@/lib/i18n';
import { formatDateTime } from '@/lib/utils';

const KEY = ['admin', 'catalogue'];
const SUPPORT_LABEL: Record<CapabilitySupport, string> = { SUPPORTED: 'Supported', PARTIAL: 'Partially supported', NOT_SUPPORTED: 'Not supported', REQUIRES_CONFIGURATION: 'Requires configuration' };
const fail = (e: unknown) => (e instanceof ApiError ? errorMessage(e.code) : errorMessage(undefined));

/** Platform staff manage the device catalogue (spec Module 6). "Verified" needs a recorded test; that rule is enforced by the server and the database. */
export function CataloguePage() {
  const queryClient = useQueryClient();
  const models = useQuery({ queryKey: KEY, queryFn: () => api<CatalogueModelDto[]>('/admin/catalogue/models') });
  const [makerOpen, setMakerOpen] = useState(false);
  const [modelDialog, setModelDialog] = useState<CatalogueModelDto | 'new' | null>(null);
  const [variantFor, setVariantFor] = useState<CatalogueModelDto | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: KEY });

  return (
    <>
      <PageHeader
        title="Device catalogue"
        description="Which devices the platform supports, with the evidence behind every claim. A capability with no row is unknown, not unsupported. Nothing is verified without a recorded test."
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setMakerOpen(true)}>Add manufacturer</Button>
            <Button onClick={() => setModelDialog('new')}><Plus className="size-4" aria-hidden /> Add model</Button>
          </div>
        }
      />
      {models.isPending ? (
        <Card><div className="space-y-2 p-5"><Skeleton className="h-8" /><Skeleton className="h-8" /></div></Card>
      ) : models.isError ? (
        <Card><QueryError query={models} what="the catalogue" /></Card>
      ) : models.data.length === 0 ? (
        <Card><EmptyState title="The catalogue is empty" description="Add a manufacturer and a model. Entries made from documentation alone can be at most “Supported but not physically verified”." /></Card>
      ) : (
        <div className="space-y-4">
          {models.data.map((m) => <ModelCard key={m.id} model={m} onEdit={() => setModelDialog(m)} onAddVariant={() => setVariantFor(m)} onChanged={refresh} />)}
        </div>
      )}
      <ManufacturerDialog open={makerOpen} onOpenChange={setMakerOpen} onDone={refresh} />
      <ModelDialog model={modelDialog === 'new' ? undefined : (modelDialog ?? undefined)} open={modelDialog !== null} onOpenChange={(o) => !o && setModelDialog(null)} onDone={refresh} />
      <VariantDialog model={variantFor} onOpenChange={(o) => !o && setVariantFor(null)} onDone={refresh} />
    </>
  );
}

function ModelCard({ model: m, onEdit, onAddVariant, onChanged }: { model: CatalogueModelDto; onEdit: () => void; onAddVariant: () => void; onChanged: () => Promise<unknown> }) {
  return (
    <Card>
      <CardHeader
        title={`${m.manufacturer.name} ${m.name}`}
        description={`${m.protocol}${m.enginePort ? ` · port ${m.enginePort}` : ' · port not recorded'} · identifier: ${m.identifierType.toLowerCase()}`}
        action={
          <div className="flex items-center gap-2">
            {m.isSimulatorProfile && <Badge tone="warn">Simulator profile, not hardware</Badge>}
            <Badge tone={m.isListed ? 'ok' : 'neutral'}>{m.isListed ? 'Listed for customers' : 'Not listed'}</Badge>
            <Button size="sm" variant="secondary" onClick={onEdit}>Edit</Button>
            <Button size="sm" onClick={onAddVariant}>Add variant</Button>
          </div>
        }
      />
      {m.variants.length === 0 ? (
        <EmptyState title="No variants" description="Add a variant (hardware revision and firmware range) to record capabilities and tests." />
      ) : (
        <Table>
          <thead><tr><Th>Variant</Th><Th>Status</Th><Th>Capabilities recorded</Th><Th>Last tested</Th><Th className="text-right">Actions</Th></tr></thead>
          <tbody>{m.variants.map((v) => <VariantRow key={v.id} variant={v} onChanged={onChanged} />)}</tbody>
        </Table>
      )}
    </Card>
  );
}

function VariantRow({ variant: v, onChanged }: { variant: VariantDto; onChanged: () => Promise<unknown> }) {
  const [capsOpen, setCapsOpen] = useState(false);
  const [testsOpen, setTestsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setStatus = useMutation({
    mutationFn: (status: string) => api(`/admin/catalogue/variants/${v.id}`, { method: 'PATCH', body: { compatibilityStatus: status } }),
    onSuccess: async () => { setError(null); await onChanged(); },
    onError: (e) => setError(fail(e)),
  });
  return (
    <>
      <tr>
        <Td>
          <span className="font-medium">{v.hardwareRevision ? `Revision ${v.hardwareRevision}` : 'Any revision'}</span>
          <div className="text-xs text-text-muted">{firmwareRange(v)}</div>
          {v.notes && <div className="text-xs text-text-muted">{v.notes}</div>}
        </Td>
        <Td>
          <Select aria-label="Compatibility status" className="h-8 w-64 text-[13px]" value={v.compatibilityStatus} disabled={setStatus.isPending} onChange={(e) => setStatus.mutate(e.target.value)}>
            {COMPATIBILITY_STATUSES.map((s) => <option key={s} value={s}>{compatibilityLabel(s)}</option>)}
          </Select>
          <div className="mt-1"><Badge tone={COMPATIBILITY_TONE[v.compatibilityStatus]}>{compatibilityLabel(v.compatibilityStatus)}</Badge></div>
          {error && <p role="alert" className="mt-1 max-w-60 text-xs text-danger">{error}</p>}
        </Td>
        <Td className="tabular">{v.capabilities.length} of {CAPABILITY_KEYS.length}</Td>
        <Td className="tabular">{v.lastTestedAt ? formatDateTime(v.lastTestedAt) : <span className="text-text-muted">Never</span>}</Td>
        <Td className="whitespace-nowrap text-right">
          <span className="inline-flex gap-1">
            <Button size="sm" variant="ghost" onClick={() => setCapsOpen(true)}>Capabilities</Button>
            <Button size="sm" variant="ghost" onClick={() => setTestsOpen(true)}>Tests ({v.verifications.length})</Button>
          </span>
        </Td>
      </tr>
      <CapabilitiesDialog variant={v} open={capsOpen} onOpenChange={setCapsOpen} onDone={onChanged} />
      <VerificationsDialog variant={v} open={testsOpen} onOpenChange={setTestsOpen} onDone={onChanged} />
    </>
  );
}

// ---------------------------------------------------------------- dialogs

function ManufacturerDialog({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; onDone: () => Promise<unknown> }) {
  const [name, setName] = useState('');
  const [website, setWebsite] = useState('');
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => api('/admin/catalogue/manufacturers', { method: 'POST', body: { name: name.trim(), website: website.trim() || null } }),
    onSuccess: async () => { await onDone(); setName(''); setWebsite(''); setError(null); onOpenChange(false); },
    onError: (e) => setError(fail(e)),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Add manufacturer">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (name.trim()) save.mutate(); }}>
        {error && <Alert>{error}</Alert>}
        <Field label="Name" htmlFor="mk-name"><Input id="mk-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Website (optional)" htmlFor="mk-web"><Input id="mk-web" value={website} onChange={(e) => setWebsite(e.target.value)} /></Field>
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" loading={save.isPending} disabled={!name.trim()}>Add</Button></div>
      </form>
    </Dialog>
  );
}

interface ModelForm {
  manufacturerId: string; name: string; protocol: string; enginePort: string; identifierType: string; networkTechnologies: string;
  reportingNotes: string; configurationNotes: string; installationRequirements: string; knownLimitations: string; docsUrl: string; isListed: boolean;
}
const emptyModel: ModelForm = { manufacturerId: '', name: '', protocol: '', enginePort: '', identifierType: 'IMEI', networkTechnologies: '', reportingNotes: '', configurationNotes: '', installationRequirements: '', knownLimitations: '', docsUrl: '', isListed: false };
const blank = (s: string) => (s.trim() === '' ? null : s.trim());

function ModelDialog({ model, open, onOpenChange, onDone }: { model?: CatalogueModelDto; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => Promise<unknown> }) {
  const [f, setF] = useState<ModelForm>(emptyModel);
  const [error, setError] = useState<string | null>(null);
  const makers = useQuery({ queryKey: [...KEY, 'manufacturers'], queryFn: () => api<{ id: string; name: string }[]>('/admin/catalogue/manufacturers'), enabled: open && !model });
  useEffect(() => {
    if (!open) return;
    setError(null);
    setF(model ? { manufacturerId: model.manufacturer.id, name: model.name, protocol: model.protocol, enginePort: model.enginePort ? String(model.enginePort) : '', identifierType: model.identifierType, networkTechnologies: model.networkTechnologies.join(', '), reportingNotes: model.reportingNotes ?? '', configurationNotes: model.configurationNotes ?? '', installationRequirements: model.installationRequirements ?? '', knownLimitations: model.knownLimitations ?? '', docsUrl: model.docsUrl ?? '', isListed: model.isListed } : emptyModel);
  }, [open, model]);
  const set = (k: keyof ModelForm) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: f.name.trim(),
        protocol: f.protocol.trim(),
        enginePort: f.enginePort.trim() ? Number(f.enginePort) : null,
        identifierType: f.identifierType,
        networkTechnologies: f.networkTechnologies.split(',').map((x) => x.trim()).filter(Boolean),
        reportingNotes: blank(f.reportingNotes), configurationNotes: blank(f.configurationNotes), installationRequirements: blank(f.installationRequirements),
        knownLimitations: blank(f.knownLimitations), docsUrl: blank(f.docsUrl), isListed: f.isListed,
      };
      return model ? api(`/admin/catalogue/models/${model.id}`, { method: 'PATCH', body }) : api('/admin/catalogue/models', { method: 'POST', body: { manufacturerId: f.manufacturerId, ...body } });
    },
    onSuccess: async () => { await onDone(); onOpenChange(false); },
    onError: (e) => setError(fail(e)),
  });
  const ready = f.name.trim() && f.protocol.trim() && (model || f.manufacturerId);
  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="lg" title={model ? 'Edit model' : 'Add model'} description="Setup notes are shown to customers with the server address and port. Leave anything you do not know empty: it is then reported as missing, not guessed.">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (ready) save.mutate(); }}>
        {error && <Alert>{error}</Alert>}
        <div className="grid gap-3 sm:grid-cols-2">
          {!model && (
            <Field label="Manufacturer" htmlFor="md-maker">
              <Select id="md-maker" value={f.manufacturerId} onChange={set('manufacturerId')}>
                <option value="">Choose…</option>
                {(makers.data ?? []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </Select>
            </Field>
          )}
          <Field label="Model name" htmlFor="md-name"><Input id="md-name" value={f.name} onChange={set('name')} /></Field>
          <Field label="Engine protocol" htmlFor="md-proto" hint="Must have a decoder in the pinned GPS engine"><Input id="md-proto" value={f.protocol} onChange={set('protocol')} /></Field>
          <Field label="Port devices connect to" htmlFor="md-port"><Input id="md-port" inputMode="numeric" value={f.enginePort} onChange={set('enginePort')} /></Field>
          <Field label="Identifier" htmlFor="md-idtype"><Select id="md-idtype" value={f.identifierType} onChange={set('identifierType')}>{IDENTIFIER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</Select></Field>
          <Field label="Networks (comma separated)" htmlFor="md-net"><Input id="md-net" value={f.networkTechnologies} onChange={set('networkTechnologies')} /></Field>
        </div>
        <Field label="Setup notes for customers" htmlFor="md-cfg"><textarea id="md-cfg" rows={3} className="w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm" value={f.configurationNotes} onChange={set('configurationNotes')} /></Field>
        <Field label="Known limitations" htmlFor="md-lim"><Input id="md-lim" value={f.knownLimitations} onChange={set('knownLimitations')} /></Field>
        <Field label="Installation requirements" htmlFor="md-inst"><Input id="md-inst" value={f.installationRequirements} onChange={set('installationRequirements')} /></Field>
        <Field label="Documentation link" htmlFor="md-docs"><Input id="md-docs" value={f.docsUrl} onChange={set('docsUrl')} /></Field>
        <label className="flex cursor-pointer items-center gap-2 text-[13px]"><input type="checkbox" className="size-4" checked={f.isListed} onChange={(e) => setF({ ...f, isListed: e.target.checked })} /> Offer this model to customers during onboarding</label>
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" loading={save.isPending} disabled={!ready}>{model ? 'Save' : 'Add model'}</Button></div>
      </form>
    </Dialog>
  );
}

function VariantDialog({ model, onOpenChange, onDone }: { model: CatalogueModelDto | null; onOpenChange: (o: boolean) => void; onDone: () => Promise<unknown> }) {
  const [f, setF] = useState({ hardwareRevision: '', firmwareMin: '', firmwareMax: '', notes: '' });
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => api('/admin/catalogue/variants', { method: 'POST', body: { modelId: model!.id, hardwareRevision: blank(f.hardwareRevision), firmwareMin: blank(f.firmwareMin), firmwareMax: blank(f.firmwareMax), notes: blank(f.notes) } }),
    onSuccess: async () => { await onDone(); setF({ hardwareRevision: '', firmwareMin: '', firmwareMax: '', notes: '' }); setError(null); onOpenChange(false); },
    onError: (e) => setError(fail(e)),
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <Dialog open={!!model} onOpenChange={onOpenChange} title={model ? `Add variant — ${model.name}` : 'Add variant'} description="New variants start as “Supported but not physically verified”. Record a test to be able to verify one.">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        {error && <Alert>{error}</Alert>}
        <Field label="Hardware revision (optional)" htmlFor="vr-hw"><Input id="vr-hw" value={f.hardwareRevision} onChange={set('hardwareRevision')} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Firmware from (optional)" htmlFor="vr-min"><Input id="vr-min" value={f.firmwareMin} onChange={set('firmwareMin')} /></Field>
          <Field label="Firmware up to (optional)" htmlFor="vr-max"><Input id="vr-max" value={f.firmwareMax} onChange={set('firmwareMax')} /></Field>
        </div>
        <Field label="Notes (optional)" htmlFor="vr-notes"><Input id="vr-notes" value={f.notes} onChange={set('notes')} /></Field>
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" loading={save.isPending}>Add variant</Button></div>
      </form>
    </Dialog>
  );
}

function CapabilitiesDialog({ variant: v, open, onOpenChange, onDone }: { variant: VariantDto; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => Promise<unknown> }) {
  const [error, setError] = useState<string | null>(null);
  const byKey = new Map(v.capabilities.map((c) => [c.key, c]));
  const set = useMutation({
    mutationFn: ({ key, support }: { key: CapabilityKey; support: string }) =>
      support === ''
        ? api(`/admin/catalogue/variants/${v.id}/capabilities/${key}`, { method: 'DELETE' })
        : api(`/admin/catalogue/variants/${v.id}/capabilities/${key}`, { method: 'PUT', body: { support, evidenceAttribute: byKey.get(key)?.evidenceAttribute ?? null, evidenceNotes: byKey.get(key)?.evidenceNotes ?? null } }),
    onSuccess: async () => { setError(null); await onDone(); },
    onError: (e) => setError(fail(e)),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="lg" title="Capabilities of this variant" description="Choose “Unknown” when the catalogue has no evidence. Unknown is not the same as not supported.">
      <div className="space-y-3">
        {error && <Alert>{error}</Alert>}
        <ul className="divide-y divide-border rounded-md border border-border">
          {CAPABILITY_KEYS.map((key) => (
            <li key={key} className="flex items-center justify-between gap-3 px-3 py-2 text-[13px]">
              <label htmlFor={`cap-${key}`}>{CAPABILITY_LABEL[key]}</label>
              <Select id={`cap-${key}`} className="h-8 w-56 text-[13px]" value={byKey.get(key)?.support ?? ''} disabled={set.isPending} onChange={(e) => set.mutate({ key, support: e.target.value })}>
                <option value="">Unknown (no evidence)</option>
                {CAPABILITY_SUPPORTS.map((s) => <option key={s} value={s}>{SUPPORT_LABEL[s]}</option>)}
              </Select>
            </li>
          ))}
        </ul>
        <p className="text-xs text-text-muted">Remote immobilization can only be marked supported on a verified variant, and is never switched on for a customer by this catalogue alone.</p>
        <div className="flex justify-end"><Button variant="secondary" onClick={() => onOpenChange(false)}>Close</Button></div>
      </div>
    </Dialog>
  );
}

function VerificationsDialog({ variant: v, open, onOpenChange, onDone }: { variant: VariantDto; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => Promise<unknown> }) {
  const [f, setF] = useState({ testedAt: new Date().toISOString().slice(0, 10), testedByName: '', firmwareVersion: '', procedure: '', evidence: '' });
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const add = useMutation({
    mutationFn: () => api(`/admin/catalogue/variants/${v.id}/verifications`, { method: 'POST', body: { ...f, testedAt: new Date(`${f.testedAt}T12:00:00Z`).toISOString() } }),
    onSuccess: async () => { setError(null); setF({ ...f, procedure: '', evidence: '' }); await onDone(); },
    onError: (e) => setError(fail(e)),
  });
  const ready = f.testedAt && f.testedByName.trim() && f.firmwareVersion.trim() && f.procedure.trim() && f.evidence.trim();
  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="lg" title="Recorded tests" description="A variant can only be marked as verified when at least one test is recorded here. Tests are never edited or deleted.">
      <div className="space-y-4">
        {v.verifications.length === 0 ? (
          <p className="text-[13px] text-text-muted">No test has been recorded for this variant.</p>
        ) : (
          <ul className="space-y-2">
            {v.verifications.map((x) => (
              <li key={x.id} className="rounded-md border border-border p-3 text-[13px]">
                <p className="font-medium">{formatDateTime(x.testedAt)} · {x.testedByName} · firmware {x.firmwareVersion}</p>
                <p className="mt-1 whitespace-pre-wrap text-text-muted">{x.procedure}</p>
                <p className="mt-1 whitespace-pre-wrap">{x.evidence}</p>
              </li>
            ))}
          </ul>
        )}
        <form className="space-y-3 border-t border-border pt-4" onSubmit={(e) => { e.preventDefault(); if (ready) add.mutate(); }}>
          <h3 className="text-sm font-semibold">Record a test</h3>
          {error && <Alert>{error}</Alert>}
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Date" htmlFor="vt-date"><Input id="vt-date" type="date" value={f.testedAt} onChange={set('testedAt')} /></Field>
            <Field label="Tested by" htmlFor="vt-by"><Input id="vt-by" value={f.testedByName} onChange={set('testedByName')} /></Field>
            <Field label="Firmware tested" htmlFor="vt-fw"><Input id="vt-fw" value={f.firmwareVersion} onChange={set('firmwareVersion')} /></Field>
          </div>
          <Field label="Procedure" htmlFor="vt-proc"><textarea id="vt-proc" rows={2} className="w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm" value={f.procedure} onChange={set('procedure')} /></Field>
          <Field label="Evidence (what was observed, where it is kept)" htmlFor="vt-ev"><textarea id="vt-ev" rows={2} className="w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm" value={f.evidence} onChange={set('evidence')} /></Field>
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => onOpenChange(false)}>Close</Button><Button type="submit" loading={add.isPending} disabled={!ready}>Record test</Button></div>
        </form>
      </div>
    </Dialog>
  );
}
