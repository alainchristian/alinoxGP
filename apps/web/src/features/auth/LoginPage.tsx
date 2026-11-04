import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { loginSchema } from '@gps/shared';
import { Alert, Button, Field, Input } from '@/components/ui/primitives';
import { ApiError, api } from '@/lib/api';
import { applyApiError } from '@/lib/forms';
import { errorMessage } from '@/lib/i18n';
import { homePathFor, signIn } from '@/lib/session';
import { AuthLayout } from './AuthLayout';

type LoginValues = z.input<typeof loginSchema>;

export function LoginPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [formError, setFormError] = useState<string | null>(null);
  const [needsTotp, setNeedsTotp] = useState(false);
  const [unverified, setUnverified] = useState(false);
  const [resent, setResent] = useState(false);
  const {
    register,
    handleSubmit,
    getValues,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues, unknown, z.output<typeof loginSchema>>({ resolver: zodResolver(loginSchema) });

  async function onSubmit(values: z.output<typeof loginSchema>) {
    setFormError(null);
    setUnverified(false);
    try {
      const me = await signIn({ ...values, totpCode: values.totpCode || undefined });
      const next = params.get('next');
      navigate(next && next.startsWith('/') ? next : homePathFor(me), { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'TOTP_REQUIRED') {
        setNeedsTotp(true);
        setFormError(errorMessage(err.code));
        return;
      }
      if (err instanceof ApiError && err.code === 'EMAIL_NOT_VERIFIED') setUnverified(true);
      setFormError(applyApiError(err, setError));
    }
  }

  async function resend() {
    await api('/auth/resend-verification', { method: 'POST', body: { email: getValues('email') }, noOrg: true }).catch(() => undefined);
    setResent(true);
  }

  return (
    <AuthLayout
      title="Sign in"
      footer={
        <>
          Run a tracking business?{' '}
          <Link to="/register" className="text-brand underline">
            Register as a provider
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
        {formError && <Alert tone={needsTotp && !errors.totpCode ? 'neutral' : 'danger'}>{formError}</Alert>}
        {unverified && (
          <p className="text-[13px]">
            {resent ? (
              'A new verification email has been sent if the address is awaiting verification.'
            ) : (
              <button type="button" onClick={resend} className="text-brand underline">
                Resend verification email
              </button>
            )}
          </p>
        )}
        <Field label="Email" htmlFor="email" error={errors.email?.message}>
          <Input id="email" type="email" autoComplete="username" autoFocus invalid={!!errors.email} {...register('email')} />
        </Field>
        <Field label="Password" htmlFor="password" error={errors.password?.message}>
          <Input id="password" type="password" autoComplete="current-password" invalid={!!errors.password} {...register('password')} />
        </Field>
        {needsTotp && (
          <Field label="Authenticator code" htmlFor="totpCode" hint="6-digit code, or a recovery code" error={errors.totpCode?.message}>
            <Input id="totpCode" inputMode="numeric" autoComplete="one-time-code" autoFocus invalid={!!errors.totpCode} {...register('totpCode')} />
          </Field>
        )}
        <Button type="submit" className="w-full" loading={isSubmitting}>
          Sign in
        </Button>
        <p className="text-center text-[13px]">
          <Link to="/forgot-password" className="text-brand underline">
            Forgot your password?
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
}
