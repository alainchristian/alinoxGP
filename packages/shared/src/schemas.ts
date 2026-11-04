import { z } from 'zod';
import { ORGANIZATION_TYPES, ROLE_SCOPES } from './roles';
import { ALERT_SEVERITIES, type AlertSeverity, type AlertType, type StatusThresholds, type VehicleStatus } from './status';

// ---------- primitives ----------
export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));
export const passwordSchema = z
  .string()
  .min(12, 'Use at least 12 characters')
  .max(128, 'Use at most 128 characters');
export const uuidSchema = z.uuid();
export const countryCodeSchema = z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, 'ISO 3166-1 alpha-2 code');
export const currencyCodeSchema = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'ISO 4217 code');
export const timezoneSchema = z
  .string()
  .min(1)
  .max(64)
  .refine((tz) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, 'Unknown IANA time zone');
export const totpCodeSchema = z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code');
export const tokenSchema = z.string().min(20).max(256);

// ---------- auth ----------
export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  fullName: z.string().trim().min(1).max(120),
  organizationName: z.string().trim().min(2).max(120).optional(),
  countryCode: countryCodeSchema.optional(),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
  totpCode: z.string().trim().min(6).max(32).optional(), // 6-digit code or a recovery code
});
export type LoginInput = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({ email: emailSchema });
export const resetPasswordSchema = z.object({ token: tokenSchema, password: passwordSchema });
export const verifyEmailSchema = z.object({ token: tokenSchema });
export const resendVerificationSchema = z.object({ email: emailSchema });
export const stepUpSchema = z
  .object({ password: z.string().min(1).max(128).optional(), totpCode: z.string().trim().min(6).max(32).optional() })
  .refine((v) => v.password || v.totpCode, { message: 'Provide your password or an authenticator code' });
export const totpConfirmSchema = z.object({ code: totpCodeSchema });
export const totpDisableSchema = z.object({ password: z.string().min(1).max(128) });
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
});

// ---------- organizations ----------
export const createOrganizationSchema = z.object({
  name: z.string().trim().min(2).max(120),
  legalName: z.string().trim().max(200).optional(),
  countryCode: countryCodeSchema.default('RW'),
  timezone: timezoneSchema.optional(),
  currencyCode: currencyCodeSchema.optional(),
  locale: z.string().trim().min(2).max(10).optional(),
});
export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;

export const updateOrganizationSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    legalName: z.string().trim().max(200).nullable(),
    countryCode: countryCodeSchema,
    timezone: timezoneSchema,
    currencyCode: currencyCodeSchema,
    locale: z.string().trim().min(2).max(10),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;

// ---------- members, invitations ----------
export const roleKeySchema = z.string().regex(/^[A-Z_]{3,40}$/);
export const inviteMemberSchema = z.object({ email: emailSchema, roleKey: roleKeySchema });
export const updateMemberSchema = z
  .object({ roleKeys: z.array(roleKeySchema).min(1).max(5), status: z.enum(['ACTIVE', 'SUSPENDED']) })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });
export const lookupInvitationSchema = z.object({ token: tokenSchema });
export const acceptInvitationNewUserSchema = z.object({
  token: tokenSchema,
  password: passwordSchema,
  fullName: z.string().trim().min(1).max(120),
});
export const acceptInvitationExistingSchema = z.object({ token: tokenSchema });

// ---------- pagination ----------
export const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

// ---------- response DTO types (shape contract between API and web) ----------
export interface UserDto {
  id: string;
  email: string;
  fullName: string;
  locale: string;
  emailVerified: boolean;
  totpEnabled: boolean;
}
export interface OrganizationDto {
  id: string;
  type: (typeof ORGANIZATION_TYPES)[number];
  name: string;
  legalName: string | null;
  countryCode: string;
  timezone: string;
  currencyCode: string;
  locale: string;
  status: 'ACTIVE' | 'SUSPENDED';
  isSandbox: boolean;
  parentOrganizationId: string | null;
  /** The provider at the top of this branch (the provider itself for a provider; null for the platform). */
  providerId: string | null;
}
export interface MembershipDto {
  memberId: string;
  organization: OrganizationDto;
  roleKeys: string[];
  /** MEMBER: user belongs to it. CUSTOMER: a customer organization of the provider the user is staff of (provider staff act for it; they are not members). */
  relation: 'MEMBER' | 'CUSTOMER';
}
export interface MeDto {
  user: UserDto;
  memberships: MembershipDto[];
  activeOrganizationId: string | null;
  permissions: string[];
  /** Plan entitlements arrive with the subscription module (M9); empty until then. */
  entitlements: Record<string, unknown>;
}
export interface AuthSessionDto {
  accessToken: string;
  expiresInSeconds: number;
  user: UserDto;
}
export interface SessionInfoDto {
  id: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastUsedAt: string;
  current: boolean;
}
export interface MemberDto {
  memberId: string;
  userId: string;
  email: string;
  fullName: string;
  status: 'ACTIVE' | 'SUSPENDED';
  roleKeys: string[];
  createdAt: string;
}
export interface InvitationDto {
  id: string;
  email: string;
  roleKey: string;
  expiresAt: string;
  createdAt: string;
}
export interface RoleDto {
  key: string;
  name: string;
  description: string | null;
  scope: (typeof ROLE_SCOPES)[number];
  permissions: string[];
}
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  code: string;
  errors?: { path: string; message: string }[];
}
export interface ListMeta {
  page: number;
  pageSize: number;
  total: number;
}
export interface Paged<T> {
  data: T[];
  meta: ListMeta;
}

