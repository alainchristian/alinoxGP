import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { passwordSchema } from '@gps/shared';
import { Alert, Button, Field, Input, Skeleton } from '@/components/ui/primitives';
import { ApiError, api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { applyApiError } from '@/lib/forms';
import { errorMessage } from '@/lib/i18n';
import { loadMe, switchOrganization } from '@/lib/session';
import { useQueryClient } from '@tanstack/react-query';
import { AuthLayout } from './AuthLayout';

interface Lookup {
  organizationName: string;
  email: string;
  roleName: string;
  accountExists: boolean;
}

const newUserSchema = z.object({ fullName: z.string().trim().min(1, 'Enter your name').max(120), password: passwordSchema });

export function AcceptInvitationPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const me = useAuthStore((s) => s.me);
  const [done, setDone] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const lookup = useQuery({
    queryKey: ['invitation', token],
    queryFn: () => api<Lookup>('/invitations/lookup', { method: 'POST', body: { token }, noOrg: true }),
    enabled: !!token,
    retry: false,
  });

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<z.input<typeof newUserSchema>, unknown, z.output<typeof newUserSchema>>({ resolver: zodResolver(newUserSchema) });

  async function createAccount(values: z.output<typeof newUserSchema>) {
    setFormError(null);
    try {
      await api('/invitations/accept', { method: 'POST', body: { token, ...values }, noOrg: true });
      setDone(true);
    } catch (err) {
      setFormError(applyApiError(err, setError));
    }
  }

  async function acceptAsExisting() {
    setFormError(null);
    try {
      const res = await api<{ organizationId: string }>('/invitations/accept-existing', { method: 'POST', body: { token }, noOrg: true });
      await loadMe();
      await switchOrganization(res.organizationId, queryClient);
      navigate('/app', { replace: true });
    } catch (err) {
      setFormError(applyApiError(err));
    }
  }

  if (!token || lookup.isError) {
    return (
      <AuthLayout title="Invitation not valid">
        <Alert>{lookup.error instanceof ApiError ? errorMessage(lookup.error.code) : 'This invitation link is incomplete.'}</Alert>
        <Link to="/login" className="mt-4 inline-block text-[13px] text-brand underline">
          Go to sign in
        </Link>
      </AuthLayout>
    );
  }
  if (lookup.isPending) {
    return (
      <AuthLayout title="Invitation">
        <Skeleton className="h-20 w-full" />
      </AuthLayout>
    );
  }
  const inv = lookup.data;
  if (done) {
    return (
      <AuthLayout title="Welcome aboard">
        <Alert tone="ok">Your account is ready. Sign in to join {inv.organizationName}.</Alert>
        <Link to="/login" className="mt-4 inline-block text-[13px] text-brand underline">
          Go to sign in
        </Link>
      </AuthLayout>
    );
  }

  const signedInAsInvitee = me?.user.email === inv.email;
  return (
    <AuthLayout title={`Join ${inv.organizationName}`} subtitle={`You were invited as ${inv.roleName} (${inv.email}).`}>
      {formError && <div className="mb-4"><Alert>{formError}</Alert></div>}
      {inv.accountExists ? (
        signedInAsInvitee ? (
          <Button className="w-full" onClick={acceptAsExisting}>
            Accept invitation
          </Button>
        ) : (
          <div className="space-y-3 text-[13px]">
            <p className="text-text-muted">An account already exists for this email. Sign in with it to accept the invitation.</p>
            <Link className="inline-flex h-9 w-full items-center justify-center rounded-md bg-brand text-sm font-medium text-brand-text" to={`/login?next=${encodeURIComponent(`/accept-invitation?token=${token}`)}`}>
              Sign in to accept
            </Link>
          </div>
        )
      ) : (
        <form onSubmit={handleSubmit(createAccount)} noValidate className="space-y-4">
          <Field label="Full name" htmlFor="fullName" error={errors.fullName?.message}>
            <Input id="fullName" autoComplete="name" autoFocus invalid={!!errors.fullName} {...register('fullName')} />
          </Field>
          <Field label="Choose a password" htmlFor="password" hint="At least 12 characters" error={errors.password?.message}>
            <Input id="password" type="password" autoComplete="new-password" invalid={!!errors.password} {...register('password')} />
          </Field>
          <Button type="submit" className="w-full" loading={isSubmitting}>
            Create account and join
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
