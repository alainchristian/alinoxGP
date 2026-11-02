import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { changePasswordSchema, totpCodeSchema, type SessionInfoDto } from '@gps/shared';
import { Alert, Badge, Button, Card, CardHeader, Field, Input, PageHeader, Skeleton, Table, Td, Th } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { applyApiError } from '@/lib/forms';
import { loadMe } from '@/lib/session';
import { formatDateTime } from '@/lib/utils';

export function AccountPage() {
  const me = useAuthStore((s) => s.me);
  if (!me) return null;
  return (
    <>
      <PageHeader title="My account" description="Your profile and sign-in security." />
      <div className="space-y-6">
        <Card className="max-w-xl">
          <CardHeader title="Profile" />
          <dl className="space-y-3 px-5 py-4 text-[13px]">
            <div className="flex justify-between"><dt className="text-text-muted">Name</dt><dd className="font-medium">{me.user.fullName}</dd></div>
            <div className="flex justify-between"><dt className="text-text-muted">Email</dt><dd className="font-medium">{me.user.email}</dd></div>
            <div className="flex justify-between"><dt className="text-text-muted">Email verified</dt><dd>{me.user.emailVerified ? <Badge tone="ok">Verified</Badge> : <Badge tone="warn">Not verified</Badge>}</dd></div>
          </dl>
        </Card>
        <ChangePassword />
        <TwoFactor />
        <Sessions />
      </div>
    </>
  );
}

const changeSchema = changePasswordSchema;

function ChangePassword() {
  const [msg, setMsg] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);
  const { register, handleSubmit, reset, setError, formState: { errors, isSubmitting } } = useForm<z.input<typeof changeSchema>, unknown, z.output<typeof changeSchema>>({ resolver: zodResolver(changeSchema) });
  async function onSubmit(values: z.output<typeof changeSchema>) {
    setMsg(null);
    try {
      await api('/auth/change-password', { method: 'POST', body: values, noOrg: true });
      reset();
      setMsg({ tone: 'ok', text: 'Password changed. Your other sessions were signed out.' });
    } catch (err) {
      const text = applyApiError(err, setError);
      if (text) setMsg({ tone: 'danger', text });
    }
  }
  return (
    <Card className="max-w-xl">
      <CardHeader title="Password" />
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4 p-5">
        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
        <Field label="Current password" htmlFor="currentPassword" error={errors.currentPassword?.message}>
          <Input id="currentPassword" type="password" autoComplete="current-password" invalid={!!errors.currentPassword} {...register('currentPassword')} />
        </Field>
        <Field label="New password" htmlFor="newPassword" hint="At least 12 characters" error={errors.newPassword?.message}>
          <Input id="newPassword" type="password" autoComplete="new-password" invalid={!!errors.newPassword} {...register('newPassword')} />
        </Field>
        <Button type="submit" loading={isSubmitting}>Change password</Button>
      </form>
    </Card>
  );
}

const codeSchema = z.object({ code: totpCodeSchema });

