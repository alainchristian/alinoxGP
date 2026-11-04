import { describe, expect, it } from 'vitest';
import { PROVIDER_STATUSES } from '@gps/shared';
import { adminActions, draftsToLimits, isValidSlug, limitsToDrafts, providerBanner, providerStatusTone } from './provider-model';

describe('provider status wording', () => {
  it('has a tone for every status and a banner for every state that needs one', () => {
    for (const s of PROVIDER_STATUSES) expect(providerStatusTone(s)).toBeTruthy();
    expect(providerBanner('ACTIVE')).toBeNull();
    expect(providerBanner('PENDING_APPROVAL')?.text).toMatch(/simulated devices only/);
    expect(providerBanner('SUSPENDED', 'Unpaid')?.text).toMatch(/nothing is lost/);
    expect(providerBanner('REJECTED', 'No licence')?.text).toMatch(/No licence/);
  });

  it('offers platform administrators only the decisions the lifecycle allows', () => {
    expect(adminActions('PENDING_APPROVAL')).toEqual(['approve', 'reject']);
    expect(adminActions('ACTIVE')).toEqual(['suspend']);
    expect(adminActions('SUSPENDED')).toEqual(['reactivate']);
    expect(adminActions('PENDING_VERIFICATION')).toEqual([]);
    expect(adminActions('REJECTED')).toEqual([]);
    expect(adminActions('CLOSED')).toEqual([]);
  });
});

describe('customer limits', () => {
  it('an unset limit stays unset: empty means inherit, never zero', () => {
    const drafts = limitsToDrafts([]);
    expect(drafts.history_days).toEqual({ limitValue: '', enabled: 'inherit' });
    const body = draftsToLimits(drafts);
    expect(body.every((l) => l.limitValue === null && l.enabled === null)).toBe(true);
  });

  it('round-trips explicit values, including an explicit zero and an explicit "off"', () => {
    const drafts = limitsToDrafts([
      { key: 'history_days', enabled: null, limitValue: 30 },
      { key: 'max_users', enabled: null, limitValue: 0 },
      { key: 'security_features', enabled: false, limitValue: null },
      { key: 'driver_management', enabled: true, limitValue: null },
    ]);
    const body = Object.fromEntries(draftsToLimits(drafts).map((l) => [l.key, l]));
    expect(body.history_days).toMatchObject({ limitValue: 30, enabled: null });
    expect(body.max_users).toMatchObject({ limitValue: 0 });
    expect(body.security_features).toMatchObject({ enabled: false, limitValue: null });
    expect(body.driver_management).toMatchObject({ enabled: true });
  });

  it('ignores junk numbers instead of sending them', () => {
    const drafts = limitsToDrafts([]);
    drafts.history_days.limitValue = '12.5';
    drafts.max_vehicles.limitValue = '-3';
    const body = Object.fromEntries(draftsToLimits(drafts).map((l) => [l.key, l]));
    expect(body.history_days!.limitValue).toBeNull();
    expect(body.max_vehicles!.limitValue).toBeNull();
  });
});

describe('branding address', () => {
  it('accepts 3–32 lowercase letters, digits and inner hyphens', () => {
    expect(isValidSlug('acme')).toBe(true);
    expect(isValidSlug('kigali-gps-2')).toBe(true);
    expect(isValidSlug('ab')).toBe(false);
    expect(isValidSlug('-acme')).toBe(false);
    expect(isValidSlug('Acme')).toBe(false);
    expect(isValidSlug('a b c')).toBe(false);
  });
});
