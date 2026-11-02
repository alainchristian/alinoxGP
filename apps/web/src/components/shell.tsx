import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import * as Dropdown from '@radix-ui/react-dropdown-menu';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown, LogOut, Menu, UserRound, X } from 'lucide-react';
import { useAuthStore } from '@/lib/auth-store';
import { t } from '@/lib/i18n';
import { adminNav, customerNav, visibleNav, type NavGroup } from '@/lib/nav';
import { activeMembership, signOut, switchOrganization } from '@/lib/session';
import { cn } from '@/lib/utils';
import { Select } from './ui/primitives';

function Sidebar({ groups, onNavigate, variant }: { groups: NavGroup[]; onNavigate: () => void; variant: 'customer' | 'admin' }) {
  return (
    <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 py-3">
      {groups.map((g) => (
        <div key={g.label} className="mb-4">
          <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{t(g.label)}</p>
          <ul className="space-y-0.5">
            {g.items.map((item) => (
              <li key={item.path}>
                <NavLink
                  to={item.path}
                  end={item.end}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    cn(
                      'flex h-9 items-center gap-2.5 rounded-md px-2 text-[13px] text-sidebar-text hover:bg-sidebar-hover',
                      isActive && 'bg-sidebar-hover font-medium text-sidebar-active',
                      isActive && variant === 'admin' && 'ring-1 ring-amber-700/60',
                    )
                  }
                >
                  <item.icon className="size-4 shrink-0" aria-hidden />
                  {t(item.label)}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function UserMenu() {
  const me = useAuthStore((s) => s.me);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  if (!me) return null;
  const initials = me.user.fullName
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <Dropdown.Root>
      <Dropdown.Trigger className="flex h-9 items-center gap-2 rounded-md px-2 hover:bg-surface-2" aria-label="Account menu">
        <span className="grid size-7 place-items-center rounded-full bg-brand-soft text-xs font-semibold text-brand">{initials}</span>
        <span className="hidden max-w-40 truncate text-[13px] sm:block">{me.user.fullName}</span>
        <ChevronDown className="size-3.5 text-text-muted" aria-hidden />
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content align="end" sideOffset={6} className="z-50 min-w-48 rounded-md border border-border bg-surface p-1 shadow-md">
          <div className="px-2 py-1.5 text-xs text-text-muted">{me.user.email}</div>
          <Dropdown.Item onSelect={() => navigate('/account')} className="flex h-8 cursor-pointer items-center gap-2 rounded-sm px-2 text-[13px] outline-none data-[highlighted]:bg-surface-2">
            <UserRound className="size-4" aria-hidden /> {t('nav.account')}
          </Dropdown.Item>
          <Dropdown.Item
            onSelect={async () => {
              await signOut(queryClient);
              navigate('/login');
            }}
            className="flex h-8 cursor-pointer items-center gap-2 rounded-sm px-2 text-[13px] outline-none data-[highlighted]:bg-surface-2"
          >
            <LogOut className="size-4" aria-hidden /> Sign out
          </Dropdown.Item>
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}

function OrgSwitcher() {
  const me = useAuthStore((s) => s.me);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const own = me?.memberships.filter((m) => m.relation === 'MEMBER') ?? [];
  if (!me || own.length === 0) return null;
  if (own.length === 1) return <span className="truncate text-[13px] font-medium">{own[0]!.organization.name}</span>;
  return (
    <label className="flex items-center gap-2">
      <span className="sr-only">Organization</span>
      <Select
        value={me.activeOrganizationId ?? ''}
        className="h-8 max-w-56 text-[13px]"
        onChange={async (e) => {
          await switchOrganization(e.target.value, queryClient);
          const next = useAuthStore.getState().me;
          navigate(activeMembership(next)?.organization.type === 'PLATFORM' ? '/admin' : '/app');
        }}
      >
        {own.map((m) => (
          <option key={m.organization.id} value={m.organization.id}>
            {m.organization.name}
          </option>
        ))}
      </Select>
    </label>
  );
}

/** Shared frame for the customer app and the platform-admin app; they differ in navigation and a visible tag. */
export function Shell({ variant, fullBleed = false }: { variant: 'customer' | 'admin'; /** The page fills the whole content area (live map) instead of sitting in a padded, centred column. */ fullBleed?: boolean }) {
  const [open, setOpen] = useState(false);
  const permissions = useAuthStore((s) => s.me?.permissions ?? []);
  const groups = visibleNav(variant === 'admin' ? adminNav : customerNav, permissions);

  return (
    <div className="flex h-full">
      {open && <div className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden" onClick={() => setOpen(false)} aria-hidden />}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-60 flex-col bg-sidebar transition-transform lg:static lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex h-12 items-center justify-between border-b border-white/10 px-4">
          <span className="text-sm font-semibold text-white">GPS Fleet</span>
          {variant === 'admin' && <span className="rounded-sm bg-amber-600 px-1.5 py-0.5 text-[11px] font-semibold text-white">PLATFORM ADMIN</span>}
          <button className="text-slate-300 lg:hidden" onClick={() => setOpen(false)} aria-label="Close menu">
            <X className="size-5" />
          </button>
        </div>
        <Sidebar groups={groups} onNavigate={() => setOpen(false)} variant={variant} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className={cn('flex h-12 shrink-0 items-center gap-3 border-b bg-surface px-3 sm:px-5', variant === 'admin' ? 'border-b-2 border-amber-600' : 'border-border')}>
          <button className="rounded-md p-1.5 hover:bg-surface-2 lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
            <Menu className="size-5" />
          </button>
          {variant === 'admin' && <span className="hidden text-xs font-semibold text-admin sm:block">Platform admin</span>}
          <div className="min-w-0 flex-1">
            <OrgSwitcher />
          </div>
          <UserMenu />
        </header>
        {fullBleed ? (
          <main className="min-h-0 flex-1">
            <Outlet />
          </main>
        ) : (
          <main className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
            <div className="mx-auto max-w-5xl">
              <Outlet />
            </div>
          </main>
        )}
      </div>
    </div>
  );
}
