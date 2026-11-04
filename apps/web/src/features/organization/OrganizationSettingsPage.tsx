import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import { P, updateOrganizationSchema, type OrganizationDto } from '@gps/shared';
import { Alert, Button, Card, CardHeader, Field, Input, PageHeader, Skeleton } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { hasPermission, useAuthStore } from '@/lib/auth-store';
import { applyApiError } from '@/lib/forms';
import { loadMe } from '@/lib/session';

type Values = z.input<typeof updateOrganizationSchema>;

const zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
const currencies = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('currency') : [];

export function OrganizationSettingsPage() {
  const me = useAuthStore((s) => s.me);
  const orgId = me?.activeOrganizationId;
  const canEdit = hasPermission(me, P.ORGANIZATION_UPDATE);
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const org = useQuery({ queryKey: ['org', orgId], queryFn: () => api<OrganizationDto>(`/organizations/${orgId}`), enabled: !!orgId });

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isDirty },
  } = useForm<Values, unknown, z.output<typeof updateOrganizationSchema>>({ resolver: zodResolver(updateOrganizationSchema) });

  useEffect(() => {
    if (org.data) {
      reset({ name: org.data.name, legalName: org.data.legalName ?? '', timezone: org.data.timezone, currencyCode: org.data.currencyCode, locale: org.data.locale });
    }
  }, [org.data, reset]);

  const save = useMutation({
    mutationFn: (values: z.output<typeof updateOrganizationSchema>) => api<OrganizationDto>(`/organizations/${orgId}`, { method: 'PATCH', body: { ...values, legalName: values.legalName || null } }),
    onSuccess: async () => {
      setSaved(true);
      await queryClient.invalidateQueries({ queryKey: ['org', orgId] });
      await loadMe(); // keeps the switcher and header names current
    },
    onError: (err) => setFormError(applyApiError(err, setError)),
  });

  return (
    <>
      <PageHeader title="Organization" description="Name, time zone and currency used across the platform for this organization." />
      <Card className="max-w-xl">
        <CardHeader title="Details" />
        {org.isPending ? (
          <div className="space-y-3 p-6"><Skeleton className="h-9" /><Skeleton className="h-9" /><Skeleton className="h-9" /></div>
        ) : org.isError ? (
          <div className="p-6"><Alert>Could not load the organization.</Alert></div>
        ) : (
          <form
            onSubmit={handleSubmit((v) => { setFormError(null); setSaved(false); save.mutate(v); })}
            noValidate
            className="space-y-4 px-6 pb-6 pt-2"
          >
            {formError && <Alert>{formError}</Alert>}
            {saved && !isDirty && <Alert tone="ok">Changes saved.</Alert>}
            {!canEdit && <Alert tone="neutral">You have read-only access to these settings.</Alert>}
            <Field label="Name" htmlFor="name" error={errors.name?.message}>
              <Input id="name" disabled={!canEdit} invalid={!!errors.name} {...register('name')} />
            </Field>
            <Field label="Legal name" htmlFor="legalName" error={errors.legalName?.message}>
              <Input id="legalName" disabled={!canEdit} {...register('legalName')} />
            </Field>
            <Field label="Time zone" htmlFor="timezone" hint="Times in reports and history are shown in this zone." error={errors.timezone?.message}>
              <Input id="timezone" list="zones" disabled={!canEdit} invalid={!!errors.timezone} {...register('timezone')} />
              <datalist id="zones">{zones.map((z) => <option key={z} value={z} />)}</datalist>
            </Field>
            <Field label="Currency" htmlFor="currencyCode" error={errors.currencyCode?.message}>
              <Input id="currencyCode" list="currencies" disabled={!canEdit} invalid={!!errors.currencyCode} {...register('currencyCode')} />
              <datalist id="currencies">{currencies.map((c) => <option key={c} value={c} />)}</datalist>
            </Field>
            {canEdit && (
              <Button type="submit" loading={save.isPending} disabled={!isDirty}>
                Save changes
              </Button>
            )}
          </form>
        )}
      </Card>
    </>
  );
}