// ================================================================ M2: vehicles, devices, tracking

export const registrationNumberSchema = z.string().trim().min(1, 'Enter the registration number').max(20);
// createVehicleSchema / updateVehicleSchema / VehicleDto moved to ./fleet (M5a).

/**
 * Identifier the tracker transmits (usually its IMEI). Letters/digits and . _ : - only — no whitespace or
 * control characters. IMEI Luhn validation is applied per device model by the catalogue (M5), because not every
 * protocol uses an IMEI.
 */
export const deviceUniqueIdSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9._:-]{3,64}$/, 'Use 3-64 letters, digits or . _ : -');
const optionalText = (max: number) => z.string().trim().max(max).transform((v) => (v === '' ? undefined : v)).optional();
export const registerDeviceSchema = z.object({
  uniqueId: deviceUniqueIdSchema,
  name: z.string().trim().min(1).max(80).optional(),
  /** The catalogue variant the customer identified. Optional: without it every capability stays Unknown. */
  variantId: uuidSchema.optional(),
  firmwareVersion: optionalText(60),
  serialNumber: optionalText(60),
  simIccid: z.string().trim().regex(/^[0-9]{18,22}$/, 'The SIM number (ICCID) has 18–22 digits').optional().or(z.literal('').transform(() => undefined)),
  /** The consent notice the user acknowledged for this registration. */
  acknowledgedNoticeId: uuidSchema.optional(),
});
export const updateDeviceSchema = z.object({ name: z.string().trim().min(1).max(80) });
export const assignDeviceSchema = z.object({ vehicleId: uuidSchema, reason: z.string().trim().max(200).optional() });
export const unassignDeviceSchema = z.object({ reason: z.string().trim().max(200).optional() });

export const DEVICE_LIFECYCLE_STATUSES = [
  'REGISTERED',
  'AWAITING_CONFIGURATION',
  'AWAITING_FIRST_SIGNAL',
  'ACTIVE',
  'CONFIGURATION_ERROR',
  'SUSPENDED',
  'RETIRED',
] as const;
export type DeviceLifecycleStatus = (typeof DEVICE_LIFECYCLE_STATUSES)[number];

export interface DeviceDto {
  id: string;
  uniqueId: string;
  name: string | null;
  lifecycleStatus: DeviceLifecycleStatus;
  /** Whether the device is known to the GPS engine. PENDING/FAILED are retried by the platform. */
  engineSyncStatus: 'PENDING' | 'SYNCED' | 'FAILED';
  isSimulated: boolean;
  firstSignalAt: string | null;
  lastSeenAt: string | null;
  createdAt: string;
  assignment: { vehicleId: string; registrationNumber: string; since: string } | null;
  /** The catalogue model this device was identified as; null = not identified (capabilities unknown). */
  variant: { id: string; label: string; isSimulatorProfile: boolean } | null;
  firmwareVersion: string | null;
  serialNumber: string | null;
  simIccid: string | null;
  /** Derived from the last time the device was heard from (never stored). */
  connectivity: 'ONLINE' | 'OFFLINE' | 'NEVER_CONNECTED';
  /** The spec's activation wording: lifecycle wins unless ACTIVE, then connectivity. */
  displayStatus: string;
}

/**
 * Latest known location of a vehicle. Unknown values are `null` (never 0/false): `ignition: null` means the
 * device has not reported ignition. Positions from simulated devices carry `simulated: true`.
 */
export interface LiveLocationDto {
  vehicleId: string;
  registrationNumber: string;
  deviceId: string;
  /** Derived with the one shared `deriveStatus` at request time (so OFFLINE is correct even between sweeper runs). */
  status: VehicleStatus;
  latitude: number | null;
  longitude: number | null;
  speedKmh: number | null;
  heading: number | null;
  ignition: boolean | null;
  lastFixAt: string | null;
  lastSeenAt: string;
  /** The last message carried no usable GPS fix (heartbeat only); coordinates are from an earlier fix. */
  lastFixInvalid: boolean;
  /** The last accepted fix arrived long after it was recorded (buffered data); it was not treated as "happening now". */
  lastFixDelayed: boolean;
  simulated: boolean;
}

/** One vehicle's change pushed over Socket.IO (`vehicle:delta`). Clients merge by `lastFixAt` and ignore older deltas. */
export interface VehicleDeltaDto {
  vehicleId: string;
  status: VehicleStatus;
  latitude: number | null;
  longitude: number | null;
  speedKmh: number | null;
  heading: number | null;
  ignition: boolean | null;
  lastFixAt: string | null;
  lastSeenAt: string;
  lastFixInvalid: boolean;
  lastFixDelayed: boolean;
  simulated: boolean;
}

