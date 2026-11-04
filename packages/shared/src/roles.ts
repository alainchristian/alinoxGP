import { ALL_PERMISSIONS, ORGANIZATION_PERMISSIONS, P, PROVIDER_PERMISSIONS, type PermissionKey } from './permissions';

export const ROLE_SCOPES = ['PLATFORM', 'PROVIDER', 'ORGANIZATION'] as const;
export type RoleScope = (typeof ROLE_SCOPES)[number];

export const ORGANIZATION_TYPES = ['PLATFORM', 'PROVIDER', 'CUSTOMER'] as const;
export type OrganizationType = (typeof ORGANIZATION_TYPES)[number];

/** Which role scope may be assigned inside which organization type. */
export const ROLE_SCOPE_FOR_ORG_TYPE: Record<OrganizationType, RoleScope> = {
  PLATFORM: 'PLATFORM',
  PROVIDER: 'PROVIDER',
  CUSTOMER: 'ORGANIZATION',
};

export const ROLE_KEYS = {
  PLATFORM_SUPER_ADMIN: 'PLATFORM_SUPER_ADMIN',
  PLATFORM_OPERATIONS_ADMIN: 'PLATFORM_OPERATIONS_ADMIN',
  PLATFORM_TECHNICAL_ADMIN: 'PLATFORM_TECHNICAL_ADMIN',
  PLATFORM_FINANCE_ADMIN: 'PLATFORM_FINANCE_ADMIN',
  PLATFORM_SUPPORT_ADMIN: 'PLATFORM_SUPPORT_ADMIN',
  ORG_OWNER: 'ORG_OWNER',
  ORG_ADMIN: 'ORG_ADMIN',
  FLEET_MANAGER: 'FLEET_MANAGER',
  SECURITY_MANAGER: 'SECURITY_MANAGER',
  DRIVER: 'DRIVER',
  VIEWER: 'VIEWER',
  PROVIDER_OWNER: 'PROVIDER_OWNER',
  PROVIDER_ADMIN: 'PROVIDER_ADMIN',
  PROVIDER_OPERATIONS: 'PROVIDER_OPERATIONS',
  PROVIDER_TECHNICIAN: 'PROVIDER_TECHNICIAN',
  PROVIDER_FINANCE: 'PROVIDER_FINANCE',
} as const;
export type RoleKey = (typeof ROLE_KEYS)[keyof typeof ROLE_KEYS];

export interface SystemRoleDefinition {
  key: RoleKey;
  scope: RoleScope;
  name: string;
  description: string;
  permissions: readonly PermissionKey[];
}

/** Organization-level permissions every provider owner/administrator holds for the provider's own organization and staff. */
const PROVIDER_ORG_BASE: readonly PermissionKey[] = [
  P.ORGANIZATION_READ, P.ORGANIZATION_UPDATE,
  P.USERS_READ, P.USERS_INVITE, P.USERS_UPDATE, P.USERS_REMOVE, P.ROLES_READ,
];

const without = (list: readonly PermissionKey[], ...remove: PermissionKey[]) =>
  list.filter((k) => !remove.includes(k));

/**
 * Default role bundles (starting point from the project skill `gps-rbac-permissions`; the owner may adjust).
 * Notably the Fleet Manager has NO immobilize/restore permission (spec §7 example).
 */
