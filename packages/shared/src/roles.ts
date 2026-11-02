import { ALL_PERMISSIONS, ORGANIZATION_PERMISSIONS, P, type PermissionKey } from './permissions';

export const ROLE_SCOPES = ['PLATFORM', 'ORGANIZATION', 'RESELLER'] as const;
export type RoleScope = (typeof ROLE_SCOPES)[number];

export const ORGANIZATION_TYPES = ['PLATFORM', 'RESELLER', 'CUSTOMER'] as const;
export type OrganizationType = (typeof ORGANIZATION_TYPES)[number];

/** Which role scope may be assigned inside which organization type. */
export const ROLE_SCOPE_FOR_ORG_TYPE: Record<OrganizationType, RoleScope> = {
  PLATFORM: 'PLATFORM',
  RESELLER: 'RESELLER',
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
  RESELLER_ADMIN: 'RESELLER_ADMIN',
  RESELLER_STAFF: 'RESELLER_STAFF',
} as const;
export type RoleKey = (typeof ROLE_KEYS)[keyof typeof ROLE_KEYS];

export interface SystemRoleDefinition {
  key: RoleKey;
  scope: RoleScope;
  name: string;
  description: string;
  permissions: readonly PermissionKey[];
}

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
    description: 'Full control of the organization, including billing and ownership transfer.',
    permissions: ORGANIZATION_PERMISSIONS,
  },
  {
    key: ROLE_KEYS.ORG_ADMIN,
    scope: 'ORGANIZATION',
    name: 'Organization Administrator',
    description: 'Manages the organization except ownership transfer; billing is read-only.',
    permissions: without(ORGANIZATION_PERMISSIONS, P.ORGANIZATION_TRANSFER_OWNERSHIP, P.BILLING_MANAGE),
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
  // ---- Reseller ----
  {
    key: ROLE_KEYS.RESELLER_ADMIN,
    scope: 'RESELLER',
    name: 'Reseller Administrator',
    description: 'Manages the reseller organization and its own customers.',
    permissions: [
      P.ORGANIZATION_READ, P.ORGANIZATION_UPDATE,
      P.USERS_READ, P.USERS_INVITE, P.USERS_UPDATE, P.USERS_REMOVE, P.ROLES_READ,
      P.BILLING_READ,
      P.RESELLER_CUSTOMERS_READ, P.RESELLER_CUSTOMERS_MANAGE, P.RESELLER_DEVICES_ASSIGN, P.RESELLER_BRANDING_MANAGE,
    ],
  },
  {
    key: ROLE_KEYS.RESELLER_STAFF,
    scope: 'RESELLER',
    name: 'Reseller Staff',
    description: 'Read access plus limited operations for the reseller’s own customers.',
    permissions: [P.ORGANIZATION_READ, P.USERS_READ, P.RESELLER_CUSTOMERS_READ],
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
      P.PLATFORM_INSTALLATIONS_MANAGE, P.PLATFORM_CUSTOMERS_READ,
    ],
  },
  {
    key: ROLE_KEYS.PLATFORM_FINANCE_ADMIN,
    scope: 'PLATFORM',
    name: 'Finance Administrator',
    description: 'Plans, invoices and payments.',
    permissions: [
      P.ORGANIZATION_READ, P.PLATFORM_CUSTOMERS_READ, P.PLATFORM_BILLING_MANAGE, P.PLATFORM_PLANS_MANAGE, P.BILLING_READ,
    ],
  },
  {
    key: ROLE_KEYS.PLATFORM_SUPPORT_ADMIN,
    scope: 'PLATFORM',
    name: 'Support Administrator',
    description: 'Customer read access and time-boxed support access with a recorded reason.',
    permissions: [P.ORGANIZATION_READ, P.PLATFORM_CUSTOMERS_READ, P.PLATFORM_SUPPORT_ACCESS],
  },
];

export const getSystemRole = (key: string) => SYSTEM_ROLES.find((r) => r.key === key);