function TwoFactor() {
  const me = useAuthStore((s) => s.me)!;
  const [enrol, setEnrol] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const [error, setError2] = useState<string | null>(null);
  const [disablePw, setDisablePw] = useState('');
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<z.input<typeof codeSchema>, unknown, z.output<typeof codeSchema>>({ resolver: zodResolver(codeSchema) });

  useEffect(() => {
    // Loaded on demand: the QR library is only needed while enrolling.
    if (enrol) import('qrcode').then((m) => m.default.toDataURL(enrol.otpauthUrl, { margin: 1, width: 168 })).then(setQr, () => setQr(null));
    else setQr(null);
  }, [enrol]);

  const begin = useMutation({
    mutationFn: () => api<{ secret: string; otpauthUrl: string }>('/auth/2fa/enroll', { method: 'POST', noOrg: true }),
    onSuccess: (d) => { setError2(null); setEnrol(d); },
    onError: (e) => setError2(applyApiError(e)),
  });
  async function confirm(values: z.output<typeof codeSchema>) {
    setError2(null);
    try {
      const res = await api<{ recoveryCodes: string[] }>('/auth/2fa/confirm', { method: 'POST', body: values, noOrg: true });
      setRecovery(res.recoveryCodes);
      setEnrol(null);
      reset();
      await loadMe();
    } catch (err) { setError2(applyApiError(err)); }
  }
  const disable = useMutation({
    mutationFn: () => api('/auth/2fa/disable', { method: 'POST', body: { password: disablePw }, noOrg: true }),
    onSuccess: async () => { setDisablePw(''); setRecovery(null); setError2(null); await loadMe(); },
    onError: (e) => setError2(applyApiError(e)),
  });

  return (
    <Card className="max-w-xl">
      <CardHeader title="Two-factor authentication" description="Adds an authenticator-app code to sign-in." action={me.user.totpEnabled ? <Badge tone="ok">On</Badge> : <Badge>Off</Badge>} />
      <div className="space-y-4 p-5">
        {error && <Alert>{error}</Alert>}
        {recovery && (
          <Alert tone="warn">
            <p className="mb-2 font-medium">Save these recovery codes now. Each works once, and they will not be shown again.</p>
            <ul className="tabular grid grid-cols-2 gap-1 font-mono text-[13px]">{recovery.map((c) => <li key={c}>{c}</li>)}</ul>
          </Alert>
        )}
        {!me.user.totpEnabled && !enrol && <Button onClick={() => begin.mutate()} loading={begin.isPending}>Set up authenticator app</Button>}
        {enrol && (
          <form onSubmit={handleSubmit(confirm)} noValidate className="space-y-4">
            <p className="text-[13px] text-text-muted">Scan the code with an authenticator app, or enter the key manually, then type the 6-digit code to confirm.</p>
            {qr && <img src={qr} alt="QR code for your authenticator app" width={168} height={168} className="rounded-md border border-border" />}
            <p className="break-all font-mono text-[13px]">{enrol.secret}</p>
            <Field label="6-digit code" htmlFor="totp-code" error={errors.code?.message}>
              <Input id="totp-code" inputMode="numeric" autoComplete="one-time-code" invalid={!!errors.code} {...register('code')} />
            </Field>
            <div className="flex gap-2">
              <Button type="submit" loading={isSubmitting}>Turn on</Button>
              <Button variant="secondary" onClick={() => setEnrol(null)}>Cancel</Button>
            </div>
          </form>
        )}
        {me.user.totpEnabled && (
          <div className="space-y-3">
            <Field label="Password (to turn off)" htmlFor="disable-pw">
              <Input id="disable-pw" type="password" autoComplete="current-password" value={disablePw} onChange={(e) => setDisablePw(e.target.value)} />
            </Field>
            <Button variant="danger" disabled={!disablePw} loading={disable.isPending} onClick={() => disable.mutate()}>Turn off two-factor</Button>
          </div>
        )}
      </div>
    </Card>
  );
}

function Sessions() {
  const queryClient = useQueryClient();
  const tz = useAuthStore((s) => s.me?.memberships.find((m) => m.organization.id === s.me?.activeOrganizationId)?.organization.timezone);
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => api<SessionInfoDto[]>('/auth/sessions', { noOrg: true }) });
  const revoke = useMutation({
    mutationFn: (id: string) => api(`/auth/sessions/${id}`, { method: 'DELETE', noOrg: true }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sessions'] }),
  });
  return (
    <Card>
      <CardHeader title="Active sessions" description="Devices currently signed in to your account." />
      {sessions.isPending ? <div className="p-5"><Skeleton className="h-10" /></div> : sessions.isError ? <div className="p-5"><Alert>Could not load sessions.</Alert></div> : (
        <Table>
          <thead><tr><Th>Device</Th><Th>IP address</Th><Th>Last active</Th><Th className="text-right">Actions</Th></tr></thead>
          <tbody>
            {sessions.data.map((s) => (
              <tr key={s.id}>
                <Td className="max-w-64 truncate" title={s.userAgent ?? undefined}>{s.userAgent ?? 'Unknown device'}{s.current && <span className="ml-2"><Badge tone="brand">This device</Badge></span>}</Td>
                <Td className="tabular">{s.ip ?? '—'}</Td>
                <Td className="tabular">{formatDateTime(s.lastUsedAt, tz)}</Td>
                <Td className="text-right">{!s.current && <Button size="sm" variant="ghost" className="text-danger" onClick={() => revoke.mutate(s.id)}>Sign out</Button>}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}
