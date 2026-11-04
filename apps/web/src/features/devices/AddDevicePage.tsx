import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import type { CatalogueModelDto, ConsentNoticeDto, DeviceDto, IdentifierType } from '@gps/shared';
import { Dialog } from '@/components/ui/dialog';
import { Alert, Badge, Button, Card, CardHeader, EmptyState, Field, Input, PageHeader, Skeleton } from '@/components/ui/primitives';
import { QueryError } from '@/features/fleet/fleet-ui';
import { ApiError, api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { applyApiError } from '@/lib/forms';
import { errorMessage } from '@/lib/i18n';
import { devicesKey } from './DevicesPage';
import { COMPATIBILITY_TONE, compatibilityLabel, firmwareRange, groupByManufacturer, identifierError, identifierHint, modelLabel } from './device-model';

export function AddDevicePage() {
  const orgId = useAuthStore((s) => s.me?.activeOrganizationId ?? null);
  return <AddDeviceView key={orgId ?? 'none'} orgId={orgId ?? ''} />;
}

interface Pick {
  model: CatalogueModelDto;
  variantId: string;
}
interface Fields {
  uniqueId: string;
  name: string;
  firmwareVersion: string;
  serialNumber: string;
  simIccid: string;
}

/**
 * Step 1 chooses the model from the catalogue (or says "I don't know" / "it is not listed"); step 2 enters the identifier and,
 * when a notice is published, acknowledges it. Nothing about the device's abilities is assumed from the model name.
 */
function AddDeviceView({ orgId }: { orgId: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<'model' | 'details'>('model');
  const [pick, setPick] = useState<Pick | null>(null);
  const [unidentified, setUnidentified] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const catalogue = useQuery({ queryKey: ['catalogue', orgId], queryFn: () => api<CatalogueModelDto[]>('/catalogue/models'), enabled: !!orgId });
  const notice = useQuery({ queryKey: ['consent', orgId, 'current'], queryFn: () => api<ConsentNoticeDto | null>('/consent/current'), enabled: !!orgId });
  const type: IdentifierType | null = pick?.model.identifierType ?? null;

  const { register, handleSubmit, setError, formState: { errors, isSubmitting } } = useForm<Fields>({ defaultValues: { uniqueId: '', name: '', firmwareVersion: '', serialNumber: '', simIccid: '' } });

  async function onSubmit(v: Fields) {
    setFormError(null);
    const idError = identifierError(v.uniqueId, type);
    if (idError) return setError('uniqueId', { message: idError });
    if (notice.data && !agreed) return setFormError('Read and tick the tracking notice to continue.');
    try {
      const created = await api<DeviceDto>('/devices', {
        method: 'POST',
        body: {
          uniqueId: v.uniqueId.trim(),
          name: v.name.trim() || undefined,
          variantId: pick?.variantId,
          firmwareVersion: v.firmwareVersion.trim() || undefined,
          serialNumber: v.serialNumber.trim() || undefined,
          simIccid: v.simIccid.trim() || undefined,
          acknowledgedNoticeId: notice.data?.id,
        },
      });
      await queryClient.invalidateQueries({ queryKey: devicesKey(orgId) });
      navigate(`/app/devices/${created.id}`);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'DEVICE_IDENTIFIER_UNAVAILABLE') setError('uniqueId', { message: 'This identifier cannot be registered. Check it, or contact support.' });
      else setFormError(applyApiError(err, setError));
    }
  }

  return (
    <div className="space-y-5">
      <Link to="/app/devices" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-text-muted transition-colors hover:text-slate-900"><ArrowLeft className="size-4" aria-hidden /> Devices</Link>
      <PageHeader title="Add a device" description={step === 'model' ? 'Step 1 of 2 — what kind of device is it?' : 'Step 2 of 2 — identify the device'} />

      {step === 'model' ? (
        <Card className="overflow-hidden">
          <CardHeader title="Choose the model" description="We only list models we have catalogued. What each can do is shown honestly: nothing is assumed from the name." />
          {catalogue.isPending ? (
            <div className="space-y-2.5 p-5"><Skeleton className="h-10" /><Skeleton className="h-10" /></div>
          ) : catalogue.isError ? (
            <QueryError query={catalogue} what="the device catalogue" />
          ) : catalogue.data.length === 0 ? (
            <EmptyState title="No models are listed yet" description="You can still register the device without choosing a model, or ask us to support it." />
          ) : (
            <div className="space-y-5 p-5">
              {groupByManufacturer(catalogue.data).map((g) => (
                <fieldset key={g.manufacturer}>
                  <legend className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">{g.manufacturer}</legend>
                  <div className="space-y-2">
                    {g.models.flatMap((m) =>
                      m.variants.map((v) => {
                        const selected = pick?.variantId === v.id;
                        return (
                          <label key={v.id} className={`flex cursor-pointer flex-wrap items-center gap-3 rounded-lg border px-4 py-3 text-[13px] transition-all ${selected ? 'border-brand bg-brand-soft/70 shadow-xs' : 'border-border/80 hover:bg-slate-50/70'}`}>
                            <input type="radio" name="model" className="size-4 accent-brand" checked={selected} onChange={() => { setPick({ model: m, variantId: v.id }); setUnidentified(false); }} />
                            <span className="min-w-0 flex-1">
                              <span className="font-semibold text-slate-900">{modelLabel(m)}</span>
                              <span className="text-text-muted">{v.hardwareRevision ? ` · rev ${v.hardwareRevision}` : ''} · {firmwareRange(v)}</span>
                              {m.isSimulatorProfile && <span className="mt-0.5 block text-xs font-medium text-warn">A software simulator, not a physical device. Sandbox organizations only.</span>}
                            </span>
                            <Badge tone={COMPATIBILITY_TONE[v.compatibilityStatus]}>{compatibilityLabel(v.compatibilityStatus)}</Badge>
                          </label>
                        );
                      }),
                    )}
                  </div>
                </fieldset>
              ))}
            </div>
          )}
          <div className="space-y-2 border-t border-border/70 bg-slate-50/40 px-5 py-4 text-[13px]">
            <label className="flex cursor-pointer items-center gap-2.5 font-medium text-slate-800">
              <input type="radio" name="model" className="size-4 accent-brand" checked={unidentified} onChange={() => { setUnidentified(true); setPick(null); }} />
              I do not know the model. <span className="font-normal text-text-muted">Its capabilities will show as unknown until it is identified.</span>
            </label>
            <p className="text-text-muted">
              Not in the list? <button className="font-medium text-brand hover:underline" onClick={() => setSupportOpen(true)}>Ask us to support your device</button>
            </p>
          </div>
          <div className="flex justify-end border-t border-border/70 px-5 py-3.5">
            <Button disabled={!pick && !unidentified} onClick={() => setStep('details')}>Continue</Button>
          </div>
        </Card>
      ) : (
        <Card className="max-w-2xl">
          <CardHeader title={pick ? modelLabel(pick.model) : 'Model not identified'} action={<Button size="sm" variant="ghost" onClick={() => setStep('model')}>Change model</Button>} />
          <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4 p-5">
            {formError && <Alert>{formError}</Alert>}
            {pick?.model.isSimulatorProfile && <Alert tone="warn">The identifier must start with <strong>SIM-</strong>. Simulated devices are only accepted in sandbox organizations.</Alert>}
            <Field label="Device identifier" htmlFor="dev-id" error={errors.uniqueId?.message} hint={identifierHint(type)}>
              <Input id="dev-id" autoFocus autoComplete="off" invalid={!!errors.uniqueId} {...register('uniqueId')} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name (optional)" htmlFor="dev-name" error={errors.name?.message}><Input id="dev-name" {...register('name')} /></Field>
              <Field label="Firmware version (optional)" htmlFor="dev-fw" error={errors.firmwareVersion?.message}><Input id="dev-fw" {...register('firmwareVersion')} /></Field>
              <Field label="Serial number (optional)" htmlFor="dev-sn" error={errors.serialNumber?.message}><Input id="dev-sn" {...register('serialNumber')} /></Field>
              <Field label="SIM number, ICCID (optional)" htmlFor="dev-sim" error={errors.simIccid?.message} hint="18–22 digits"><Input id="dev-sim" inputMode="numeric" invalid={!!errors.simIccid} {...register('simIccid')} /></Field>
            </div>
            {notice.data && (
              <div className="rounded-lg border border-border/80 bg-slate-50/70 p-4 text-[13px]">
                <p className="font-semibold text-slate-900">{notice.data.title}</p>
                {notice.data.isDraftWording && <p className="mt-1 text-xs font-medium text-warn">Draft wording — not yet reviewed by a lawyer.</p>}
                <p className="mt-2 whitespace-pre-wrap text-text-muted leading-relaxed">{notice.data.body}</p>
                <label className="mt-3.5 flex cursor-pointer items-start gap-2.5 font-medium text-slate-800">
                  <input type="checkbox" className="mt-0.5 size-4 accent-brand" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
                  <span>I have read this notice and confirm it applies to this device.</span>
                </label>
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setStep('model')}>Back</Button>
              <Button type="submit" loading={isSubmitting}>Register device</Button>
            </div>
          </form>
        </Card>
      )}
      <SupportDialog open={supportOpen} onOpenChange={setSupportOpen} />
    </div>
  );
}

function SupportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState({ manufacturerText: '', modelText: '', firmwareText: '', notes: '' });
  const send = useMutation({
    mutationFn: () => api('/device-support-requests', { method: 'POST', body: { manufacturerText: f.manufacturerText.trim(), modelText: f.modelText.trim(), firmwareText: f.firmwareText.trim() || null, notes: f.notes.trim() || null } }),
    onSuccess: () => { setSent(true); setError(null); },
    onError: (e) => setError(e instanceof ApiError ? errorMessage(e.code) : errorMessage(undefined)),
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setSent(false); }} title="Ask us to support your device" description="Tell us what it is. We will check it and add it to the catalogue if we can. Nothing is guessed in the meantime.">
      {sent ? (
        <div className="space-y-4"><Alert tone="ok">Request sent. We will get back to you.</Alert><div className="flex justify-end"><Button onClick={() => onOpenChange(false)}>Close</Button></div></div>
      ) : (
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (f.manufacturerText.trim() && f.modelText.trim()) send.mutate(); }}>
          {error && <Alert>{error}</Alert>}
          <Field label="Manufacturer" htmlFor="sr-maker"><Input id="sr-maker" value={f.manufacturerText} onChange={set('manufacturerText')} /></Field>
          <Field label="Model" htmlFor="sr-model"><Input id="sr-model" value={f.modelText} onChange={set('modelText')} /></Field>
          <Field label="Firmware (optional)" htmlFor="sr-fw"><Input id="sr-fw" value={f.firmwareText} onChange={set('firmwareText')} /></Field>
          <Field label="Anything else (optional)" htmlFor="sr-notes"><Input id="sr-notes" value={f.notes} onChange={set('notes')} /></Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" loading={send.isPending} disabled={!f.manufacturerText.trim() || !f.modelText.trim()}>Send request</Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
