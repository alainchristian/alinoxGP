import type { AuthSessionDto, MeDto } from '@gps/shared';
import type { QueryClient } from '@tanstack/react-query';
import { api, refreshSession } from './api';
import { useAuthStore } from './auth-store';

/** Loads /auth/me and makes sure there is a valid active organization. */
export async function loadMe(): Promise<MeDto> {
  const store = useAuthStore.getState();
  let me = await api<MeDto>('/auth/me');
  if (!me.activeOrganizationId) {
    // Stored organization is stale or the user is new: fall back to the first membership.
    const first = me.memberships.find((m) => m.relation === 'MEMBER');
    store.setActiveOrganization(first?.organization.id ?? null);
    if (first) me = await api<MeDto>('/auth/me');
  } else if (store.activeOrganizationId !== me.activeOrganizationId) {
    store.setActiveOrganization(me.activeOrganizationId);
  }
  useAuthStore.getState().setMe(me);
  return me;
}

/** On page load: try the HttpOnly refresh cookie to restore the session. */
export async function bootstrapSession(): Promise<void> {
  if (await refreshSession()) {
    try {
      await loadMe();
      return;
    } catch {
      /* fall through to anonymous */
    }
  }
  useAuthStore.getState().clear();
}

export async function signIn(input: { email: string; password: string; totpCode?: string }): Promise<MeDto> {
  const session = await api<AuthSessionDto>('/auth/login', { method: 'POST', body: input, noOrg: true });
  useAuthStore.getState().setAccessToken(session.accessToken);
  return loadMe();
}

export async function signOut(queryClient: QueryClient): Promise<void> {
  try {
    await api('/auth/logout', { method: 'POST', noOrg: true });
  } finally {
    useAuthStore.getState().clear();
    queryClient.clear();
  }
}

export async function switchOrganization(id: string, queryClient: QueryClient): Promise<void> {
  useAuthStore.getState().setActiveOrganization(id);
  queryClient.clear();
  await loadMe();
}

export const activeMembership = (me: MeDto | null) =>
  me?.memberships.find((m) => m.relation === 'MEMBER' && m.organization.id === me.activeOrganizationId) ?? null;

/** The active organization, whether the user is a member of it or (provider staff) acts for it. */
export const activeOrganization = (me: MeDto | null) =>
  me?.memberships.find((m) => m.organization.id === me.activeOrganizationId)?.organization ?? null;

/** Where each kind of organization lives: platform admin, provider console, or the end-customer app. */
export const homePathFor = (me: MeDto | null) => {
  switch (activeOrganization(me)?.type) {
    case 'PLATFORM':
      return '/admin';
    case 'PROVIDER':
      return '/provider';
    case 'CUSTOMER':
      return '/app';
    default:
      return '/onboarding';
  }
};
