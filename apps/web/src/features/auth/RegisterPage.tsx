import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { PROVIDER_TERMS_VERSION, providerRegistrationSchema } from '@gps/shared';
import { Alert, Button, Field, Input } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { applyApiError } from '@/lib/forms';
import { AuthLayout } from './AuthLayout';

// The terms are accepted with a checkbox; the API receives the version that was shown.
const formSchema = providerRegistrationSchema.omit({ acceptedTermsVersion: true }).extend({
  acceptedTerms: z.literal(true, { error: 'Accept the terms to continue' }),
});
type Values = z.input<typeof formSchema>;

/** A GPS tracking business applies to use the platform. End customers never register here: their provider invites them. */
export function RegisterPage() {
  const [formError, setFormError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<Values, unknown, z.output<typeof formSchema>>({ resolver: zodResolver(formSchema) });

  async function onSubmit({ acceptedTerms: _accepted, ...values }: z.output<typeof formSchema>) {
    setFormError(null);
    try {
      await api('/providers/register', {
        method: 'POST',
        body: { ...values, acceptedTermsVersion: PROVIDER_TERMS_VERSION, phone: values.phone || undefined, registrationNumber: values.registrationNumber || undefined, tin: values.tin || undefined },
        noOrg: true,
      });
      setSentTo(values.email);
    } catch (err) {
      setFormError(applyApiError(err, setError));
    }
  }

  if (sentTo) {
    return (
      <AuthLayout title="Check your email">
        <div className="space-y-3 text-[13px] text-text-muted">
          <p>
            If <strong className="text-text">{sentTo}</strong> can be registered, we sent a verification link to it. Open the link, then sign in.
          </p>
          <p>
            After your email is verified, a platform administrator reviews your company. Until it is approved you can set up and try the console with simulated devices only; real devices need an approved provider.
          </p>
        </div>
        <Link to="/login" className="mt-4 inline-block text-[13px] text-brand underline">
          Back to sign in
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Register your tracking company"
      subtitle="For GPS tracking providers. Your customers get their accounts from you, by invitation."
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
        <Field label="Company name" htmlFor="companyName" error={errors.companyName?.message}>
          <Input id="companyName" autoComplete="organization" autoFocus invalid={!!errors.companyName} {...register('companyName')} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Registration number (optional)" htmlFor="registrationNumber" error={errors.registrationNumber?.message}>
            <Input id="registrationNumber" invalid={!!errors.registrationNumber} {...register('registrationNumber')} />
          </Field>
          <Field label="TIN (optional)" htmlFor="tin" error={errors.tin?.message}>
            <Input id="tin" invalid={!!errors.tin} {...register('tin')} />
          </Field>
        </div>
        <Field label="Your name" htmlFor="contactName" error={errors.contactName?.message}>
          <Input id="contactName" autoComplete="name" invalid={!!errors.contactName} {...register('contactName')} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Email" htmlFor="email" error={errors.email?.message}>
            <Input id="email" type="email" autoComplete="email" invalid={!!errors.email} {...register('email')} />
          </Field>
          <Field label="Phone (optional)" htmlFor="phone" error={errors.phone?.message}>
            <Input id="phone" type="tel" autoComplete="tel" invalid={!!errors.phone} {...register('phone')} />
          </Field>
        </div>
        <Field label="Password" htmlFor="password" hint="At least 12 characters" error={errors.password?.message}>
          <Input id="password" type="password" autoComplete="new-password" invalid={!!errors.password} {...register('password')} />
        </Field>
        <Field label="Devices you expect to connect (optional)" htmlFor="expectedDevices" error={errors.expectedDevices?.message}>
          <Input id="expectedDevices" type="number" min={0} inputMode="numeric" invalid={!!errors.expectedDevices} {...register('expectedDevices')} />
        </Field>
        <div>
          <label className="flex items-start gap-2.5 text-[13px] text-text">
            <input type="checkbox" className="mt-0.5 size-4 rounded border-border" {...register('acceptedTerms')} />
            <span>
              I accept the provider terms and the data-processing agreement ({PROVIDER_TERMS_VERSION}). <span className="text-text-muted">Draft wording: it is replaced after legal review and you will be asked to accept the final version.</span>
            </span>
          </label>
          {errors.acceptedTerms && <p className="mt-1 text-xs text-danger">{errors.acceptedTerms.message}</p>}
        </div>
        <Button type="submit" className="w-full" loading={isSubmitting}>
          Register company
        </Button>
      </form>
    </AuthLayout>
  );
}
