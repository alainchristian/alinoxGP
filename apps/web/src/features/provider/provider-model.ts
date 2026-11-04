import { CUSTOMER_LIMIT_KEYS, type CustomerLimitDto, type CustomerLimitKey, type ProviderStatus } from '@gps/shared';

/** Pure helpers for the provider console and the platform's provider administration (unit-tested; no React here). */

export type Tone = 'neutral' | 'brand' | 'ok' | 'warn' | 'danger';

export const PROVIDER_STATUS_LABEL: Record<ProviderStatus, string> = {
  PENDING_VERIFICATION: 'Waiting for email verification',
  PENDING_APPROVAL: 'Waiting for approval',
  TRIAL: 'Trial',
  ACTIVE: 'Active',
  GRACE: 'Payment overdue',
  SUSPENDED: 'Suspended',
  CLOSED: 'Closed',
  REJECTED: 'Rejected',
};

export const providerStatusTone = (s: ProviderStatus): Tone =>
  s === 'ACTIVE' || s === 'TRIAL' ? 'ok' : s === 'PENDING_APPROVAL' || s === 'PENDING_VERIFICATION' || s === 'GRACE' ? 'warn' : s === 'SUSPENDED' || s === 'REJECTED' ? 'danger' : 'neutral';

/** What a provider is told on its own console about its state. Honest about what is and is not possible yet. */
export function providerBanner(status: ProviderStatus, reason?: string | null): { tone: 'ok' | 'warn' | 'danger' | 'neutral'; text: string } | null {
  switch (status) {
    case 'PENDING_VERIFICATION':
      return { tone: 'warn', text: 'Verify your email address. We sent you a link when you registered.' };
    case 'PENDING_APPROVAL':
      return { tone: 'warn', text: 'A platform administrator is reviewing your company. Until it is approved you can create customers and try the console with simulated devices only; real devices need an approved provider.' };
    case 'TRIAL':
      return { tone: 'ok', text: 'Your company is approved and on a trial.' };
    case 'GRACE':
      return { tone: 'warn', text: 'Your payment is overdue. Everything keeps working during the grace period.' };
    case 'SUSPENDED':
      return { tone: 'danger', text: `Your account is suspended${reason ? `: ${reason}` : ''}. Your customers’ vehicles are still being tracked and nothing is lost.` };
    case 'REJECTED':
      return { tone: 'danger', text: `Your registration was not approved${reason ? `: ${reason}` : ''}.` };
    case 'CLOSED':
      return { tone: 'neutral', text: 'This account is closed.' };
    default:
      return null;
  }
}

/** Platform administrators' available decisions for a provider in a given status (mirrors the API lifecycle table). */
export function adminActions(status: ProviderStatus): ('approve' | 'reject' | 'suspend' | 'reactivate')[] {
  switch (status) {
    case 'PENDING_APPROVAL':
      return ['approve', 'reject'];
    case 'TRIAL':
    case 'ACTIVE':
    case 'GRACE':
      return ['suspend'];
    case 'SUSPENDED':
      return ['reactivate'];
    default:
      return [];
  }
}

export const LIMIT_LABEL: Record<CustomerLimitKey, { label: string; kind: 'number' | 'flag'; unit?: string }> = {
  history_days: { label: 'History kept', kind: 'number', unit: 'days' },
  max_vehicles: { label: 'Vehicles', kind: 'number' },
  max_users: { label: 'Users', kind: 'number' },
  max_geofences: { label: 'Geofences', kind: 'number' },
  driver_management: { label: 'Driver management', kind: 'flag' },
  security_features: { label: 'Vehicle security', kind: 'flag' },
};

export interface LimitDraft {
  /** '' = no limit set here (inherit the provider’s plan). */
  limitValue: string;
  /** 'inherit' | 'on' | 'off' */
  enabled: 'inherit' | 'on' | 'off';
}

export function limitsToDrafts(limits: CustomerLimitDto[]): Record<CustomerLimitKey, LimitDraft> {
  return Object.fromEntries(
    CUSTOMER_LIMIT_KEYS.map((key) => {
      const l = limits.find((x) => x.key === key);
      return [key, { limitValue: l?.limitValue == null ? '' : String(l.limitValue), enabled: l?.enabled == null ? 'inherit' : l.enabled ? 'on' : 'off' }];
    }),
  ) as Record<CustomerLimitKey, LimitDraft>;
}

/** Drafts → request body. Empty = null (inherit), never 0: an unset limit is not a zero limit. */
export function draftsToLimits(drafts: Record<CustomerLimitKey, LimitDraft>): { key: CustomerLimitKey; enabled: boolean | null; limitValue: number | null }[] {
  return CUSTOMER_LIMIT_KEYS.map((key) => {
    const d = drafts[key];
    const kind = LIMIT_LABEL[key].kind;
    const n = d.limitValue.trim() === '' ? null : Number(d.limitValue);
    return {
      key,
      enabled: kind === 'flag' ? (d.enabled === 'inherit' ? null : d.enabled === 'on') : null,
      limitValue: kind === 'number' && n !== null && Number.isInteger(n) && n >= 0 ? n : null,
    };
  });
}

/** Whether a slug looks valid before asking the server (the server stays the authority). */
export const isValidSlug = (s: string) => /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/.test(s);
