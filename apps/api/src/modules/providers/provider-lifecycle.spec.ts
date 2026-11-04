import { PROVIDER_STATUSES, isOperatingProvider } from '@gps/shared';
import { PROVIDER_TRANSITIONS, canTransition } from './provider-lifecycle';

describe('provider lifecycle', () => {
  it('lists every status exactly once and only known targets', () => {
    expect(Object.keys(PROVIDER_TRANSITIONS).sort()).toEqual([...PROVIDER_STATUSES].sort());
    for (const to of Object.values(PROVIDER_TRANSITIONS).flat()) expect(PROVIDER_STATUSES).toContain(to);
  });

  it('an unapproved provider cannot become operating by any path except approval', () => {
    for (const from of PROVIDER_STATUSES.filter((s) => !isOperatingProvider(s) && s !== 'PENDING_APPROVAL' && s !== 'SUSPENDED')) {
      for (const to of PROVIDER_TRANSITIONS[from]) expect(isOperatingProvider(to)).toBe(false);
    }
    expect(canTransition('PENDING_VERIFICATION', 'ACTIVE')).toBe(false);
    expect(canTransition('PENDING_VERIFICATION', 'TRIAL')).toBe(false);
    expect(canTransition('PENDING_APPROVAL', 'TRIAL')).toBe(true);
  });

  it('rejected and closed are final; suspension can only be lifted to ACTIVE', () => {
    expect(PROVIDER_TRANSITIONS.REJECTED).toEqual([]);
    expect(PROVIDER_TRANSITIONS.CLOSED).toEqual([]);
    expect(PROVIDER_TRANSITIONS.SUSPENDED).toEqual(['ACTIVE', 'CLOSED']);
  });
});