export const SYSTEM_ROLES: readonly SystemRoleDefinition[] = [
  // ---- Customer organization ----
  {
    key: ROLE_KEYS.ORG_OWNER,
    scope: 'ORGANIZATION',
    name: 'Organization Owner',
    description: 'Full control of the organization, including ownership transfer.',
    permissions: ORGANIZATION_PERMISSIONS,
  },
  {
    key: ROLE_KEYS.ORG_ADMIN,
    scope: 'ORGANIZATION',
    name: 'Organization Administrator',
    description: 'Manages the organization except ownership transfer.',
    permissions: without(ORGANIZATION_PERMISSIONS, P.ORGANIZATION_TRANSFER_OWNERSHIP, P.ORGANIZATION_ACCESS_LOG_READ),
  },
  {
    key: ROLE_KEYS.FLEET_MANAGER,
    scope: 'ORGANIZATION',
    name: 'Fleet Manager',
    description: 'Operates vehicles, drivers, devices, geofences, alerts and reports. Cannot immobilize vehicles.',
    permissions: [
      P.ORGANIZATION_READ,
      P.VEHICLES_READ, P.VEHICLES_CREATE, P.VEHICLES_UPDATE, P.VEHICLES_DOCUMENTS_MANAGE, P.VEHICLES_CATEGORIES_MANAGE,
      P.DRIVERS_READ, P.DRIVERS_MANAGE,
      P.DEVICES_READ, P.DEVICES_ASSIGN, P.DEVICES_CAPABILITIES_READ,
      P.TRACKING_LIVE_VIEW, P.TRACKING_HISTORY_VIEW, P.TRIPS_READ,
      P.GEOFENCES_READ, P.GEOFENCES_MANAGE,
      P.ALERTS_READ, P.ALERTS_ACKNOWLEDGE, P.ALERT_RULES_MANAGE,
      P.REPORTS_VIEW, P.REPORTS_EXPORT,
    ],
  },
  {
    key: ROLE_KEYS.SECURITY_MANAGER,
    scope: 'ORGANIZATION',
    name: 'Security Manager',
    description: 'Vehicle security, live tracking and alerts.',
    permissions: [
      P.ORGANIZATION_READ,
      P.SECURITY_STATUS_VIEW, P.SECURITY_IMMOBILIZE_REQUEST, P.SECURITY_RESTORE_REQUEST, P.SECURITY_HISTORY_VIEW,
      P.TRACKING_LIVE_VIEW, P.ALERTS_READ, P.ALERTS_ACKNOWLEDGE, P.VEHICLES_READ,
    ],
  },
  {
    key: ROLE_KEYS.DRIVER,
    scope: 'ORGANIZATION',
    name: 'Driver',
    description: 'Sees only the vehicle currently assigned to them (restricted by resource policy).',
    permissions: [P.ORGANIZATION_READ, P.TRACKING_LIVE_VIEW, P.TRIPS_READ],
  },
  {
    key: ROLE_KEYS.VIEWER,
    scope: 'ORGANIZATION',
    name: 'Read-only Viewer',
    description: 'Read-only access to operational data. No exports.',
    permissions: [
      P.ORGANIZATION_READ,
      P.VEHICLES_READ, P.DRIVERS_READ, P.DEVICES_READ, P.DEVICES_CAPABILITIES_READ,
      P.TRACKING_LIVE_VIEW, P.TRACKING_HISTORY_VIEW, P.TRIPS_READ,
      P.GEOFENCES_READ, P.ALERTS_READ, P.SECURITY_STATUS_VIEW, P.SECURITY_HISTORY_VIEW, P.REPORTS_VIEW,
    ],
  },
  // ---- GPS provider (our paying customer; spec §7) ----
  {
    key: ROLE_KEYS.PROVIDER_OWNER,
    scope: 'PROVIDER',
    name: 'Provider Owner',
    description: 'Full control of the provider organization, its staff, customers and branding. Exactly one owner.',
    permissions: [...PROVIDER_ORG_BASE, ...PROVIDER_PERMISSIONS, P.ORGANIZATION_TRANSFER_OWNERSHIP],
  },
  {
    key: ROLE_KEYS.PROVIDER_ADMIN,
    scope: 'PROVIDER',
    name: 'Provider Administrator',
    description: 'Manages customers, staff, devices and branding. Cannot transfer ownership.',
    permissions: [...PROVIDER_ORG_BASE, ...PROVIDER_PERMISSIONS],
  },
  {
    key: ROLE_KEYS.PROVIDER_OPERATIONS,
    scope: 'PROVIDER',
    name: 'Provider Operations / Support',
    description: 'First-line support: creates and edits customers, registers and assigns devices, views customers’ data (audited). Cannot suspend customers or change branding.',
    permissions: [
      P.ORGANIZATION_READ, P.USERS_READ, P.ROLES_READ,
      P.PROVIDER_CUSTOMERS_READ, P.PROVIDER_CUSTOMERS_MANAGE, P.PROVIDER_CUSTOMERS_VIEW_DATA,
      P.PROVIDER_DEVICES_REGISTER, P.PROVIDER_DEVICES_ASSIGN, P.PROVIDER_DEVICES_DIAGNOSE, P.PROVIDER_ALERTS_READ,
    ],
  },
  {
    key: ROLE_KEYS.PROVIDER_TECHNICIAN,
    scope: 'PROVIDER',
    name: 'Provider Technician',
    description: 'Registers and assigns devices and runs diagnostics. Sees customers but not their tracking data.',
    permissions: [
      P.ORGANIZATION_READ, P.PROVIDER_CUSTOMERS_READ,
      P.PROVIDER_DEVICES_REGISTER, P.PROVIDER_DEVICES_ASSIGN, P.PROVIDER_DEVICES_DIAGNOSE,
    ],
  },
  {
    key: ROLE_KEYS.PROVIDER_FINANCE,
    scope: 'PROVIDER',
    name: 'Provider Finance',
    description: 'Usage and invoices of the provider’s subscription; customers read-only.',
    permissions: [P.ORGANIZATION_READ, P.PROVIDER_CUSTOMERS_READ, P.PROVIDER_BILLING_READ],
  },
  // ---- Platform ----
  {
    key: ROLE_KEYS.PLATFORM_SUPER_ADMIN,
    scope: 'PLATFORM',
    name: 'Super Administrator',
    description: 'Full platform access. Keep to very few people.',
    permissions: ALL_PERMISSIONS,
  },
  {
    key: ROLE_KEYS.PLATFORM_OPERATIONS_ADMIN,
    scope: 'PLATFORM',
    name: 'Operations Administrator',
    description: 'Customers, inventory, installations and device assignment.',
    permissions: [
      P.ORGANIZATION_READ, P.USERS_READ,
      P.PLATFORM_PROVIDERS_READ, P.PLATFORM_PROVIDERS_APPROVE, P.PLATFORM_PROVIDERS_MANAGE, P.PLATFORM_PROVIDERS_SUSPEND,
      P.PLATFORM_CUSTOMERS_READ, P.PLATFORM_CUSTOMERS_MANAGE, P.PLATFORM_INVENTORY_MANAGE,
      P.PLATFORM_INSTALLATIONS_MANAGE,
    ],
  },
  {
    key: ROLE_KEYS.PLATFORM_TECHNICAL_ADMIN,
    scope: 'PLATFORM',
    name: 'Technical Administrator',
    description: 'Device catalogue, diagnostics, GPS engine operations and installation verification.',
    permissions: [
      P.ORGANIZATION_READ, P.PLATFORM_CATALOGUE_MANAGE, P.PLATFORM_DEVICES_DIAGNOSE,
      P.PLATFORM_INSTALLATIONS_MANAGE, P.PLATFORM_CUSTOMERS_READ, P.PLATFORM_PROVIDERS_READ,
    ],
  },
  {
    key: ROLE_KEYS.PLATFORM_FINANCE_ADMIN,
    scope: 'PLATFORM',
    name: 'Finance Administrator',
    description: 'Plans, invoices and payments.',
    permissions: [
      P.ORGANIZATION_READ, P.PLATFORM_PROVIDERS_READ, P.PLATFORM_CUSTOMERS_READ, P.PLATFORM_BILLING_MANAGE, P.PLATFORM_PLANS_MANAGE,
    ],
  },
  {
    key: ROLE_KEYS.PLATFORM_SUPPORT_ADMIN,
    scope: 'PLATFORM',
    name: 'Support Administrator',
    description: 'Customer read access and time-boxed support access with a recorded reason.',
    permissions: [P.ORGANIZATION_READ, P.PLATFORM_PROVIDERS_READ, P.PLATFORM_CUSTOMERS_READ, P.PLATFORM_SUPPORT_ACCESS],
  },
];

