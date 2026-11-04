import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { NEUTRAL_BRANDING, readableTextOn, type BrandingUpdateInput, type ProviderProfileDto } from '@gps/shared';
import { Alert, Button, Card, CardHeader, Field, Input, PageHeader, Skeleton } from '@/components/ui/primitives';
import { QueryError } from '@/features/fleet/fleet-ui';
import { ApiError, api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { brandVars } from '@/lib/branding';
import { errorMessage } from '@/lib/i18n';
import { isValidSlug } from './provider-model';

interface Draft {
  displayName: string;
  slug: string;
  primaryColor: string;
  accentColor: string;
  supportPhone: string;
  supportEmail: string;
  supportWhatsapp: string;
  websiteUrl: string;
  termsUrl: string;
  privacyUrl: string;
  showPoweredBy: boolean;
}

const fromProfile = (p: ProviderProfileDto): Draft => ({
  displayName: p.branding.neutral ? p.companyName : p.branding.displayName,
  slug: p.branding.slug ?? '',
  primaryColor: p.branding.primaryColor,
  accentColor: p.branding.accentColor,
  supportPhone: p.branding.supportPhone ?? '',
  supportEmail: p.branding.supportEmail ?? '',
  supportWhatsapp: p.branding.supportWhatsapp ?? '',
  websiteUrl: p.branding.websiteUrl ?? '',
  termsUrl: p.branding.termsUrl ?? '',
  privacyUrl: p.branding.privacyUrl ?? '',
  showPoweredBy: p.branding.showPoweredBy,
});

const orNull = (s: string) => (s.trim() === '' ? null : s.trim());

/** Empty fields are sent as null (cleared), never as empty strings. Pure so it is tested. */
export function draftToUpdate(d: Draft): BrandingUpdateInput {
  return {
    displayName: orNull(d.displayName),
    slug: orNull(d.slug.toLowerCase()),
    primaryColor: d.primaryColor,
    accentColor: d.accentColor,
    supportPhone: orNull(d.supportPhone),
    supportEmail: orNull(d.supportEmail),
    supportWhatsapp: orNull(d.supportWhatsapp),
    websiteUrl: orNull(d.websiteUrl),
    termsUrl: orNull(d.termsUrl),
    privacyUrl: orNull(d.privacyUrl),
    showPoweredBy: d.showPoweredBy,
  };
}

/** The provider's logo, colours, support contacts and login address: what its customers see (spec Module 17). */
export function BrandingPage() {
  const orgId = useAuthStore((s) => s.me?.activeOrganizationId ?? '');
  const queryClient = useQueryClient();
  const profile = useQuery({ queryKey: ['provider', orgId, 'profile'], queryFn: () => api<ProviderProfileDto>(`/organizations/${orgId}/provider/profile`) });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (profile.data && !draft) setDraft(fromProfile(profile.data));
  }, [profile.data, draft]);

  const save = useMutation({
    mutationFn: () => api<ProviderProfileDto>(`/organizations/${orgId}/provider/branding`, { method: 'PATCH', body: draftToUpdate(draft!) }),
    onSuccess: async (p) => {
      setError(null);
      setSaved(true);
      setDraft(fromProfile(p));
      await queryClient.invalidateQueries({ queryKey: ['branding'] });
      await queryClient.invalidateQueries({ queryKey: ['provider', orgId, 'profile'] });
    },
    onError: (e) => { setSaved(false); setError(e instanceof ApiError ? errorMessage(e.code) : errorMessage(undefined)); },
  });

  if (profile.isPending || !draft) return <Skeleton className="h-64" />;
  if (profile.isError) return <Card><QueryError query={profile} what="your branding" /></Card>;
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => { setSaved(false); setDraft({ ...draft, [key]: value }); };
  const slugOk = draft.slug === '' || isValidSlug(draft.slug.toLowerCase());
  const preview = { ...NEUTRAL_BRANDING, neutral: false, primaryColor: draft.primaryColor, onPrimaryColor: readableTextOn(draft.primaryColor), displayName: draft.displayName || 'Your company' };

  return (
    <>
      <PageHeader title="Branding" description="Your customers see your name, colours and support contacts in the app and on the sign-in page." />
      <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
        <Card>
          <CardHeader title="Identity" description="Shown in the app header and on the sign-in page" />
          <form className="space-y-4 px-6 pb-6" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
            {error && <Alert>{error}</Alert>}
            {saved && <Alert tone="ok">Saved.</Alert>}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Display name" htmlFor="b-name"><Input id="b-name" value={draft.displayName} onChange={(e) => set('displayName', e.target.value)} /></Field>
              <Field label="Sign-in address" htmlFor="b-slug" hint={draft.slug ? `${window.location.origin}/login?brand=${draft.slug.toLowerCase()}` : 'Letters, digits and hyphens'} error={slugOk ? undefined : '3–32 characters: lowercase letters, digits and hyphens'}>
                <Input id="b-slug" value={draft.slug} invalid={!slugOk} onChange={(e) => set('slug', e.target.value)} />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Main colour" htmlFor="b-primary" hint="Buttons, links and the logo tile">
                <div className="flex items-center gap-2"><input aria-label="Pick main colour" type="color" value={draft.primaryColor} onChange={(e) => set('primaryColor', e.target.value.toUpperCase())} className="h-9 w-12 cursor-pointer rounded border border-border" /><Input id="b-primary" value={draft.primaryColor} onChange={(e) => set('primaryColor', e.target.value)} /></div>
              </Field>
              <Field label="Accent colour" htmlFor="b-accent">
                <div className="flex items-center gap-2"><input aria-label="Pick accent colour" type="color" value={draft.accentColor} onChange={(e) => set('accentColor', e.target.value.toUpperCase())} className="h-9 w-12 cursor-pointer rounded border border-border" /><Input id="b-accent" value={draft.accentColor} onChange={(e) => set('accentColor', e.target.value)} /></div>
              </Field>
            </div>
            <h3 className="pt-2 text-[13px] font-bold text-text">Support contacts your customers see</h3>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Phone" htmlFor="b-phone"><Input id="b-phone" value={draft.supportPhone} onChange={(e) => set('supportPhone', e.target.value)} /></Field>
              <Field label="Email" htmlFor="b-email"><Input id="b-email" type="email" value={draft.supportEmail} onChange={(e) => set('supportEmail', e.target.value)} /></Field>
              <Field label="WhatsApp" htmlFor="b-wa"><Input id="b-wa" value={draft.supportWhatsapp} onChange={(e) => set('supportWhatsapp', e.target.value)} /></Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Website" htmlFor="b-site"><Input id="b-site" value={draft.websiteUrl} onChange={(e) => set('websiteUrl', e.target.value)} /></Field>
              <Field label="Terms link" htmlFor="b-terms"><Input id="b-terms" value={draft.termsUrl} onChange={(e) => set('termsUrl', e.target.value)} /></Field>
              <Field label="Privacy link" htmlFor="b-privacy"><Input id="b-privacy" value={draft.privacyUrl} onChange={(e) => set('privacyUrl', e.target.value)} /></Field>
            </div>
            <label className="flex items-center gap-2.5 text-[13px] text-text">
              <input type="checkbox" className="size-4 rounded border-border" checked={draft.showPoweredBy} onChange={(e) => set('showPoweredBy', e.target.checked)} />
              Show a small “powered by” line
            </label>
            <p className="text-xs text-text-muted">Logo upload arrives with file storage (it needs a place to keep the image). Until then the app shows your initial.</p>
            <div className="flex justify-end"><Button type="submit" loading={save.isPending} disabled={!slugOk || !/^#[0-9a-fA-F]{6}$/.test(draft.primaryColor) || !/^#[0-9a-fA-F]{6}$/.test(draft.accentColor)}>Save branding</Button></div>
          </form>
        </Card>
        <Card className="h-fit">
          <CardHeader title="Preview" description="How your header looks" />
          <div className="px-6 pb-6" style={brandVars(preview) as React.CSSProperties}>
            <div className="flex items-center gap-3 rounded-xl bg-[#0D1422] p-4">
              <div className="grid size-10 place-items-center rounded-xl bg-brand font-extrabold text-brand-text">{preview.displayName.slice(0, 1).toUpperCase()}</div>
              <div className="min-w-0"><p className="truncate text-[15px] font-bold text-white">{preview.displayName}</p><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#94A3B8]">{draft.showPoweredBy ? 'Powered by Aegis Fleet' : 'Vehicle tracking'}</p></div>
            </div>
            <button type="button" tabIndex={-1} className="mt-4 h-9 rounded-lg bg-brand px-4 text-[13px] font-semibold text-brand-text">Primary button</button>
            <p className="mt-3 text-[13px] text-brand">A link in your colour</p>
          </div>
        </Card>
      </div>
    </>
  );
}
