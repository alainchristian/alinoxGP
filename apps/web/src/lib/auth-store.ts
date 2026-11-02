import type { MeDto } from '@gps/shared';
import { create } from 'zustand';

const ORG_KEY = 'gps.activeOrganizationId';

/** Remembering the last organization is a per-browser convenience only; the API re-verifies membership. */
function readStoredOrg(): string | null {
  try {
    return localStorage.getItem(ORG_KEY);
  } catch {
    return null;
  }
}
function writeStoredOrg(id: string | null) {
  try {
    if (id) localStorage.setItem(ORG_KEY, id);
    else localStorage.removeItem(ORG_KEY);
  } catch {
    /* storage unavailable (private mode) — keep working in memory */
  }
}

interface AuthState {
  /** Held in memory only (ADR-0002). */
  accessToken: string | null;
  me: MeDto | null;
  activeOrganizationId: string | null;
  status: 'booting' | 'anonymous' | 'authenticated';
  setAccessToken: (token: string | null) => void;
  setMe: (me: MeDto) => void;
  setActiveOrganization: (id: string | null) => void;
  setStatus: (s: AuthState['status']) => void;
  clear: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  me: null,
  activeOrganizationId: readStoredOrg(),
  status: 'booting',
  setAccessToken: (accessToken) => set({ accessToken }),
  setMe: (me) => set({ me, status: 'authenticated' }),
  setActiveOrganization: (id) => {
    writeStoredOrg(id);
    set({ activeOrganizationId: id });
  },
  setStatus: (status) => set({ status }),
  clear: () => set({ accessToken: null, me: null, status: 'anonymous' }),
}));

export const hasPermission = (me: MeDto | null, key: string) => !!me?.permissions.includes(key);