export interface StatusSummaryDto {
  total: number;
  byStatus: Record<VehicleStatus, number>;
}

export interface AlertDto {
  id: string;
  vehicleId: string;
  registrationNumber: string;
  type: AlertType;
  severity: AlertSeverity;
  startedAt: string;
  simulated: boolean;
  delayed: boolean;
  acknowledgedAt: string | null;
  /** Position at the moment of the alert, when known. */
  latitude: number | null;
  longitude: number | null;
}

export const overspeedParamsSchema = z.object({
  speedLimitKmh: z.number().min(5).max(300),
  /** The vehicle must stay above the limit for this long before the alert fires. */
  minDurationSec: z.number().int().min(0).max(3600).default(10),
});
export type OverspeedParams = z.infer<typeof overspeedParamsSchema>;

/** An overspeed rule needs `speedLimitKmh` (and optionally `minDurationSec`); other types take no parameters. */
export const createAlertRuleSchema = z
  .object({
    type: z.enum(['OVERSPEED', 'IGNITION_ON', 'IGNITION_OFF', 'DEVICE_OFFLINE']),
    params: z.record(z.string(), z.unknown()).default({}),
    severity: z.enum(ALERT_SEVERITIES).default('WARNING'),
    cooldownSeconds: z.number().int().min(0).max(86_400).default(300),
  })
  .superRefine((rule, ctx) => {
    if (rule.type === 'OVERSPEED') {
      const parsed = overspeedParamsSchema.safeParse(rule.params);
      if (!parsed.success) for (const i of parsed.error.issues) ctx.addIssue({ code: 'custom', path: ['params', ...i.path], message: i.message });
    } else if (Object.keys(rule.params).length > 0) {
      ctx.addIssue({ code: 'custom', path: ['params'], message: 'This rule type takes no parameters' });
    }
  });
export type CreateAlertRuleInput = z.infer<typeof createAlertRuleSchema>;
export const updateAlertRuleSchema = z.object({ enabled: z.boolean().optional(), cooldownSeconds: z.number().int().min(0).max(86_400).optional() });

export interface AlertRuleDto {
  id: string;
  type: AlertType;
  params: Record<string, unknown>;
  severity: AlertSeverity;
  cooldownSeconds: number;
  enabled: boolean;
  createdAt: string;
}

export interface StatusConfigDto {
  thresholds: StatusThresholds;
}

/** Result for a single vehicle: either a location, or an honest reason why there is none. */
export interface VehicleLocationResult {
  vehicleId: string;
  registrationNumber: string;
  location: LiveLocationDto | null;
  reason: 'NO_DEVICE' | 'NO_DATA_YET' | null;
}

export interface LatencyPercentiles {
  samples: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

export interface EngineHealthDto {
  engine: { reachable: boolean; version: string | null; detail?: string };
  ingestion: {
    enabled: boolean;
    leader: boolean;
    streamConnected: boolean;
    lastMessageAt: string | null;
    lastConnectedAt: string | null;
  };
  stats: Record<string, number>;
  /** Latency of the last (up to) 10 000 positions: engine -> our consumer, and our own processing time. */
  pipeline: { arrivalLagMs: LatencyPercentiles; processingMs: LatencyPercentiles };
  devices: { total: number; synced: number; pending: number; failed: number; simulated: number };
  lastReconciliation: ReconciliationReport | null;
}

export interface ReconciliationReport {
  ranAt: string;
  checked: number;
  /** In our database as synced, but the engine does not have it. */
  missingInEngine: string[];
  /** Known to the engine but not registered in our database (never deleted automatically). */
  unknownToPlatform: { engineId: number; uniqueId: string }[];
  /** Registered with the engine during this run (previously PENDING/FAILED). */
  repaired: string[];
  failed: { uniqueId: string; code: string }[];
}

// ---------- maps (M4) ----------

/**
 * What the browser needs to draw a map, decided by the SERVER (provider, tiles/styles, public token). The browser never
 * holds a map configuration of its own. `accessToken` is a PUBLIC token (Mapbox `pk.`), never a secret one.
 */
export interface MapConfigDto {
  provider: 'dev-osm' | 'mapbox';
  /** True for a provider that must not be used in production (shown to the user so nobody mistakes it for the real map). */
  devOnly: boolean;
  /** Text the map must display (tile data licences require it). */
  attribution: string;
  /** Raster tile URL templates (`{z}/{x}/{y}`) for the development provider; null for Mapbox. */
  tiles: string[] | null;
  tileSize: number;
  maxZoom: number;
  /** Mapbox style URLs per base layer; null where the provider has no such layer. */
  styles: { streets: string | null; satellite: string | null };
  accessToken: string | null;
  notice: string | null;
}

/** Every vehicle's latest state in one consistent response (the live map's starting point). `truncated` = more vehicles than the server's cap. */
export interface FleetSnapshotDto {
  vehicles: LiveLocationDto[];
  total: number;
  truncated: boolean;
}
