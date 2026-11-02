/**
 * Permission catalogue — the single source of truth for API guards, seeds and web navigation.
 * Format: `resource.action` (or `resource.sub.action`). Authorization is enforced in the API;
 * the web app only uses these keys to hide navigation (cosmetic).
 */
export const P = {
  // Organization
  ORGANIZATION_READ: 'organization.read',
  ORGANIZATION_UPDATE: 'organization.update',
  ORGANIZATION_TRANSFER_OWNERSHIP: 'organization.transfer_ownership',
  // Users & roles
  USERS_READ: 'users.read',
  USERS_INVITE: 'users.invite',
  USERS_UPDATE: 'users.update',
  USERS_REMOVE: 'users.remove',
  ROLES_READ: 'roles.read',
  ROLES_MANAGE: 'roles.manage',
  // Vehicles
  VEHICLES_READ: 'vehicles.read',
  VEHICLES_CREATE: 'vehicles.create',
  VEHICLES_UPDATE: 'vehicles.update',
  VEHICLES_DELETE: 'vehicles.delete',
  VEHICLES_DOCUMENTS_MANAGE: 'vehicles.documents.manage',
  VEHICLES_CATEGORIES_MANAGE: 'vehicles.categories.manage',
  // Drivers
  DRIVERS_READ: 'drivers.read',
  DRIVERS_MANAGE: 'drivers.manage',
  // Devices
  DEVICES_READ: 'devices.read',
  DEVICES_REGISTER: 'devices.register',
  DEVICES_ASSIGN: 'devices.assign',
  DEVICES_CAPABILITIES_READ: 'devices.capabilities.read',
  // Tracking
  TRACKING_LIVE_VIEW: 'tracking.live.view',
  TRACKING_HISTORY_VIEW: 'tracking.history.view',
  TRIPS_READ: 'trips.read',
  // Geofences
  GEOFENCES_READ: 'geofences.read',
  GEOFENCES_MANAGE: 'geofences.manage',
  // Alerts
  ALERTS_READ: 'alerts.read',
  ALERTS_ACKNOWLEDGE: 'alerts.acknowledge',
  ALERT_RULES_MANAGE: 'alert_rules.manage',
  // Security
  SECURITY_STATUS_VIEW: 'security.status.view',
  SECURITY_IMMOBILIZE_REQUEST: 'security.immobilize.request',
  SECURITY_RESTORE_REQUEST: 'security.restore.request',
  SECURITY_HISTORY_VIEW: 'security.history.view',
  // Reports
  REPORTS_VIEW: 'reports.view',
  REPORTS_EXPORT: 'reports.export',
  // Billing
  BILLING_READ: 'billing.read',
  BILLING_MANAGE: 'billing.manage',
  // Integrations
  INTEGRATIONS_MANAGE: 'integrations.manage',
  API_KEYS_MANAGE: 'api_keys.manage',
  // Platform
  PLATFORM_CUSTOMERS_READ: 'platform.customers.read',
  PLATFORM_CUSTOMERS_MANAGE: 'platform.customers.manage',
  PLATFORM_CUSTOMERS_SUSPEND: 'platform.customers.suspend',
  PLATFORM_CATALOGUE_MANAGE: 'platform.catalogue.manage',
  PLATFORM_INVENTORY_MANAGE: 'platform.inventory.manage',
  PLATFORM_INSTALLATIONS_MANAGE: 'platform.installations.manage',
  PLATFORM_DEVICES_DIAGNOSE: 'platform.devices.diagnose',
  PLATFORM_BILLING_MANAGE: 'platform.billing.manage',
  PLATFORM_PLANS_MANAGE: 'platform.plans.manage',
  PLATFORM_SUPPORT_ACCESS: 'platform.support.access',
  PLATFORM_AUDIT_READ: 'platform.audit.read',
  PLATFORM_SETTINGS_MANAGE: 'platform.settings.manage',
  // Reseller
  RESELLER_CUSTOMERS_READ: 'reseller.customers.read',
  RESELLER_CUSTOMERS_MANAGE: 'reseller.customers.manage',
  RESELLER_DEVICES_ASSIGN: 'reseller.devices.assign',
  RESELLER_BRANDING_MANAGE: 'reseller.branding.manage',
} as const;

export type PermissionKey = (typeof P)[keyof typeof P];

export const ALL_PERMISSIONS: readonly PermissionKey[] = Object.values(P);

const isPlatform = (k: string) => k.startsWith('platform.');
const isReseller = (k: string) => k.startsWith('reseller.');

/** Permissions that make sense inside a customer organization. */
export const ORGANIZATION_PERMISSIONS: readonly PermissionKey[] = ALL_PERMISSIONS.filter(
  (k) => !isPlatform(k) && !isReseller(k),
);

/** Actions that require step-up authentication (fresh password/TOTP within 5 minutes). */
export const STEP_UP_WINDOW_SECONDS = 300;
