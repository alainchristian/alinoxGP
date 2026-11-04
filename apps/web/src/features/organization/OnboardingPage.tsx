import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/primitives';
import { signOut } from '@/lib/session';
import { AuthLayout } from '../auth/AuthLayout';

/**
 * Shown to a signed-in user who belongs to no organization. End customers cannot create their own account: their
 * provider creates it and sends an invitation (spec Module 1). A tracking business registers as a provider instead.
 */
export function OnboardingPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  return (
    <AuthLayout title="You are not part of an organization yet" subtitle="Accounts are created by your tracking provider.">
      <div className="space-y-4 text-[13px] leading-relaxed text-text-muted">
        <p>
          If you use a tracking service, ask your <strong className="text-text">provider</strong> to invite you. The invitation email contains a link that connects this account to your fleet.
        </p>
        <p>
          If you run a tracking business,{' '}
          <Link to="/register" className="text-brand underline">
            register it as a provider
          </Link>{' '}
          (use another email address; this one is already an account).
        </p>
        <Button
          variant="secondary"
          className="w-full"
          onClick={async () => {
            await signOut(queryClient);
            navigate('/login');
          }}
        >
          Sign out
        </Button>
      </div>
    </AuthLayout>
  );
}
