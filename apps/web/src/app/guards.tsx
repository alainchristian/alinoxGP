import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Skeleton } from '@/components/ui/primitives';
import { useAuthStore } from '@/lib/auth-store';
import { activeMembership, homePathFor } from '@/lib/session';

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

/** Customer area: needs an active customer/reseller organization. Platform staff are sent to /admin. */
export function RequireCustomerOrg() {
  const me = useAuthStore((s) => s.me);
  const membership = activeMembership(me);
  if (!membership) return <Navigate to="/onboarding" replace />;
  if (membership.organization.type === 'PLATFORM') return <Navigate to="/admin" replace />;
  return <Outlet />;
}

/** Platform admin area (navigation guard only — the API enforces platform permissions). */
export function RequirePlatformOrg() {
  const membership = activeMembership(useAuthStore((s) => s.me));
  if (membership?.organization.type !== 'PLATFORM') return <Navigate to="/app" replace />;
  return <Outlet />;
}
