import type { ProviderStatus } from '@gps/shared';

/**
 * Provider lifecycle (skill gps-provider-model §2). One table, one function: every status change goes through
 * `canTransition`, so "an unapproved provider is operating" cannot happen by an unlisted path.
 *
 *   PENDING_VERIFICATION → PENDING_APPROVAL (email verified) → TRIAL | ACTIVE (approved) | REJECTED
 *   TRIAL | ACTIVE | GRACE → SUSPENDED (platform) → ACTIVE (reactivated)
 *   TRIAL → ACTIVE, ACTIVE ↔ GRACE (payment, M10), any non-closed → CLOSED
 */
export const PROVIDER_TRANSITIONS: Readonly<Record<ProviderStatus, readonly ProviderStatus[]>> = {
  PENDING_VERIFICATION: ['PENDING_APPROVAL', 'CLOSED'],
  PENDING_APPROVAL: ['TRIAL', 'ACTIVE', 'REJECTED', 'CLOSED'],
  TRIAL: ['ACTIVE', 'GRACE', 'SUSPENDED', 'CLOSED'],
  ACTIVE: ['GRACE', 'SUSPENDED', 'CLOSED'],
  GRACE: ['ACTIVE', 'SUSPENDED', 'CLOSED'],
  SUSPENDED: ['ACTIVE', 'CLOSED'],
  CLOSED: [],
  REJECTED: [],
};

export const canTransition = (from: ProviderStatus, to: ProviderStatus) => PROVIDER_TRANSITIONS[from].includes(to);

/** Statuses in which the provider's customers keep working. A suspended or closed provider shows them a neutral message. */
export const CUSTOMERS_SERVED: readonly ProviderStatus[] = ['TRIAL', 'ACTIVE', 'GRACE'];
