import type { ReactNode } from 'react';
import { Compass } from 'lucide-react';
import { brandVars, useLoginBranding } from '@/lib/branding';

/** Clean Aegis Fleet sign-in and recovery layout matching the reference design system. */
export function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  // A provider's customers arrive through the provider's address (…?brand=<slug> or <slug>.platform-domain) and see its brand.
  const branding = useLoginBranding();
  const name = branding.neutral ? 'Aegis Fleet' : branding.displayName;
  return (
    <div className="flex min-h-full flex-col items-center justify-center bg-[#F4F6FA] px-4 py-12" style={brandVars(branding) as React.CSSProperties}>
      <div className="mb-7 flex items-center gap-3">
        <div className="grid size-11 place-items-center overflow-hidden rounded-xl bg-brand text-brand-text shadow-sm">
          {branding.logoUrl ? <img src={branding.logoUrl} alt="" className="size-11 object-cover" /> : <Compass className="size-6" aria-hidden />}
        </div>
        <div>
          <p className="text-[18px] font-bold tracking-tight text-[#172338] leading-tight">{name}</p>
          <p className="mt-0.5 text-[10px] font-semibold tracking-[0.14em] text-[#718096] uppercase">{branding.neutral ? 'GPS TELEMETRY' : 'VEHICLE TRACKING'}</p>
        </div>
      </div>
      <div className="w-full max-w-md rounded-2xl border border-border/90 bg-surface p-8 card-shadow">
        <h1 className="text-[22px] font-bold tracking-tight text-text">{title}</h1>
        {subtitle && <p className="mt-1 text-[13px] text-text-muted leading-relaxed">{subtitle}</p>}
        <div className="mt-6">{children}</div>
      </div>
      {footer && <div className="mt-5 text-[13px] font-medium text-text-muted">{footer}</div>}
      {!branding.neutral && (branding.supportPhone || branding.supportEmail) && (
        <p className="mt-4 text-center text-xs text-text-muted">
          Need help? {[branding.supportPhone, branding.supportEmail].filter(Boolean).join(' · ')}
        </p>
      )}
    </div>
  );
}
