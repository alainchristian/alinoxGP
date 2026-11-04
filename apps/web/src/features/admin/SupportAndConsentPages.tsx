import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ConsentNoticeDto, SupportRequestDto } from '@gps/shared';
import { Dialog } from '@/components/ui/dialog';
import { Alert, Badge, Button, Card, EmptyState, Field, Input, PageHeader, Select, Skeleton, Table, Td, Th } from '@/components/ui/primitives';
import { Pager, QueryError } from '@/features/fleet/fleet-ui';
import { ApiError, api, apiPaged } from '@/lib/api';
import { errorMessage } from '@/lib/i18n';
import { formatDateTime } from '@/lib/utils';

const fail = (e: unknown) => (e instanceof ApiError ? errorMessage(e.code) : errorMessage(undefined));

// ---------------------------------------------------------------- "my device is not listed"

export function SupportRequestsPage() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState('OPEN');
  const [page, setPage] = useState(1);
  const [resolving, setResolving] = useState<SupportRequestDto | null>(null);
  const params = new URLSearchParams({ page: String(page), pageSize: '25' });
  if (status) params.set('status', status);
  const list = useQuery({ queryKey: ['admin', 'support', params.toString()], queryFn: () => apiPaged<SupportRequestDto>(`/admin/device-support-requests?${params}`), placeholderData: keepPreviousData });

  return (
    <>
      <PageHeader title="Device support requests" description="Customers whose device is not in the catalogue. Add it to the catalogue (with a recorded test) or decline with a reason." />
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/80 px-6 pt-5 pb-4">
          <div>
            <h2 className="text-[16px] font-bold tracking-tight text-text">Customer requests</h2>
            <p className="text-xs text-text-muted">Filter by request resolution status</p>
          </div>
          <Select aria-label="Status" className="w-44 bg-surface" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">Any status</option><option value="OPEN">Open</option><option value="RESOLVED">Resolved</option><option value="DECLINED">Declined</option>
          </Select>
        </div>
        {list.isPending ? (
          <div className="p-5"><Skeleton className="h-8" /></div>
        ) : list.isError ? (
          <QueryError query={list} what="the requests" />
        ) : list.data.data.length === 0 ? (
          <EmptyState title="No requests" description="Requests from customers appear here." />
        ) : (
          <>
            <Table>
              <thead><tr><Th>Device</Th><Th>Organization</Th><Th>Sent</Th><Th>Status</Th><Th className="text-right">Actions</Th></tr></thead>
              <tbody>
                {list.data.data.map((r) => (
                  <tr key={r.id}>
                    <Td><span className="font-medium">{r.manufacturerText} {r.modelText}</span>{r.firmwareText && <span className="text-text-muted"> · firmware {r.firmwareText}</span>}{r.notes && <div className="text-xs text-text-muted">{r.notes}</div>}</Td>
                    <Td>{r.organization?.name ?? '—'}</Td>
                    <Td className="tabular">{formatDateTime(r.createdAt)}</Td>
                    <Td><Badge tone={r.status === 'OPEN' ? 'warn' : r.status === 'RESOLVED' ? 'ok' : 'neutral'}>{r.status === 'OPEN' ? 'Open' : r.status === 'RESOLVED' ? 'Resolved' : 'Declined'}</Badge>{r.resolutionNote && <div className="text-xs text-text-muted">{r.resolutionNote}</div>}</Td>
                    <Td className="text-right">{r.status === 'OPEN' && <Button size="sm" variant="secondary" onClick={() => setResolving(r)}>Close request</Button>}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pager page={page} pageSize={25} total={list.data.meta.total} onPage={setPage} />
          </>
        )}
      </Card>
      <ResolveDialog request={resolving} onOpenChange={(o) => !o && setResolving(null)} onDone={() => queryClient.invalidateQueries({ queryKey: ['admin', 'support'] })} />
    </>
  );
}

function ResolveDialog({ request, onOpenChange, onDone }: { request: SupportRequestDto | null; onOpenChange: (o: boolean) => void; onDone: () => Promise<unknown> }) {
  const [outcome, setOutcome] = useState<'RESOLVED' | 'DECLINED'>('RESOLVED');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => api(`/admin/device-support-requests/${request!.id}/resolve`, { method: 'POST', body: { status: outcome, resolutionNote: note.trim() || null } }),
    onSuccess: async () => { await onDone(); setNote(''); setError(null); onOpenChange(false); },
    onError: (e) => setError(fail(e)),
  });
  return (
    <Dialog open={!!request} onOpenChange={onOpenChange} title="Close request" description={request ? `${request.manufacturerText} ${request.modelText}` : undefined}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        {error && <Alert>{error}</Alert>}
        <Field label="Outcome" htmlFor="rs-out"><Select id="rs-out" value={outcome} onChange={(e) => setOutcome(e.target.value as 'RESOLVED' | 'DECLINED')}><option value="RESOLVED">Resolved (added or answered)</option><option value="DECLINED">Declined</option></Select></Field>
        <Field label="Note for the customer (optional)" htmlFor="rs-note"><Input id="rs-note" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" loading={save.isPending}>Close request</Button></div>
      </form>
    </Dialog>
  );
}

