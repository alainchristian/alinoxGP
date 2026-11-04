import { z } from 'zod';
import { countryCodeSchema, emailSchema, passwordSchema, timezoneSchema, type LiveLocationDto } from './schemas';

/**
 * GPS-provider model (ADR-0010, skill gps-provider-model): registration, lifecycle, branding, customers, limits.
 * "Provider" always means a GPS tracking provider — our paying customer. End customers are CUSTOMER organizations.
 */

// ---------- lifecycle ----------
export const PROVIDER_STATUSES = [
  'PENDING_VERIFICATION', // registered, email not yet verified
  'PENDING_APPROVAL', // email verified, waiting for a platform administrator
  'TRIAL', // approved, trial period
  'ACTIVE',
  'GRACE', // payment overdue (M10): still working, warned
  'SUSPENDED', // by the platform: console read-only, customers see a neutral message, ingestion continues
  'CLOSED',
  'REJECTED',
] as const;
export type ProviderStatus = (typeof PROVIDER_STATUSES)[number];

/** States in which the provider may run real (non-sandbox) customers and devices. */
export const PROVIDER_OPERATING_STATUSES: readonly ProviderStatus[] = ['TRIAL', 'ACTIVE', 'GRACE'];
export const isOperatingProvider = (s: ProviderStatus) => PROVIDER_OPERATING_STATUSES.includes(s);

/** Version of the provider terms / data-processing agreement shown at registration. DRAFT wording: legal review pending (OQ-038). */
export const PROVIDER_TERMS_VERSION = 'draft-2026-11';

// ---------- registration (public) ----------
export const providerRegistrationSchema = z.object({
  companyName: z.string().trim().min(2).max(120),
  registrationNumber: z.string().trim().max(60).optional(),
  tin: z.string().trim().max(30).optional(),
  countryCode: countryCodeSchema.default('RW'),
  timezone: timezoneSchema.optional(),
  contactName: z.string().trim().min(1).max(120),
  email: emailSchema,
  phone: z.string().trim().max(30).optional(),
  password: passwordSchema,
  // An empty form field means "not given", never 0 devices.
  expectedDevices: z.preprocess((v) => (v === '' || v === null ? undefined : v), z.coerce.number().int().min(0).max(1_000_000).optional()),
  acceptedTermsVersion: z.literal(PROVIDER_TERMS_VERSION),
});
export type ProviderRegistrationInput = z.infer<typeof providerRegistrationSchema>;

// ---------- branding ----------
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #1F6FEB');
const urlOrNull = z.string().trim().url().max(300).nullable();
const textOrNull = (max: number) => z.string().trim().max(max).nullable();

export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/;
export const brandingUpdateSchema = z
  .object({
    slug: z.string().trim().toLowerCase().regex(SLUG_PATTERN, '3–32 characters: letters, digits and hyphens').nullable(),
    displayName: z.string().trim().min(2).max(80).nullable(),
    primaryColor: hexColor.nullable(),
    accentColor: hexColor.nullable(),
    supportPhone: textOrNull(30),
    supportEmail: emailSchema.nullable(),
    supportWhatsapp: textOrNull(30),
    websiteUrl: urlOrNull,
    termsUrl: urlOrNull,
    privacyUrl: urlOrNull,
    showPoweredBy: z.boolean(),
  })
  .partial();
export type BrandingUpdateInput = z.infer<typeof brandingUpdateSchema>;

/** What an unauthenticated visitor or a customer's browser may see: display data only, never registration details. */
export interface BrandingDto {
  slug: string | null;
  displayName: string;
  primaryColor: string;
  /** Readable text colour for content on the primary colour (computed, WCAG AA when achievable). */
  onPrimaryColor: string;
  accentColor: string;
  logoUrl: string | null;
  supportPhone: string | null;
  supportEmail: string | null;
  supportWhatsapp: string | null;
  websiteUrl: string | null;
  termsUrl: string | null;
  privacyUrl: string | null;
  showPoweredBy: boolean;
  /** True when this is the platform's own neutral branding (unknown slug, or no provider). */
  neutral: boolean;
}

