import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { registerSchema } from '@gps/shared';
import { Alert, Button, Field, Input } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { applyApiError } from '@/lib/forms';
import { AuthLayout } from './AuthLayout';

type Values = z.input<typeof registerSchema>;

export function RegisterPage() {
  const [formError, setFormError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<Values, unknown, z.output<typeof registerSchema>>({ resolver: zodResolver(registerSchema) });

  async function onSubmit(values: z.output<typeof registerSchema>) {
    setFormError(null);
    try {
      await api('/auth/register', { method: 'POST', body: { ...values, organizationName: values.organizationName || undefined }, noOrg: true });
      setSentTo(values.email);
    } catch (err) {
      setFormError(applyApiError(err, setError));
    }
  }

  if (sentTo) {
    return (
      <AuthLayout title="Check your email">
        <p className="text-[13px] text-text-muted">
          If <strong className="text-text">{sentTo}</strong> can be registered, we sent a verification link to it. Open the link to activate your account, then sign in.
        </p>
        <Link to="/login" className="mt-4 inline-block text-[13px] text-brand underline">
          Back to sign in
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Create your account"
      footer={
        <>
          Already registered?{' '}
          <Link to="/login" className="text-brand underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
        {formError && <Alert>{formError}</Alert>}
        <Field label="Full name" htmlFor="fullName" error={errors.fullName?.message}>
          <Input id="fullName" autoComplete="name" autoFocus invalid={!!errors.fullName} {...register('fullName')} />
        </Field>
        <Field label="Email" htmlFor="email" error={errors.email?.message}>
          <Input id="email" type="email" autoComplete="email" invalid={!!errors.email} {...register('email')} />
        </Field>
        <Field label="Password" htmlFor="password" hint="At least 12 characters" error={errors.password?.message}>
          <Input id="password" type="password" autoComplete="new-password" invalid={!!errors.password} {...register('password')} />
        </Field>
        <Field label="Organization name (optional)" htmlFor="organizationName" hint="Your company or fleet. You can also create it after signing in." error={errors.organizationName?.message}>
          <Input id="organizationName" autoComplete="organization" invalid={!!errors.organizationName} {...register('organizationName')} />
        </Field>
        <Button type="submit" className="w-full" loading={isSubmitting}>
          Create account
        </Button>
      </form>
    </AuthLayout>
  );
}