// ---------------------------------------------------------------- consent notices

type Notice = ConsentNoticeDto & { status: string; publishedAt: string | null };

export function ConsentNoticesPage() {
  const queryClient = useQueryClient();
  const notices = useQuery({ queryKey: ['admin', 'consent'], queryFn: () => api<Notice[]>('/admin/consent/notices') });
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin', 'consent'] });
  const publish = useMutation({
    mutationFn: (id: string) => api(`/admin/consent/notices/${id}/publish`, { method: 'POST' }),
    onSuccess: async () => { setError(null); await refresh(); },
    onError: (e) => setError(fail(e)),
  });

  return (
    <>
      <PageHeader
        title="Tracking notices"
        description="The notice customers acknowledge before registering a device. A published notice never changes: a new wording is a new version. Wording must be reviewed by a lawyer before it is marked as final."
        actions={<Button onClick={() => setOpen(true)}>New version</Button>}
      />
      {error && <div className="mb-4"><Alert>{error}</Alert></div>}
      <Card>
        {notices.isPending ? (
          <div className="p-5"><Skeleton className="h-16" /></div>
        ) : notices.isError ? (
          <QueryError query={notices} what="the notices" />
        ) : notices.data.length === 0 ? (
          <EmptyState title="No notice yet" description="Without a published notice, device registration does not ask customers to acknowledge anything." />
        ) : (
          <ul className="divide-y divide-border">
            {notices.data.map((n) => (
              <li key={n.id} className="space-y-1.5 px-5 py-4 text-[13px]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">Version {n.version} — {n.title}</p>
                  <span className="flex items-center gap-2">
                    {n.isDraftWording && <Badge tone="warn">Draft wording</Badge>}
                    <Badge tone={n.status === 'PUBLISHED' ? 'ok' : 'neutral'}>{n.status === 'PUBLISHED' ? 'In force' : n.status === 'DRAFT' ? 'Not published' : 'Retired'}</Badge>
                    {n.status === 'DRAFT' && <Button size="sm" loading={publish.isPending && publish.variables === n.id} onClick={() => publish.mutate(n.id)}>Publish</Button>}
                  </span>
                </div>
                <p className="whitespace-pre-wrap text-text-muted">{n.body}</p>
                {n.publishedAt && <p className="text-xs text-text-muted">Published {formatDateTime(n.publishedAt)}</p>}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <DraftDialog open={open} onOpenChange={setOpen} onDone={refresh} />
    </>
  );
}

function DraftDialog({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; onDone: () => Promise<unknown> }) {
  const [f, setF] = useState({ title: 'Vehicle tracking notice', body: '', isDraftWording: true });
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => api('/admin/consent/notices', { method: 'POST', body: { title: f.title.trim(), body: f.body.trim(), isDraftWording: f.isDraftWording } }),
    onSuccess: async () => { await onDone(); setError(null); onOpenChange(false); },
    onError: (e) => setError(fail(e)),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="lg" title="New notice version" description="It is saved as a draft. Publishing it makes it the notice customers must acknowledge and retires the current one.">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (f.title.trim() && f.body.trim()) save.mutate(); }}>
        {error && <Alert>{error}</Alert>}
        <Field label="Title" htmlFor="cn-title"><Input id="cn-title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Text" htmlFor="cn-body"><textarea id="cn-body" rows={8} className="w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></Field>
        <label className="flex cursor-pointer items-center gap-2 text-[13px]"><input type="checkbox" className="size-4" checked={f.isDraftWording} onChange={(e) => setF({ ...f, isDraftWording: e.target.checked })} /> This wording has not been reviewed by a lawyer yet (customers see a warning)</label>
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" loading={save.isPending} disabled={!f.title.trim() || !f.body.trim()}>Save draft</Button></div>
      </form>
    </Dialog>
  );
}