/** Neutral platform branding: what an unknown address gets, so the response never reveals which slugs exist. */
export const NEUTRAL_BRANDING: BrandingDto = {
  slug: null,
  displayName: 'GPS Platform',
  primaryColor: '#1F4ED8',
  onPrimaryColor: '#FFFFFF',
  accentColor: '#0F766E',
  logoUrl: null,
  supportPhone: null,
  supportEmail: null,
  supportWhatsapp: null,
  websiteUrl: null,
  termsUrl: null,
  privacyUrl: null,
  showPoweredBy: false,
  neutral: true,
};

// ---------- colour contrast (providers choose colours; text on them must stay readable) ----------
function channel(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}
/** Relative luminance of a #RRGGBB colour (WCAG 2.x). */
export function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
/** Black or white, whichever reads better on `background`. */
export function readableTextOn(background: string): '#000000' | '#FFFFFF' {
  return contrastRatio(background, '#FFFFFF') >= contrastRatio(background, '#000000') ? '#FFFFFF' : '#000000';
}
/** Whether the best achievable text colour on `background` meets WCAG AA for normal text (4.5:1); true for every colour. */
export const meetsAaOn = (background: string) => contrastRatio(background, readableTextOn(background)) >= 4.5;

// ---------- provider DTOs ----------
export interface ProviderProfileDto {
  organizationId: string;
  status: ProviderStatus;
  companyName: string;
  registrationNumber: string | null;
  tin: string | null;
  contactName: string;
  contactEmail: string;
  contactPhone: string | null;
  expectedDevices: number | null;
  licenceNumber: string | null;
  termsVersion: string | null;
  termsAcceptedAt: string | null;
  approvedAt: string | null;
  rejectionReason: string | null;
  suspendedAt: string | null;
  suspensionReason: string | null;
  createdAt: string;
  branding: BrandingDto;
}

export const providerDecisionSchema = z.object({ reason: z.string().trim().min(3).max(500) });
export const providerApproveSchema = z.object({
  licenceNumber: z.string().trim().max(60).optional(),
  trial: z.boolean().default(true),
});

// ---------- end customers (created by the provider) ----------
export const createCustomerSchema = z.object({
  name: z.string().trim().min(2).max(120),
  legalName: z.string().trim().max(200).optional(),
  countryCode: countryCodeSchema.optional(),
  timezone: timezoneSchema.optional(),
  ownerEmail: emailSchema,
});
export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;

export interface CustomerDto {
  id: string;
  name: string;
  legalName: string | null;
  status: 'ACTIVE' | 'SUSPENDED';
  isSandbox: boolean;
  countryCode: string;
  createdAt: string;
  vehicleCount: number;
  memberCount: number;
  pendingInvitationCount: number;
}

// ---------- per-customer limits (stored now, enforced with plans in M10) ----------
export const CUSTOMER_LIMIT_KEYS = [
  'history_days',
  'max_vehicles',
  'max_users',
  'max_geofences',
  'driver_management',
  'security_features',
] as const;
export type CustomerLimitKey = (typeof CUSTOMER_LIMIT_KEYS)[number];
export const customerLimitsSchema = z.object({
  limits: z
    .array(
      z.object({
        key: z.enum(CUSTOMER_LIMIT_KEYS),
        enabled: z.boolean().nullable().default(null),
        limitValue: z.number().int().min(0).max(100_000).nullable().default(null),
      }),
    )
    .max(CUSTOMER_LIMIT_KEYS.length),
});
export type CustomerLimitsInput = z.infer<typeof customerLimitsSchema>;
export interface CustomerLimitDto {
  key: CustomerLimitKey;
  enabled: boolean | null;
  limitValue: number | null;
}

// ---------- provider staff scope ----------
export const staffScopeSchema = z.object({
  /** null = all customers; a list = only these customers. */
  customerIds: z.array(z.uuid()).max(500).nullable(),
});

// ---------- provider-wide live map (all customers) ----------
export interface ProviderLiveLocationDto extends LiveLocationDto {
  customerId: string;
  customerName: string;
}
export interface ProviderFleetSnapshotDto {
  vehicles: ProviderLiveLocationDto[];
  total: number;
  truncated: boolean;
  /** The customers the viewer may see (the whole tree, or the staff member's scope), for filtering. */
  customers: { id: string; name: string }[];
}
