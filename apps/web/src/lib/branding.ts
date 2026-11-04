import { useQuery } from '@tanstack/react-query';
import { NEUTRAL_BRANDING, readableTextOn, type BrandingDto } from '@gps/shared';
import { api } from './api';
import { useAuthStore } from './auth-store';

/** Darkens a #RRGGBB colour by `amount` (0–1) for hover states. */
export function darken(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (shift: number) => Math.max(0, Math.round(((n >> shift) & 255) * (1 - amount)));
  return `#${[16, 8, 0].map((s) => ch(s).toString(16).padStart(2, '0')).join('')}`;
}

/** Mixes a colour with white: the soft background behind selected items. */
export function tint(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (shift: number) => Math.min(255, Math.round(((n >> shift) & 255) * (1 - amount) + 255 * amount));
  return `#${[16, 8, 0].map((s) => ch(s).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * CSS variables for a provider's branding (applied with `style`, never as provider-supplied CSS or HTML — the values are
 * validated #RRGGBB colours on the server). Text on the brand colour is chosen by the server for contrast.
 */
export function brandVars(b: BrandingDto): Record<string, string> {
  if (b.neutral) return {};
  return {
    '--color-brand': b.primaryColor,
    '--color-brand-hover': darken(b.primaryColor, 0.12),
    '--color-brand-soft': tint(b.primaryColor, 0.9),
    '--color-brand-text': b.onPrimaryColor || readableTextOn(b.primaryColor),
  };
}

/** Where the login page learns the provider from: `?brand=<slug>` (development) or the first label of the host (`<slug>.platform-domain`). */
export function slugFromLocation(search: string, hostname: string): string | null {
  const q = new URLSearchParams(search).get('brand');
  if (q) return q.toLowerCase();
  const labels = hostname.split('.');
  if (labels.length >= 3 && !/^(www|app|api)$/.test(labels[0]!)) return labels[0]!.toLowerCase();
  return null;
}

/** Display branding for the login page. Unknown addresses get the neutral brand; this endpoint never reveals which slugs exist. */
export function useLoginBranding(): BrandingDto {
  const slug = slugFromLocation(window.location.search, window.location.hostname);
  const q = useQuery({
    queryKey: ['branding', 'resolve', slug],
    enabled: slug !== null,
    staleTime: 5 * 60_000,
    queryFn: () => api<BrandingDto>(`/branding/resolve?slug=${encodeURIComponent(slug!)}`, { noOrg: true }),
  });
  return q.data ?? NEUTRAL_BRANDING;
}

/** Branding of the provider that serves the active organization (a customer, or the provider itself). */
export function useBranding(): BrandingDto {
  const orgId = useAuthStore((s) => s.me?.activeOrganizationId ?? null);
  const q = useQuery({
    queryKey: ['branding', 'mine', orgId],
    enabled: !!orgId,
    staleTime: 5 * 60_000,
    queryFn: () => api<BrandingDto>(`/organizations/${orgId}/branding`),
  });
  return q.data ?? NEUTRAL_BRANDING;
}
