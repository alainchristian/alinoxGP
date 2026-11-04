import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import type { z } from 'zod';
import { inviteMemberSchema, P, ROLE_KEYS, type InvitationDto, type MemberDto, type RoleDto } from '@gps/shared';
import { Dialog } from '@/components/ui/dialog';
import { Alert, Badge, Button, Card, CardHeader, EmptyState, Field, Input, PageHeader, Select, Skeleton, Table, Td, Th } from '@/components/ui/primitives';
import { useStepUp } from '@/components/step-up';
import { ApiError, api, apiPaged } from '@/lib/api';
import { hasPermission, useAuthStore } from '@/lib/auth-store';
import { applyApiError } from '@/lib/forms';
import { errorMessage, roleLabel } from '@/lib/i18n';
import { formatDateTime } from '@/lib/utils';

/** Roles that can never be handed out through the UI (Owner changes need an ownership-transfer flow; Super Admin is CLI-only). */
const NOT_ASSIGNABLE: string[] = [ROLE_KEYS.ORG_OWNER, ROLE_KEYS.PLATFORM_SUPER_ADMIN];

type InviteValues = z.input<typeof inviteMemberSchema>;

export function UsersPage({ title = 'Users & Permissions' }: { title?: string }) {
  const me = useAuthStore((s) => s.me);
  const orgId = me?.activeOrganizationId ?? '';
  const queryClient = useQueryClient();
  const stepUp = useStepUp();
  const canInvite = hasPermission(me, P.USERS_INVITE);
  const canUpdate = hasPermission(me, P.USERS_UPDATE);
  const canRemove = hasPermission(me, P.USERS_REMOVE);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [removing, setRemoving] = useState<MemberDto | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const members = useQuery({ queryKey: ['org', orgId, 'members'], queryFn: () => apiPaged<MemberDto>(`/organizations/${orgId}/members?pageSize=100`), enabled: !!orgId });
  const invitations = useQuery({ queryKey: ['org', orgId, 'invitations'], queryFn: () => api<InvitationDto[]>(`/organizations/${orgId}/invitations`), enabled: !!orgId });
  const roles = useQuery({ queryKey: ['org', orgId, 'roles'], queryFn: () => api<RoleDto[]>(`/organizations/${orgId}/roles`), enabled: !!orgId && hasPermission(me, P.ROLES_READ) });
  const assignable = (roles.data ?? []).filter((r) => !NOT_ASSIGNABLE.includes(r.key));
  const myUserId = me?.user.id;

  const refresh = () => Promise.all([queryClient.invalidateQueries({ queryKey: ['org', orgId, 'members'] }), queryClient.invalidateQueries({ queryKey: ['org', orgId, 'invitations'] })]);

  const updateMember = useMutation({
    mutationFn: (v: { memberId: string; roleKeys?: string[]; status?: 'ACTIVE' | 'SUSPENDED' }) =>
      stepUp(() => api(`/organizations/${orgId}/members/${v.memberId}`, { method: 'PATCH', body: { roleKeys: v.roleKeys, status: v.status } })),
    onSuccess: () => { setActionError(null); return refresh(); },
    onError: (e) => setActionError(e instanceof ApiError ? errorMessage(e.code) : null),
  });
  const removeMember = useMutation({
    mutationFn: (memberId: string) => stepUp(() => api(`/organizations/${orgId}/members/${memberId}`, { method: 'DELETE' })),
    onSuccess: () => { setRemoving(null); setActionError(null); return refresh(); },
    onError: (e) => { setRemoving(null); setActionError(e instanceof ApiError ? errorMessage(e.code) : null); },
  });
  const revokeInvitation = useMutation({
    mutationFn: (id: string) => api(`/organizations/${orgId}/invitations/${id}`, { method: 'DELETE' }),
    onSuccess: refresh,
    onError: (e) => setActionError(e instanceof ApiError ? errorMessage(e.code) : null),
  });

  return (
    <>
      <PageHeader
        title={title}
        description="Who can access this organization and what they are allowed to do. Permissions are enforced by the server."
        actions={canInvite ? <Button onClick={() => setInviteOpen(true)}><Plus className="size-4" aria-hidden /> Invite user</Button> : undefined}
      />
      {actionError && <div className="mb-4"><Alert>{actionError}</Alert></div>}

      <Card className="mb-6 overflow-hidden">
        <CardHeader title="Members" description="Active and suspended users in this organization" />
        {members.isPending ? (
          <div className="space-y-2.5 p-6"><Skeleton className="h-10" /><Skeleton className="h-10" /><Skeleton className="h-10" /></div>
        ) : members.isError ? (
          <div className="p-6">
            <Alert>
              {members.error instanceof ApiError ? errorMessage(members.error.code) : 'Could not load members.'}{' '}
              <button className="underline" onClick={() => members.refetch()}>Retry</button>
            </Alert>
          </div>
        ) : (
          <Table>
            <thead>
              <tr><Th>Name</Th><Th>Email</Th><Th>Role</Th><Th>Status</Th>{(canUpdate || canRemove) && <Th className="text-right">Actions</Th>}</tr>
            </thead>
            <tbody>
              {members.data.data.map((m) => {
                const isOwner = m.roleKeys.includes(ROLE_KEYS.ORG_OWNER);
                const isSelf = m.userId === myUserId;
                const locked = isOwner || isSelf;
                return (
                  <tr key={m.memberId} className="transition-colors hover:bg-surface-2/70">
                    <Td className="font-bold text-text">{m.fullName}{isSelf && <span className="ml-2 text-xs font-normal text-text-muted">(you)</span>}</Td>
                    <Td className="text-text-muted">{m.email}</Td>
                    <Td>
                      {canUpdate && !locked && assignable.length > 0 ? (
                        <Select aria-label={`Role of ${m.fullName}`} className="h-9 w-52 bg-surface text-xs" value={m.roleKeys[0] ?? ''} disabled={updateMember.isPending}
                          onChange={(e) => updateMember.mutate({ memberId: m.memberId, roleKeys: [e.target.value] })}>
                          {assignable.map((r) => <option key={r.key} value={r.key}>{roleLabel(r.key)}</option>)}
                        </Select>
                      ) : (
                        m.roleKeys.map((k) => <Badge key={k} tone={k === ROLE_KEYS.ORG_OWNER ? 'brand' : 'neutral'}>{roleLabel(k)}</Badge>)
                      )}
                    </Td>
                    <Td><Badge tone={m.status === 'ACTIVE' ? 'ok' : 'warn'}>{m.status === 'ACTIVE' ? 'Active' : 'Suspended'}</Badge></Td>
                    {(canUpdate || canRemove) && (
                      <Td className="text-right">
                        {!locked && (
                          <span className="inline-flex gap-1">
                            {canUpdate && (
                              <Button size="sm" variant="ghost" onClick={() => updateMember.mutate({ memberId: m.memberId, status: m.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE' })}>
                                {m.status === 'ACTIVE' ? 'Suspend' : 'Reactivate'}
                              </Button>
                            )}
                            {canRemove && <Button size="sm" variant="ghost" className="text-danger" onClick={() => setRemoving(m)}>Remove</Button>}
                          </span>
                        )}
                      </Td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      <Card className="overflow-hidden">
        <CardHeader title="Pending invitations" description="Invitations awaiting acceptance" />
        {invitations.isPending ? (
          <div className="p-6"><Skeleton className="h-10" /></div>
        ) : (invitations.data ?? []).length === 0 ? (
          <EmptyState title="No pending invitations" description={canInvite ? 'Invite a colleague and choose what they can do.' : 'Invitations sent by administrators appear here.'} />
        ) : (
          <Table>
            <thead><tr><Th>Email</Th><Th>Role</Th><Th>Expires</Th>{canInvite && <Th className="text-right">Actions</Th>}</tr></thead>
            <tbody>
              {invitations.data!.map((i) => (
                <tr key={i.id} className="transition-colors hover:bg-surface-2/70">
                  <Td className="font-medium text-text">{i.email}</Td>
                  <Td><Badge tone="neutral">{roleLabel(i.roleKey)}</Badge></Td>
                  <Td className="tabular text-text-muted">{formatDateTime(i.expiresAt, me?.memberships.find((m) => m.organization.id === orgId)?.organization.timezone)}</Td>
                  {canInvite && <Td className="text-right"><Button size="sm" variant="ghost" onClick={() => revokeInvitation.mutate(i.id)}>Revoke</Button></Td>}
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} roles={assignable} orgId={orgId} onDone={refresh} />

      <Dialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)} title="Remove member" description={removing ? `${removing.fullName} will lose access to this organization immediately.` : undefined}>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setRemoving(null)}>Cancel</Button>
          <Button variant="danger" loading={removeMember.isPending} onClick={() => removing && removeMember.mutate(removing.memberId)}>Remove member</Button>
        </div>
      </Dialog>
    </>
  );
}

function InviteDialog({ open, onOpenChange, roles, orgId, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; roles: RoleDto[]; orgId: string; onDone: () => Promise<unknown> }) {
  const [formError, setFormError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<InviteValues, unknown, z.output<typeof inviteMemberSchema>>({ resolver: zodResolver(inviteMemberSchema), defaultValues: { roleKey: ROLE_KEYS.VIEWER } });

  async function onSubmit(values: z.output<typeof inviteMemberSchema>) {
    setFormError(null);
    try {
      await api(`/organizations/${orgId}/invitations`, { method: 'POST', body: values });
      setSent(values.email);
      await onDone();
      reset({ email: '', roleKey: values.roleKey });
    } catch (err) {
      setFormError(applyApiError(err, setError));
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) { setSent(null); setFormError(null); } }} title="Invite user" description="They receive an email with a link to join. You cannot grant more than you can do yourself.">
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
        {formError && <Alert>{formError}</Alert>}
        {sent && <Alert tone="ok">Invitation sent to {sent}.</Alert>}
        <Field label="Email" htmlFor="invite-email" error={errors.email?.message}>
          <Input id="invite-email" type="email" autoFocus invalid={!!errors.email} {...register('email')} />
        </Field>
        <Field label="Role" htmlFor="invite-role" error={errors.roleKey?.message}>
          <Select id="invite-role" invalid={!!errors.roleKey} {...register('roleKey')}>
            {roles.map((r) => <option key={r.key} value={r.key}>{roleLabel(r.key)}</option>)}
          </Select>
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Close</Button>
          <Button type="submit" loading={isSubmitting}>Send invitation</Button>
        </div>
      </form>
    </Dialog>
  );
}
