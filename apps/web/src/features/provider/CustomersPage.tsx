import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CUSTOMER_LIMIT_KEYS, P, type CustomerDto, type CustomerLimitDto, type CustomerLimitKey } from '@gps/shared';
import { Dialog } from '@/components/ui/dialog';
import { Alert, Badge, Button, Card, EmptyState, Field, Input, PageHeader, Select, Skeleton, Table, Td, Th } from '@/components/ui/primitives';
import { useStepUp } from '@/components/step-up';
import { Pager, QueryError } from '@/features/fleet/fleet-ui';
import { ApiError, api, apiPaged } from '@/lib/api';
import { hasPermission, useAuthStore } from '@/lib/auth-store';
import { errorMessage } from '@/lib/i18n';
import { homePathFor, switchOrganization } from '@/lib/session';
import { formatDateTime } from '@/lib/utils';
import { LIMIT_LABEL, draftsToLimits, limitsToDrafts, type LimitDraft } from './provider-model';

const fail = (e: unknown) => (e instanceof ApiError ? errorMessage(e.code) : errorMessage(undefined));

export function CustomersPage() {
  const me = useAuthStore((s) => s.me);
  const orgId = me?.activeOrganizationId ?? '';
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const stepUp = useStepUp();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [limitsFor, setLimitsFor] = useState<CustomerDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canManage = hasPermission(me, P.PROVIDER_CUSTOMERS_MANAGE);
  const canSuspend = hasPermission(me, P.PROVIDER_CUSTOMERS_SUSPEND);
  const canLimits = hasPermission(me, P.PROVIDER_CUSTOMERS_LIMITS_MANAGE);
  const canView = hasPermission(me, P.PROVIDER_CUSTOMERS_VIEW_DATA);

  const params = new URLSearchParams({ page: String(page), pageSize: '25' });
  if (search.trim()) params.set('search', search.trim());
  const list = useQuery({
    queryKey: ['provider', orgId, 'customers', params.toString()],
    queryFn: () => apiPaged<CustomerDto>(`/organizations/${orgId}/provider/customers?${params}`),
    placeholderData: keepPreviousData,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['provider', orgId, 'customers'] });

  async function setSuspended(c: CustomerDto, suspend: boolean) {
    setError(null);
    try {
      await stepUp(() => api(`/organizations/${orgId}/provider/customers/${c.id}/${suspend ? 'suspend' : 'reactivate'}`, { method: 'POST', body: {} }));
      await refresh();
    } catch (e) {
      setError(fail(e));
    }
  }

  /** Provider staff look at one customer’s own screens. The API records it in the customer’s access log. */
  async function openCustomer(c: CustomerDto) {
    await switchOrganization(c.id, queryClient);
    navigate(homePathFor(useAuthStore.getState().me));
  }

  return (
    <>
      <PageHeader
        title="Customers"
        description="The people and companies you serve. Each gets its own account and sees only its own vehicles."
        actions={canManage ? <Button onClick={() => setCreating(true)}>New customer</Button> : undefined}
      />
      {error && <div className="mb-4"><Alert>{error}</Alert></div>}
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/80 px-6 pt-5 pb-4">
          <h2 className="text-[16px] font-bold tracking-tight text-text">All customers</h2>
          <Input aria-label="Search customers" placeholder="Search by name" className="w-64" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        </div>
        {list.isPending ? (
          <div className="p-5"><Skeleton className="h-8" /></div>
        ) : list.isError ? (
          <QueryError query={list} what="the customers" />
        ) : list.data.data.length === 0 ? (
          <EmptyState
            title={search ? 'No customer matches' : 'No customers yet'}
            description={search ? 'Try another name.' : 'Create a customer and invite its owner. Then register their vehicles and devices.'}
            action={!search && canManage ? <Button onClick={() => setCreating(true)}>New customer</Button> : undefined}
          />
        ) : (
          <>
            <Table>
              <thead><tr><Th>Customer</Th><Th className="text-right">Vehicles</Th><Th className="text-right">Users</Th><Th>Status</Th><Th>Created</Th><Th className="text-right">Actions</Th></tr></thead>
              <tbody>
                {list.data.data.map((c) => (
                  <tr key={c.id}>
                    <Td>
                      <span className="font-medium">{c.name}</span>
                      {c.isSandbox && <span className="ml-2"><Badge tone="warn">Sandbox</Badge></span>}
                      {c.pendingInvitationCount > 0 && c.memberCount === 0 && <span className="block text-xs text-text-muted">Invitation sent, not accepted yet</span>}
                    </Td>
                    <Td className="tabular text-right">{c.vehicleCount}</Td>
                    <Td className="tabular text-right">{c.memberCount}</Td>
                    <Td><Badge tone={c.status === 'ACTIVE' ? 'ok' : 'danger'}>{c.status === 'ACTIVE' ? 'Active' : 'Suspended'}</Badge></Td>
                    <Td className="tabular">{formatDateTime(c.createdAt)}</Td>
                    <Td className="text-right">
                      <div className="flex flex-wrap justify-end gap-2">
                        {canView && c.status === 'ACTIVE' && <Button size="sm" variant="secondary" onClick={() => void openCustomer(c)}>Open</Button>}
                        {canLimits && <Button size="sm" variant="secondary" onClick={() => setLimitsFor(c)}>Limits</Button>}
                        {canSuspend && (c.status === 'ACTIVE'
                          ? <Button size="sm" variant="secondary" onClick={() => void setSuspended(c, true)}>Suspend</Button>
                          : <Button size="sm" variant="secondary" onClick={() => void setSuspended(c, false)}>Reactivate</Button>)}
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
      <CreateDialog orgId={orgId} open={creating} onOpenChange={setCreating} onDone={refresh} />
      <LimitsDialog orgId={orgId} customer={limitsFor} onOpenChange={(o) => !o && setLimitsFor(null)} />
    </>
  );
}

function CreateDialog({ orgId, open, onOpenChange, onDone }: { orgId: string; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => Promise<unknown> }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => api<CustomerDto>(`/organizations/${orgId}/provider/customers`, { method: 'POST', body: { name: name.trim(), ownerEmail: email.trim() } }),
    onSuccess: async () => { await onDone(); setName(''); setEmail(''); setError(null); onOpenChange(false); },
    onError: (e) => setError(fail(e)),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="New customer" description="We email an invitation to the person who will manage this account. For an individual, use their own name.">
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); setError(null); save.mutate(); }}>
        {error && <Alert>{error}</Alert>}
        <Field label="Customer name" htmlFor="cust-name"><Input id="cust-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Owner’s email" htmlFor="cust-email" hint="The owner accepts the invitation and sets their own password."><Input id="cust-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" loading={save.isPending} disabled={name.trim().length < 2 || !email.includes('@')}>Create and invite</Button>
        </div>
      </form>
    </Dialog>
  );
}

function LimitsDialog({ orgId, customer, onOpenChange }: { orgId: string; customer: CustomerDto | null; onOpenChange: (o: boolean) => void }) {
  const open = customer !== null;
  const [drafts, setDrafts] = useState<Record<CustomerLimitKey, LimitDraft> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = useQuery({
    queryKey: ['provider', orgId, 'limits', customer?.id],
    enabled: open,
    queryFn: async () => {
      const limits = await api<CustomerLimitDto[]>(`/organizations/${orgId}/provider/customers/${customer!.id}/limits`);
      setDrafts(limitsToDrafts(limits));
      return limits;
    },
  });
  const save = useMutation({
    mutationFn: () => api(`/organizations/${orgId}/provider/customers/${customer!.id}/limits`, { method: 'PUT', body: { limits: draftsToLimits(drafts!) } }),
    onSuccess: () => { setError(null); onOpenChange(false); },
    onError: (e) => setError(fail(e)),
  });
  const set = (key: CustomerLimitKey, patch: Partial<LimitDraft>) => setDrafts((d) => (d ? { ...d, [key]: { ...d[key], ...patch } } : d));

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={`Limits for ${customer?.name ?? ''}`} description="Leave a field empty to follow your own plan. These limits are saved now and enforced when subscription plans arrive.">
      {current.isPending || !drafts ? (
        <Skeleton className="h-32" />
      ) : (
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); setError(null); save.mutate(); }}>
          {error && <Alert>{error}</Alert>}
          {CUSTOMER_LIMIT_KEYS.map((key) => {
            const meta = LIMIT_LABEL[key];
            return (
              <div key={key} className="grid grid-cols-[1fr_9rem] items-center gap-3 text-[13px]">
                <label htmlFor={`limit-${key}`} className="font-medium text-text">{meta.label}{meta.unit ? <span className="font-normal text-text-muted"> ({meta.unit})</span> : null}</label>
                {meta.kind === 'number' ? (
                  <Input id={`limit-${key}`} inputMode="numeric" placeholder="Plan default" value={drafts[key].limitValue} onChange={(e) => set(key, { limitValue: e.target.value })} />
                ) : (
                  <Select id={`limit-${key}`} value={drafts[key].enabled} onChange={(e) => set(key, { enabled: e.target.value as LimitDraft['enabled'] })}>
                    <option value="inherit">Plan default</option><option value="on">Allowed</option><option value="off">Not allowed</option>
                  </Select>
                )}
              </div>
            );
          })}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" loading={save.isPending}>Save limits</Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
