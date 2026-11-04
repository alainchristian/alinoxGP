import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Skeleton } from '@/components/ui/primitives';
import { useAuthStore } from '@/lib/auth-store';
import { activeOrganization, homePathFor } from '@/lib/session';

export function Booting() {
  return (
    <div className="grid h-full place-items-center" aria-busy="true" aria-live="polite">
      <div className="w-64 space-y-3">
        <Skeleton className="h-6" />
        <Skeleton className="h-4 w-40" />
      </div>
    </div>
  );
}

/** Routes for signed-out visitors; signed-in users are sent to their home. */
export function PublicOnly() {
  const { status, me } = useAuthStore();
  if (status === 'booting') return <Booting />;
  if (status === 'authenticated') return <Navigate to={homePathFor(me)} replace />;
  return <Outlet />;
}

export function RequireAuth() {
  const status = useAuthStore((s) => s.status);
  const location = useLocation();
  if (status === 'booting') return <Booting />;
  if (status === 'anonymous') {
    return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  }
  return <Outlet />;
}

/** Each area is for one kind of organization; anyone else is sent to their own home (navigation guards only — the API enforces everything). */
function RequireOrgType({ type }: { type: 'CUSTOMER' | 'PROVIDER' | 'PLATFORM' }) {
  const me = useAuthStore((s) => s.me);
  const org = activeOrganization(me);
  if (!org) return <Navigate to="/onboarding" replace />;
  if (org.type !== type) return <Navigate to={homePathFor(me)} replace />;
  return <Outlet />;
}

/** End-customer app (including provider staff acting for a customer). */
export const RequireCustomerOrg = () => <RequireOrgType type="CUSTOMER" />;
/** Provider console. */
export const RequireProviderOrg = () => <RequireOrgType type="PROVIDER" />;
/** Platform admin area. */
export const RequirePlatformOrg = () => <RequireOrgType type="PLATFORM" />;
