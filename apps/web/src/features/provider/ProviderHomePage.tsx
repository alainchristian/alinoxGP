import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { P, type CustomerDto, type ProviderProfileDto } from '@gps/shared';
import { Alert, Badge, Card, CardHeader, PageHeader, Skeleton } from '@/components/ui/primitives';
import { QueryError } from '@/features/fleet/fleet-ui';
import { api, apiPaged } from '@/lib/api';
import { hasPermission, useAuthStore } from '@/lib/auth-store';
import { formatDateTime } from '@/lib/utils';
import { PROVIDER_STATUS_LABEL, providerBanner, providerStatusTone } from './provider-model';

/** The provider console's home: the state of the company on the platform, and what to do next. Real numbers only. */
export function ProviderHomePage() {
  const me = useAuthStore((s) => s.me);
  const orgId = me?.activeOrganizationId ?? '';
  const profile = useQuery({ queryKey: ['provider', orgId, 'profile'], queryFn: () => api<ProviderProfileDto>(`/organizations/${orgId}/provider/profile`) });
  const canCustomers = hasPermission(me, P.PROVIDER_CUSTOMERS_READ);
  const customers = useQuery({
    queryKey: ['provider', orgId, 'customers', 'count'],
    enabled: canCustomers,
    queryFn: () => apiPaged<CustomerDto>(`/organizations/${orgId}/provider/customers?page=1&pageSize=1`),
  });

  if (profile.isPending) return <Skeleton className="h-40" />;
  if (profile.isError) return <Card><QueryError query={profile} what="your company" /></Card>;
  const p = profile.data;
  const banner = providerBanner(p.status, p.suspensionReason ?? p.rejectionReason);

  return (
    <>
      <PageHeader title={p.branding.neutral ? p.companyName : p.branding.displayName} description="Your customers, their vehicles and your brand, in one place." />
      {banner && <div className="mb-5"><Alert tone={banner.tone}>{banner.text}</Alert></div>}
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Your company" description="As registered with the platform" />
          <dl className="grid gap-x-8 gap-y-4 px-6 pb-6 text-[13px] sm:grid-cols-2">
            <div><dt className="text-text-muted">Status</dt><dd className="mt-1"><Badge tone={providerStatusTone(p.status)}>{PROVIDER_STATUS_LABEL[p.status]}</Badge></dd></div>
            <div><dt className="text-text-muted">Contact</dt><dd className="mt-1 font-medium">{p.contactName}<span className="block font-normal text-text-muted">{p.contactEmail}{p.contactPhone ? ` · ${p.contactPhone}` : ''}</span></dd></div>
            <div><dt className="text-text-muted">Registration number</dt><dd className="mt-1 font-medium">{p.registrationNumber ?? '—'}</dd></div>
            <div><dt className="text-text-muted">Tax number (TIN)</dt><dd className="mt-1 font-medium">{p.tin ?? '—'}</dd></div>
            <div><dt className="text-text-muted">Licence reference</dt><dd className="mt-1 font-medium">{p.licenceNumber ?? 'Not recorded'}</dd></div>
            <div><dt className="text-text-muted">Terms accepted</dt><dd className="mt-1 font-medium">{p.termsVersion ?? '—'}{p.termsAcceptedAt ? <span className="block font-normal text-text-muted">{formatDateTime(p.termsAcceptedAt)}</span> : null}</dd></div>
          </dl>
        </Card>
        <Card>
          <CardHeader title="Customers" description="End customers you serve" />
          <div className="px-6 pb-6">
            {!canCustomers ? (
              <p className="text-[13px] text-text-muted">Your role does not include customers.</p>
            ) : customers.isPending ? (
              <Skeleton className="h-10" />
            ) : customers.isError ? (
              <p className="text-[13px] text-text-muted">Could not load the customer count.</p>
            ) : (
              <>
                <p className="tabular text-3xl font-semibold text-text">{customers.data.meta.total}</p>
                <Link to="/provider/customers" className="mt-2 inline-block text-[13px] text-brand underline">
                  {customers.data.meta.total === 0 ? 'Create your first customer' : 'Manage customers'}
                </Link>
              </>
            )}
          </div>
        </Card>
      </div>
    </>
  );
}
