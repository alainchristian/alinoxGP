import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import type { OrganizationDto } from '@gps/shared';
import { Alert, Button, Field, Input } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { applyApiError } from '@/lib/forms';
import { switchOrganization } from '@/lib/session';
import { AuthLayout } from '../auth/AuthLayout';

const schema = z.object({ name: z.string().trim().min(2, 'Enter at least 2 characters').max(120) });

/** Shown to a signed-in user who does not belong to any organization yet. */
export function OnboardingPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<z.input<typeof schema>, unknown, z.output<typeof schema>>({ resolver: zodResolver(schema) });

  async function onSubmit(values: z.output<typeof schema>) {
    setFormError(null);
    try {
      const org = await api<OrganizationDto>('/organizations', { method: 'POST', body: values, noOrg: true });
      await switchOrganization(org.id, queryClient);
      navigate('/app', { replace: true });
    } catch (err) {
      setFormError(applyApiError(err, setError));
    }
  }

  return (
    <AuthLayout title="Create your organization" subtitle="An organization holds your vehicles, devices and team. You will be its owner.">
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
        {formError && <Alert>{formError}</Alert>}
        <Field label="Organization name" htmlFor="name" error={errors.name?.message}>
          <Input id="name" autoFocus autoComplete="organization" invalid={!!errors.name} {...register('name')} />
        </Field>
        <Button type="submit" className="w-full" loading={isSubmitting}>
          Create organization
        </Button>
      </form>
    </AuthLayout>
  );
}
