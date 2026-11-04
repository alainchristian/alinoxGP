import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import * as Dropdown from '@radix-ui/react-dropdown-menu';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Building2, ChevronDown, Eye, LogOut, Menu, Shield, Store, UserRound, X } from 'lucide-react';
import { brandVars, useBranding } from '@/lib/branding';
import { useAuthStore } from '@/lib/auth-store';
import { roleLabel, t } from '@/lib/i18n';
import { adminNav, customerNav, providerNav, visibleNav, type NavGroup } from '@/lib/nav';
import { activeMembership, homePathFor, signOut, switchOrganization } from '@/lib/session';
import { cn } from '@/lib/utils';
import { Select } from './ui/primitives';

type Variant = 'customer' | 'admin' | 'provider';

function Sidebar({ groups, onNavigate, variant }: { groups: NavGroup[]; onNavigate: () => void; variant: Variant }) {
  return (
    <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 py-5 space-y-6">
      {groups.map((g) => (
        <div key={g.label}>
          <p className="px-3 pb-2 text-[10.5px] font-bold uppercase tracking-[0.1em] text-[#7A8BA3]">{t(g.label)}</p>
          <ul className="space-y-1">
            {g.items.map((item) => (
              <li key={item.path}>
                <NavLink
                  to={item.path}
                  end={item.end}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    cn(
                      'group relative flex h-10 items-center gap-3 rounded-[10px] px-3.5 text-[13.5px] transition-all duration-150',
                      isActive
                        ? variant === 'admin'
                          ? 'bg-amber-500/15 text-amber-200 font-bold ring-1 ring-amber-500/40'
                          : 'bg-[#16243A] text-white font-bold ring-1 ring-[#2B4C8C]/80'
                        : 'font-medium text-[#A0AEC0] hover:bg-white/[0.04] hover:text-white',
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      {isActive && (
                        <span
                          aria-hidden
                          className={cn(
                            'absolute left-0 top-1.5 bottom-1.5 w-[4px] rounded-r-full',
                            variant === 'admin' ? 'bg-amber-400' : 'bg-[#3B82F6]',
                          )}
                        />
                      )}
                      <item.icon
                        className={cn(
                          'size-[17px] shrink-0 transition-colors',
                          isActive
                            ? variant === 'admin'
                              ? 'text-amber-300'
                              : 'text-[#60A5FA]'
                            : 'text-[#7A8BA3] group-hover:text-slate-300',
                        )}
                        aria-hidden
                      />
                      <span>{t(item.label)}</span>
                    </>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function SidebarUserFooter() {
  const me = useAuthStore((s) => s.me);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  if (!me) return null;
  const membership = activeMembership(me);
  const roleText = membership?.roleKeys.map(roleLabel).join(', ') || 'Organization account';
  const initials = me.user.fullName
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div className="border-t border-[#1B2840] p-3">
      <Dropdown.Root>
        <Dropdown.Trigger
          className="flex w-full cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-white/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          aria-label="Account menu"
        >
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[#2B4468] text-xs font-bold text-white">
            {initials}
          </span>
          <div className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-bold leading-tight text-white">{me.user.fullName}</span>
            <span className="mt-0.5 block truncate text-[11px] font-medium leading-tight text-[#7A8BA3]">{roleText}</span>
          </div>
          <ChevronDown className="size-4 shrink-0 text-[#7A8BA3]" aria-hidden />
        </Dropdown.Trigger>
        <Dropdown.Portal>
          <Dropdown.Content align="start" side="top" sideOffset={8} className="z-50 min-w-56 rounded-xl border border-border bg-surface p-1.5 shadow-xl">
            <div className="border-b border-border/70 px-3 py-2">
              <p className="text-xs font-bold text-text">{me.user.fullName}</p>
              <p className="truncate text-[11px] text-text-muted">{me.user.email}</p>
            </div>
            <div className="py-1">
              <Dropdown.Item
                onSelect={() => navigate('/account')}
                className="flex h-8 cursor-pointer items-center gap-2 rounded-lg px-2.5 text-[13px] font-medium text-text outline-none transition-colors data-[highlighted]:bg-surface-2"
              >
                <UserRound className="size-4 text-text-muted" aria-hidden /> {t('nav.account')}
              </Dropdown.Item>
              <Dropdown.Item
                onSelect={async () => {
                  await signOut(queryClient);
                  navigate('/login');
                }}
                className="flex h-8 cursor-pointer items-center gap-2 rounded-lg px-2.5 text-[13px] font-medium text-danger outline-none transition-colors data-[highlighted]:bg-danger-soft"
              >
                <LogOut className="size-4" aria-hidden /> Sign out
              </Dropdown.Item>
            </div>
          </Dropdown.Content>
        </Dropdown.Portal>
      </Dropdown.Root>
    </div>
  );
}

function OrgSwitcher() {
  const me = useAuthStore((s) => s.me);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const own = me?.memberships.filter((m) => m.relation === 'MEMBER') ?? [];
  if (!me || own.length === 0) return null;
  // Provider staff acting for a customer: the customer is not one of their own organizations, but it is the active one.
  const acting = me.memberships.find((m) => m.relation === 'CUSTOMER' && m.organization.id === me.activeOrganizationId);
  if (acting) {
    return (
      <div className="inline-flex items-center gap-2 rounded-[10px] border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-text shadow-2xs">
        <Building2 className="size-3.5 text-brand" aria-hidden />
        <span className="max-w-52 truncate">{acting.organization.name}</span>
      </div>
    );
  }
  if (own.length === 1) {
    const org = own[0]!.organization;
    return (
      <div className="inline-flex items-center gap-2 rounded-[10px] border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-text shadow-2xs">
        <Building2 className="size-3.5 text-brand" aria-hidden />
        <span className="max-w-52 truncate">{org.name}</span>
        {org.timezone && <span className="hidden border-l border-border pl-2 text-[11px] font-normal text-text-muted md:inline">{org.timezone}</span>}
      </div>
    );
  }
  return (
    <label className="flex items-center gap-2">
      <span className="sr-only">Organization</span>
      <div className="relative flex items-center">
        <Building2 className="pointer-events-none absolute left-3 size-3.5 text-brand" aria-hidden />
        <Select
          value={me.activeOrganizationId ?? ''}
          className="h-9 max-w-60 bg-surface pl-8 text-xs font-semibold"
          onChange={async (e) => {
            await switchOrganization(e.target.value, queryClient);
            const next = useAuthStore.getState().me;
            navigate(homePathFor(next));
          }}
        >
          {own.map((m) => (
            <option key={m.organization.id} value={m.organization.id}>
              {m.organization.name}
            </option>
          ))}
        </Select>
      </div>
    </label>
  );
}

/**
 * Shown while provider staff look at one customer's data. They are not members of the customer: everything they do is
 * recorded in the customer's access log, and the customer's owner can read it.
 */
function ActingBanner() {
  const me = useAuthStore((s) => s.me);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  if (!me) return null;
  const acting = me.memberships.find((m) => m.relation === 'CUSTOMER' && m.organization.id === me.activeOrganizationId);
  if (!acting) return null;
  const provider = me.memberships.find((m) => m.relation === 'MEMBER' && m.organization.id === acting.organization.providerId);
  return (
    <div role="status" className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-amber-300 bg-amber-50 px-4 py-2 text-[13px] text-amber-950 sm:px-6">
      <Eye className="size-4 shrink-0 text-amber-700" aria-hidden />
      <span className="min-w-0 flex-1">
        You are viewing <strong>{acting.organization.name}</strong> as staff of {provider?.organization.name ?? 'the provider'}. What you open here is recorded in the customer’s access log.
      </span>
      {provider && (
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-lg border border-amber-400 bg-white px-2.5 py-1 text-xs font-semibold text-amber-900 hover:bg-amber-100"
          onClick={async () => {
            await switchOrganization(provider.organization.id, queryClient);
            navigate(homePathFor(useAuthStore.getState().me));
          }}
        >
          <ArrowLeft className="size-3.5" aria-hidden /> Back to the provider console
        </button>
      )}
    </div>
  );
}

/** Shared frame for the customer app, the provider console and the platform-admin app; matches the Aegis Fleet design package. */
export function Shell({
  variant,
  fullBleed = false,
}: {
  variant: Variant;
  /** The page fills the whole content area (live map) instead of sitting in a padded, centred column. */
  fullBleed?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const permissions = useAuthStore((s) => s.me?.permissions ?? []);
  const groups = visibleNav(variant === 'admin' ? adminNav : variant === 'provider' ? providerNav : customerNav, permissions);
  // The platform console keeps the platform's own look; customer and provider screens wear the provider's brand.
  const branding = useBranding();
  const themed = variant !== 'admin';
  const brandName = themed && !branding.neutral ? branding.displayName : 'Aegis Fleet';

  return (
    <div className="flex h-full bg-bg" style={themed ? (brandVars(branding) as React.CSSProperties) : undefined}>
      {open && <div className="fixed inset-0 z-30 bg-slate-950/60 backdrop-blur-xs lg:hidden" onClick={() => setOpen(false)} aria-hidden />}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-60 flex-col bg-[#0D1422] border-r border-[#1B2840] transition-transform duration-200 ease-in-out lg:static lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        {/* Brand header matching 01_dashboard.png .. 07_reports_analytics.png */}
        <div className="flex h-[76px] items-center justify-between border-b border-[#1B2840] px-4">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                'grid size-10 place-items-center rounded-xl text-white shadow-sm font-extrabold text-[18px]',
                variant === 'admin' ? 'bg-amber-600' : 'bg-brand text-brand-text',
              )}
            >
              {variant === 'admin' ? (
                <Shield className="size-5" />
              ) : themed && branding.logoUrl ? (
                <img src={branding.logoUrl} alt="" className="size-10 rounded-xl object-cover" />
              ) : variant === 'provider' ? (
                <Store className="size-5" aria-hidden />
              ) : (
                <span aria-hidden>{brandName.slice(0, 1).toUpperCase()}</span>
              )}
            </div>
            <div className="min-w-0">
              <span className="block truncate text-[17px] font-bold tracking-tight text-white leading-tight">{brandName}</span>
              <span className="mt-0.5 block text-[10px] font-semibold tracking-[0.14em] text-[#94A3B8] uppercase">
                {variant === 'admin' ? 'PLATFORM CONSOLE' : variant === 'provider' ? 'PROVIDER CONSOLE' : !branding.neutral && branding.showPoweredBy ? 'POWERED BY AEGIS FLEET' : 'GPS TELEMETRY'}
              </span>
            </div>
          </div>
          <button className="text-slate-400 hover:text-white lg:hidden" onClick={() => setOpen(false)} aria-label="Close menu">
            <X className="size-5" />
          </button>
        </div>

        <Sidebar groups={groups} onNavigate={() => setOpen(false)} variant={variant} />
        <SidebarUserFooter />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Compact mobile bar on <lg or platform-admin banner */}
        <header
          className={cn(
            'flex h-12 shrink-0 items-center justify-between gap-3 border-b bg-surface px-4 sm:px-6',
            variant === 'admin' ? 'border-b-2 border-amber-600' : 'border-border/70 lg:hidden',
          )}
        >
          <div className="flex items-center gap-2.5">
            <button className="rounded-lg p-1.5 text-text-muted hover:bg-surface-2 lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
              <Menu className="size-5" />
            </button>
            {variant === 'admin' && (
              <span className="inline-flex items-center gap-1.5 rounded-md bg-amber-50 px-2.5 py-0.5 text-xs font-bold text-amber-900 ring-1 ring-amber-500/30">
                <Shield className="size-3.5 text-amber-600" /> Platform admin
              </span>
            )}
            <OrgSwitcher />
          </div>
        </header>

        <ActingBanner />

        {fullBleed ? (
          <main className="min-h-0 flex-1 overflow-y-auto">
            <Outlet />
          </main>
        ) : (
          <main className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
            <div className="mx-auto max-w-[1440px]">
              <Outlet />
            </div>
          </main>
        )}
      </div>
    </div>
  );
}
