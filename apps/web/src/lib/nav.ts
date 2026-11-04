import {
  Activity,
  BarChart3,
  Bell,
  BookOpen,
  Building2,
  Car,
  CreditCard,
  Cpu,
  FileText,
  Eye,
  Palette,
  Store,
  IdCard,
  LayoutDashboard,
  LifeBuoy,
  Map as MapIcon,
  Navigation,
  Radar,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Users,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
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
 * Customer navigation matching Aegis Fleet DESIGN_PROMPT.md & design_references/01..07.
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
      { label: 'nav.trips', path: '/app/trips', icon: Navigation, permission: P.TRIPS_READ },
      { label: 'nav.geofences', path: '/app/geofences', icon: Radar, permission: P.TRACKING_LIVE_VIEW },
    ],
  },
  {
    label: 'nav.safety',
    items: [
      { label: 'nav.alerts', path: '/app/alerts', icon: Bell, permission: P.ALERTS_READ },
      { label: 'nav.security', path: '/app/security', icon: ShieldAlert, permission: P.VEHICLES_READ },
      { label: 'nav.deviceHealth', path: '/app/device-health', icon: Activity, permission: P.DEVICES_READ },
    ],
  },
  {
    label: 'nav.analytics',
    items: [
      { label: 'nav.reports', path: '/app/reports', icon: BarChart3, permission: P.VEHICLES_READ },
      { label: 'nav.maintenance', path: '/app/maintenance', icon: Wrench, permission: P.VEHICLES_READ },
    ],
  },
  {
    label: 'nav.settings',
    items: [
      { label: 'nav.organization', path: '/app/settings/organization', icon: Building2, permission: P.ORGANIZATION_READ },
      { label: 'nav.users', path: '/app/settings/users', icon: Users, permission: P.USERS_READ },
      { label: 'nav.accessLog', path: '/app/settings/access-log', icon: Eye, permission: P.ORGANIZATION_ACCESS_LOG_READ },
      { label: 'nav.billing', path: '/app/billing', icon: CreditCard, permission: P.ORGANIZATION_READ },
      { label: 'nav.preferences', path: '/app/settings', icon: Settings, permission: P.ORGANIZATION_READ },
    ],
  },
];

/** The provider console: a GPS tracking business running its customers (spec Module 17). */
export const providerNav: NavGroup[] = [
  { label: 'nav.provider', items: [{ label: 'nav.dashboard', path: '/provider', icon: LayoutDashboard, end: true }] },
  {
    label: 'nav.fleet',
    items: [
      { label: 'nav.customers', path: '/provider/customers', icon: Store, permission: P.PROVIDER_CUSTOMERS_READ },
      { label: 'nav.providerFleet', path: '/provider/fleet', icon: MapIcon, permission: P.PROVIDER_CUSTOMERS_VIEW_DATA },
    ],
  },
  {
    label: 'nav.settings',
    items: [
      { label: 'nav.providerStaff', path: '/provider/staff', icon: Users, permission: P.USERS_READ },
      { label: 'nav.branding', path: '/provider/branding', icon: Palette, permission: P.PROVIDER_BRANDING_MANAGE },
    ],
  },
];

/** Platform administration has its own navigation and permissions (spec §7, §12). */
export const adminNav: NavGroup[] = [
  {
    label: 'nav.platform',
    items: [
      { label: 'nav.dashboard', path: '/admin', icon: ShieldCheck, end: true },
      { label: 'nav.providers', path: '/admin/providers', icon: Store, permission: P.PLATFORM_PROVIDERS_READ },
    ],
  },
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