export const getSystemRole = (key: string) => SYSTEM_ROLES.find((r) => r.key === key);

/**
 * What a provider staff member may do inside ONE customer organization (they are not members of it).
 * Derived from the staff member's provider permissions, never wider than the customer-level catalogue,
 * and never including vehicle security commands, ownership transfer or role management: those stay with
 * the customer's own users (and, for emergency restore, a dedicated provider path in M7).
 */
export function permissionsActingOnCustomer(providerPermissions: ReadonlySet<string>): Set<string> {
  const out = new Set<string>();
  const readView = ORGANIZATION_PERMISSIONS.filter((k) => (k.endsWith('.read') || k.endsWith('.view')) && k !== P.ORGANIZATION_ACCESS_LOG_READ);
  if (providerPermissions.has(P.PROVIDER_CUSTOMERS_VIEW_DATA)) for (const k of readView) out.add(k);
  if (providerPermissions.has(P.PROVIDER_CUSTOMERS_MANAGE)) {
    for (const k of [
      P.ORGANIZATION_UPDATE, P.USERS_INVITE, P.USERS_UPDATE,
      P.VEHICLES_CREATE, P.VEHICLES_UPDATE, P.VEHICLES_DOCUMENTS_MANAGE, P.VEHICLES_CATEGORIES_MANAGE,
      P.DRIVERS_MANAGE, P.GEOFENCES_MANAGE, P.ALERTS_ACKNOWLEDGE, P.ALERT_RULES_MANAGE,
    ]) out.add(k);
  }
  if (providerPermissions.has(P.PROVIDER_DEVICES_REGISTER)) out.add(P.DEVICES_REGISTER);
  if (providerPermissions.has(P.PROVIDER_DEVICES_ASSIGN)) out.add(P.DEVICES_ASSIGN);
  if (providerPermissions.has(P.PROVIDER_DEVICES_DIAGNOSE)) {
    out.add(P.DEVICES_READ);
    out.add(P.DEVICES_CAPABILITIES_READ);
  }
  if (out.size > 0) out.add(P.ORGANIZATION_READ);
  return out;
}
