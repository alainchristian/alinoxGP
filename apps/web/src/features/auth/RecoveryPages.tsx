import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useSearchParams } from 'react-router-dom';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { forgotPasswordSchema, passwordSchema } from '@gps/shared';
import { Alert, Button, Field, Input } from '@/components/ui/primitives';
import { ApiError, api } from '@/lib/api';
import { applyApiError } from '@/lib/forms';
import { errorMessage } from '@/lib/i18n';
import { AuthLayout } from './AuthLayout';

export function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<z.input<typeof forgotPasswordSchema>, unknown, z.output<typeof forgotPasswordSchema>>({ resolver: zodResolver(forgotPasswordSchema) });

  async function onSubmit(values: z.output<typeof forgotPasswordSchema>) {
    setFormError(null);
    try {
      await api('/auth/forgot-password', { method: 'POST', body: values, noOrg: true });
      setSent(true);
    } catch (err) {
      setFormError(applyApiError(err, setError));
    }
  }

  return (
    <AuthLayout title="Reset your password" subtitle="Enter your email and we will send a reset link if an account exists.">
      {sent ? (
        <Alert tone="ok">If an account exists for that address, a reset link is on its way.</Alert>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
          {formError && <Alert>{formError}</Alert>}
          <Field label="Email" htmlFor="email" error={errors.email?.message}>
            <Input id="email" type="email" autoComplete="email" autoFocus invalid={!!errors.email} {...register('email')} />
          </Field>
          <Button type="submit" className="w-full" loading={isSubmitting}>
            Send reset link
          </Button>
        </form>
      )}
      <Link to="/login" className="mt-4 inline-block text-[13px] text-brand underline">
        Back to sign in
      </Link>
    </AuthLayout>
  );
}

const resetFormSchema = z.object({ password: passwordSchema });

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [done, setDone] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<{ password: string }>({ resolver: zodResolver(resetFormSchema) });

  async function onSubmit(values: { password: string }) {
    setFormError(null);
    try {
      await api('/auth/reset-password', { method: 'POST', body: { token, password: values.password }, noOrg: true });
      setDone(true);
    } catch (err) {
      setFormError(applyApiError(err, setError));
    }
  }

  if (!token) {
    return (
      <AuthLayout title="Link not valid">
        <Alert>This reset link is incomplete. Request a new one.</Alert>
        <Link to="/forgot-password" className="mt-4 inline-block text-[13px] text-brand underline">
          Request a new link
        </Link>
      </AuthLayout>
    );
  }
  if (done) {
    return (
      <AuthLayout title="Password updated">
        <p className="text-[13px] text-text-muted">All other sessions were signed out. You can sign in with your new password.</p>
        <Link to="/login" className="mt-4 inline-block text-[13px] text-brand underline">
          Go to sign in
        </Link>
      </AuthLayout>
    );
  }
  return (
    <AuthLayout title="Choose a new password">
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
        {formError && <Alert>{formError}</Alert>}
        <Field label="New password" htmlFor="password" hint="At least 12 characters" error={errors.password?.message}>
          <Input id="password" type="password" autoComplete="new-password" autoFocus invalid={!!errors.password} {...register('password')} />
        </Field>
        <Button type="submit" className="w-full" loading={isSubmitting}>
          Update password
        </Button>
      </form>
    </AuthLayout>
  );
}

export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [state, setState] = useState<'working' | 'ok' | 'failed'>(token ? 'working' : 'failed');
  const [message, setMessage] = useState<string>('');
  const started = useRef(false);

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true; // tokens are single-use: never verify twice (React StrictMode re-runs effects)
    api('/auth/verify-email', { method: 'POST', body: { token }, noOrg: true })
      .then(() => setState('ok'))
      .catch((err) => {
        setMessage(errorMessage(err instanceof ApiError ? err.code : undefined));
        setState('failed');
      });
  }, [token]);

  return (
    <AuthLayout title="Email verification">
      {state === 'working' && <p className="text-[13px] text-text-muted">Verifying your email address…</p>}
      {state === 'ok' && <Alert tone="ok">Your email address is verified. You can now sign in.</Alert>}
      {state === 'failed' && <Alert>{message || 'This verification link is invalid or has expired. Sign in to request a new one.'}</Alert>}
      <Link to="/login" className="mt-4 inline-block text-[13px] text-brand underline">
        Go to sign in
      </Link>
    </AuthLayout>
  );
}
