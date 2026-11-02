import { Activity, BookOpen, Building2, Car, Cpu, FileText, IdCard, LayoutDashboard, LifeBuoy, Map as MapIcon, ShieldCheck, Users, Wrench, type LucideIcon } from 'lucide-react';
import { P } from '@gps/shared';
import type { MessageKey } from './i18n';

export interface NavItem {
  label: MessageKey;
  path: string;
  icon: LucideIcon;
  /** Navigation is filtered by permission for convenience only — the API is the authority. */
  permission?: string;
  end?: boolean;
}
export interface NavGroup {
  label: MessageKey;
  items: NavItem[];
}

/**
 * Customer navigation. Spec §12 lists the full sidebar (Fleet, Security, Analytics, Business, ...);
 * entries are added here as the milestone that makes each page work lands — no dead links.
 */
export const customerNav: NavGroup[] = [
  { label: 'nav.overview', items: [{ label: 'nav.dashboard', path: '/app', icon: LayoutDashboard, end: true }] },
  {
    label: 'nav.fleet',
    items: [
      { label: 'nav.live', path: '/app/live', icon: MapIcon, permission: P.TRACKING_LIVE_VIEW },
      { label: 'nav.vehicles', path: '/app/vehicles', icon: Car, permission: P.VEHICLES_READ },
      { label: 'nav.drivers', path: '/app/drivers', icon: IdCard, permission: P.DRIVERS_READ },
      { label: 'nav.devices', path: '/app/devices', icon: Cpu, permission: P.DEVICES_READ },
      // Diagnostics for the position pipeline (M3a): the raw feed, alert rules and thresholds. Not part of the product's tracking UI.
      { label: 'nav.monitor', path: '/app/monitor', icon: Activity, permission: P.TRACKING_LIVE_VIEW },
    ],
  },
  {
    label: 'nav.settings',
    items: [
      { label: 'nav.organization', path: '/app/settings/organization', icon: Building2, permission: P.ORGANIZATION_READ },
      { label: 'nav.users', path: '/app/settings/users', icon: Users, permission: P.USERS_READ },
    ],
  },
];

/** Platform administration has its own navigation and permissions (spec §7, §12). */
export const adminNav: NavGroup[] = [
  { label: 'nav.platform', items: [{ label: 'nav.dashboard', path: '/admin', icon: ShieldCheck, end: true }] },
  {
    label: 'nav.deviceTools',
    items: [
      { label: 'nav.catalogue', path: '/admin/catalogue', icon: BookOpen, permission: P.PLATFORM_CATALOGUE_MANAGE },
      { label: 'nav.adminDevices', path: '/admin/devices', icon: Wrench, permission: P.PLATFORM_DEVICES_DIAGNOSE },
      { label: 'nav.support', path: '/admin/support', icon: LifeBuoy, permission: P.PLATFORM_CATALOGUE_MANAGE },
      { label: 'nav.consent', path: '/admin/consent', icon: FileText, permission: P.PLATFORM_SETTINGS_MANAGE },
    ],
  },
  {
    label: 'nav.settings',
    items: [{ label: 'nav.staff', path: '/admin/staff', icon: Users, permission: P.USERS_READ }],
  },
];

export function visibleNav(groups: NavGroup[], permissions: readonly string[]): NavGroup[] {
  return groups
    .map((g) => ({ ...g, items: g.items.filter((i) => !i.permission || permissions.includes(i.permission)) }))
    .filter((g) => g.items.length > 0);
}
