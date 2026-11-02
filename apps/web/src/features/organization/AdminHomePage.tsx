import { Card, CardHeader, EmptyState, PageHeader } from '@/components/ui/primitives';
import { useAuthStore } from '@/lib/auth-store';
import { roleLabel } from '@/lib/i18n';
import { activeMembership } from '@/lib/session';

/** Platform administration landing page. Customer, device-catalogue, billing and audit modules arrive in later milestones. */
export function AdminHomePage() {
  const membership = activeMembership(useAuthStore((s) => s.me));
  return (
    <>
      <PageHeader title="Platform administration" description="Operations for platform staff. This area has its own navigation and permissions, separate from customer organizations." />
      <Card className="max-w-2xl">
        <CardHeader title="Your access" />
        <div className="px-5 py-4 text-[13px]">
          <p>Role: <strong>{membership?.roleKeys.map(roleLabel).join(', ') ?? '—'}</strong></p>
        </div>
        <EmptyState title="Device tools are available" description="Use the device catalogue, device diagnostics, support requests and tracking notices in the menu. Customers, inventory, plans and the audit log will appear here as they are released." />
      </Card>
    </>
  );
}
