import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PROVIDER_STATUSES, P, type ProviderProfileDto, type ProviderStatus } from '@gps/shared';
import { Dialog } from '@/components/ui/dialog';
import { useStepUp } from '@/components/step-up';
import { Alert, Badge, Button, Card, EmptyState, Field, Input, PageHeader, Select, Skeleton, Table, Td, Th } from '@/components/ui/primitives';
import { Pager, QueryError } from '@/features/fleet/fleet-ui';
import { PROVIDER_STATUS_LABEL, adminActions, providerStatusTone } from '@/features/provider/provider-model';
import { ApiError, api, apiPaged } from '@/lib/api';
import { hasPermission, useAuthStore } from '@/lib/auth-store';
import { errorMessage } from '@/lib/i18n';
import { formatDateTime } from '@/lib/utils';

const fail = (e: unknown) => (e instanceof ApiError ? errorMessage(e.code) : errorMessage(undefined));
type Action = 'approve' | 'reject' | 'suspend' | 'reactivate';
const ACTION_LABEL: Record<Action, string> = { approve: 'Approve', reject: 'Reject', suspend: 'Suspend', reactivate: 'Reactivate' };

/** Platform administrators review provider registrations and decide who may operate (spec Module 16). */
export function ProvidersPage() {
  const queryClient = useQueryClient();
  const me = useAuthStore((s) => s.me);
  const [status, setStatus] = useState<ProviderStatus | ''>('PENDING_APPROVAL');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [deciding, setDeciding] = useState<{ provider: ProviderProfileDto; action: Action } | null>(null);
  const canApprove = hasPermission(me, P.PLATFORM_PROVIDERS_APPROVE);
  const canSuspend = hasPermission(me, P.PLATFORM_PROVIDERS_SUSPEND);
  const params = new URLSearchParams({ page: String(page), pageSize: '25' });
  if (status) params.set('status', status);
  if (search.trim()) params.set('search', search.trim());
  const list = useQuery({ queryKey: ['admin', 'providers', params.toString()], queryFn: () => apiPaged<ProviderProfileDto>(`/admin/providers?${params}`), placeholderData: keepPreviousData });

  const allowed = (a: Action) => (a === 'approve' || a === 'reject' ? canApprove : canSuspend);

  return (
    <>
      <PageHeader title="Providers" description="GPS tracking businesses that registered. Approve them before they can run real customers and devices." />
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-border/80 px-6 pt-5 pb-4">
          <Select aria-label="Status" className="w-56" value={status} onChange={(e) => { setStatus(e.target.value as ProviderStatus | ''); setPage(1); }}>
            <option value="">Any status</option>
            {PROVIDER_STATUSES.map((s) => <option key={s} value={s}>{PROVIDER_STATUS_LABEL[s]}</option>)}
          </Select>
          <Input aria-label="Search providers" placeholder="Company or contact email" className="w-64" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        </div>
        {list.isPending ? (
          <div className="p-5"><Skeleton className="h-8" /></div>
        ) : list.isError ? (
          <QueryError query={list} what="the providers" />
        ) : list.data.data.length === 0 ? (
          <EmptyState title="No providers here" description={status === 'PENDING_APPROVAL' ? 'No registration is waiting for approval.' : 'Change the filters.'} />
        ) : (
          <>
            <Table>
              <thead><tr><Th>Company</Th><Th>Contact</Th><Th>Registered</Th><Th>Status</Th><Th className="text-right">Decision</Th></tr></thead>
              <tbody>
                {list.data.data.map((p) => (
                  <tr key={p.organizationId}>
                    <Td>
                      <span className="font-medium">{p.companyName}</span>
                      <span className="block text-xs text-text-muted">{[p.registrationNumber && `Reg. ${p.registrationNumber}`, p.tin && `TIN ${p.tin}`, p.expectedDevices != null && `${p.expectedDevices} devices expected`].filter(Boolean).join(' · ') || 'No registration details'}</span>
                    </Td>
                    <Td>{p.contactName}<span className="block text-xs text-text-muted">{p.contactEmail}{p.contactPhone ? ` · ${p.contactPhone}` : ''}</span></Td>
                    <Td className="tabular">{formatDateTime(p.createdAt)}</Td>
                    <Td><Badge tone={providerStatusTone(p.status)}>{PROVIDER_STATUS_LABEL[p.status]}</Badge></Td>
                    <Td className="text-right">
                      <div className="flex flex-wrap justify-end gap-2">
                        {adminActions(p.status).filter(allowed).map((a) => <Button key={a} size="sm" variant="secondary" onClick={() => setDeciding({ provider: p, action: a })}>{ACTION_LABEL[a]}</Button>)}
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pager page={page} pageSize={25} total={list.data.meta.total} onPage={setPage} />
          </>
        )}
      </Card>
      <DecisionDialog decision={deciding} onOpenChange={(o) => !o && setDeciding(null)} onDone={() => queryClient.invalidateQueries({ queryKey: ['admin', 'providers'] })} />
    </>
  );
}

function DecisionDialog({ decision, onOpenChange, onDone }: { decision: { provider: ProviderProfileDto; action: Action } | null; onOpenChange: (o: boolean) => void; onDone: () => Promise<unknown> }) {
  const stepUp = useStepUp();
  const [reason, setReason] = useState('');
  const [licence, setLicence] = useState('');
  const [trial, setTrial] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const action = decision?.action;
  const needsReason = action === 'reject' || action === 'suspend';
  const save = useMutation({
    mutationFn: () => {
      const body = action === 'approve' ? { licenceNumber: licence.trim() || undefined, trial } : action === 'reactivate' ? {} : { reason: reason.trim() };
      return stepUp(() => api(`/admin/providers/${decision!.provider.organizationId}/${action}`, { method: 'POST', body }));
    },
    onSuccess: async () => { await onDone(); setReason(''); setLicence(''); setError(null); onOpenChange(false); },
    onError: (e) => setError(fail(e)),
  });
  const name = decision?.provider.companyName ?? '';
  const description =
    action === 'approve' ? 'The provider can then create real customers and register real devices.'
    : action === 'reject' ? 'The provider is told the reason. A rejection is final.'
    : action === 'suspend' ? 'The provider’s console is blocked and its customers see a neutral “contact your provider” message. Tracking data keeps arriving and nothing is deleted.'
    : 'Access is restored immediately.';
  return (
    <Dialog open={decision !== null} onOpenChange={onOpenChange} title={`${action ? ACTION_LABEL[action] : ''} ${name}`} description={description}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); setError(null); save.mutate(); }}>
        {error && <Alert>{error}</Alert>}
        {action === 'approve' && (
          <>
            <Field label="Licence reference (optional)" htmlFor="p-licence" hint="For example a RURA authorisation number, if you collected evidence."><Input id="p-licence" value={licence} onChange={(e) => setLicence(e.target.value)} /></Field>
            <label className="flex items-center gap-2.5 text-[13px]"><input type="checkbox" className="size-4 rounded border-border" checked={trial} onChange={(e) => setTrial(e.target.checked)} /> Start with a trial</label>
          </>
        )}
        {needsReason && <Field label="Reason" htmlFor="p-reason" hint="Shown to the provider and kept in the audit log."><Input id="p-reason" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} /></Field>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" loading={save.isPending} disabled={needsReason && reason.trim().length < 3}>{action ? ACTION_LABEL[action] : ''}</Button>
        </div>
      </form>
    </Dialog>
  );
}
