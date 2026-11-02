import { z } from 'zod';
import { pageQuerySchema, registrationNumberSchema, uuidSchema, type AlertDto, type DeviceLifecycleStatus, type StatusSummaryDto } from './schemas';

/**
 * Fleet management contract (M5a): vehicles, categories, drivers, vehicle documents, dashboard.
 * Shared by the API (validation) and the web app (forms and types).
 *
 * Conventions: an optional field that is not set is `null` (unknown), never a default value; an empty string typed into a
 * form means "not set"; dates are `YYYY-MM-DD` (a day, not an instant).
 */

export const VEHICLE_TYPES = ['CAR', 'MOTORCYCLE', 'TRUCK', 'VAN', 'BUS', 'PICKUP', 'TRACTOR', 'OTHER'] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];
export const FUEL_TYPES = ['PETROL', 'DIESEL', 'ELECTRIC', 'HYBRID', 'LPG', 'OTHER'] as const;
export type FuelType = (typeof FUEL_TYPES)[number];
export const DRIVER_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export type DriverStatus = (typeof DRIVER_STATUSES)[number];
export const VEHICLE_DOCUMENT_TYPES = ['INSURANCE', 'INSPECTION', 'REGISTRATION', 'PERMIT', 'OTHER'] as const;
export type VehicleDocumentType = (typeof VEHICLE_DOCUMENT_TYPES)[number];

// ---------------------------------------------------------------- expiry: ONE rule, used by the API and the web app

export const EXPIRY_SOON_DAYS = 30;
export type ExpiryStatus = 'OK' | 'EXPIRING_SOON' | 'EXPIRED';
export interface ExpiryDto {
  /** The last day the paper is valid, `YYYY-MM-DD`. */
  date: string;
  /** Whole days from today to that date: 0 = the last valid day, negative = expired that many days ago. */
  daysLeft: number;
  status: ExpiryStatus;
}

/** The calendar date `now` falls on in `timeZone`, as `YYYY-MM-DD` (an organization's "today", not the server's). */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** A paper valid through `date` is OK, EXPIRING_SOON within `soonDays` days, EXPIRED the day after. `null` when no date is known. */
export function expiryOf(date: string | null | undefined, today: string, soonDays: number = EXPIRY_SOON_DAYS): ExpiryDto | null {
  if (!date) return null;
  const daysLeft = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  return { date, daysLeft, status: daysLeft < 0 ? 'EXPIRED' : daysLeft <= soonDays ? 'EXPIRING_SOON' : 'OK' };
}

// ---------------------------------------------------------------- field helpers (empty string = not set)

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use at most ${max} characters`)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();

const isoDate = z.iso.date('Use the format YYYY-MM-DD').nullable().optional();

const vinField = z
  .string()
  .trim()
  .max(40)
  .transform((v) => v.replace(/\s+/g, '').toUpperCase())
  .refine((v) => v === '' || /^[A-Z0-9]{5,30}$/.test(v), 'Use 5–30 letters or digits')
  .transform((v) => (v === '' ? null : v))
  .nullable()
  .optional();

const phoneField = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s().-]/g, ''))
  .refine((v) => v === '' || /^\+[1-9]\d{6,14}$/.test(v), 'Use the international format, e.g. +250788123456')
  .transform((v) => (v === '' ? null : v))
  .nullable()
  .optional();

const emailField = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .refine((v) => v === '' || /^[^@\s]+@[^@\s]+$/.test(v), 'Enter a valid email address')
  .transform((v) => (v === '' ? null : v))
  .nullable()
  .optional();

// ---------------------------------------------------------------- vehicles

const vehicleDetails = {
  make: text(60),
  model: text(60),
  year: z.number().int().min(1900).max(2100).nullable().optional(),
  color: text(40),
  vehicleType: z.enum(VEHICLE_TYPES).nullable().optional(),
  vin: vinField,
  fuelType: z.enum(FUEL_TYPES).nullable().optional(),
  insuranceExpiry: isoDate,
  inspectionExpiry: isoDate,
  notes: text(2000),
  categoryId: uuidSchema.nullable().optional(),
};

/** A model year after next year is a typo (a vehicle can be sold a year ahead of its calendar year). */
const yearNotFuture = (v: { year?: number | null }, ctx: z.RefinementCtx) => {
  if (v.year != null && v.year > new Date().getFullYear() + 1) ctx.addIssue({ code: 'custom', path: ['year'], message: 'That year is in the future' });
};

export const createVehicleSchema = z.object({ registrationNumber: registrationNumberSchema, ...vehicleDetails }).superRefine(yearNotFuture);
/** Only the fields present are changed; `null` clears a field. */
export const updateVehicleSchema = z
  .object({ registrationNumber: registrationNumberSchema.optional(), ...vehicleDetails })
  .superRefine(yearNotFuture)
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to change' });

const boolQuery = z.enum(['true', 'false']).transform((v) => v === 'true');
export const VEHICLE_SORTS = ['registration:asc', 'registration:desc', 'created:desc', 'created:asc', 'year:desc', 'year:asc'] as const;
export const vehicleListQuerySchema = pageQuerySchema.extend({
  q: z.string().trim().max(60).optional(),
  categoryId: uuidSchema.optional(),
  hasDevice: boolQuery.optional(),
  hasDriver: boolQuery.optional(),
  sort: z.enum(VEHICLE_SORTS).default('registration:asc'),
});

export interface VehicleDto {
  id: string;
  registrationNumber: string;
  make: string | null;
  model: string | null;
  year: number | null;
  color: string | null;
  vehicleType: VehicleType | null;
  vin: string | null;
  fuelType: FuelType | null;
  notes: string | null;
  insurance: ExpiryDto | null;
  inspection: ExpiryDto | null;
  category: { id: string; name: string; color: string | null } | null;
  /** The ASSIGNED driver — not necessarily the person driving right now. */
  driver: { id: string; fullName: string; since: string } | null;
  /** The device installed now; `since` is the installation date (derived from the assignment, never typed in). */
  device: { id: string; uniqueId: string; since: string } | null;
  documentsCount: number;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------- categories

export const createVehicleCategorySchema = z.object({
  name: z.string().trim().min(1, 'Enter a name').max(60),
  color: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #1d4ed8')
    .nullable()
    .optional(),
});
export const updateVehicleCategorySchema = createVehicleCategorySchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to change' });

export interface VehicleCategoryDto {
  id: string;
  name: string;
  color: string | null;
  vehicleCount: number;
}

// ---------------------------------------------------------------- drivers

const driverDetails = {
  phone: phoneField,
  email: emailField,
  licenseNumber: text(40),
  licenseClass: text(20),
  licenseExpiry: isoDate,
  status: z.enum(DRIVER_STATUSES).optional(),
  notes: text(2000),
};
export const createDriverSchema = z.object({ fullName: z.string().trim().min(1, 'Enter the driver’s name').max(120), ...driverDetails });
export const updateDriverSchema = z
  .object({ fullName: z.string().trim().min(1).max(120).optional(), ...driverDetails })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to change' });

export const driverListQuerySchema = pageQuerySchema.extend({
  q: z.string().trim().max(60).optional(),
  status: z.enum(DRIVER_STATUSES).optional(),
  assigned: boolQuery.optional(),
});

export const assignDriverSchema = z.object({ driverId: uuidSchema, reason: z.string().trim().max(200).optional() });
export const unassignDriverSchema = z.object({ reason: z.string().trim().max(200).optional() });

export interface DriverDto {
  id: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  licenseNumber: string | null;
  licenseClass: string | null;
  license: ExpiryDto | null;
  status: DriverStatus;
  notes: string | null;
  /** The vehicle this driver is assigned to now. */
  vehicle: { id: string; registrationNumber: string; since: string } | null;
  createdAt: string;
}

export interface DriverAssignmentDto {
  id: string;
  driver: { id: string; fullName: string };
  assignedAt: string;
  unassignedAt: string | null;
  reason: string | null;
}

// ---------------------------------------------------------------- vehicle documents (records, not files — OQ-035)

export const createVehicleDocumentSchema = z
  .object({
    type: z.enum(VEHICLE_DOCUMENT_TYPES),
    title: z.string().trim().min(1, 'Enter a title').max(120),
    referenceNumber: text(60),
    issuedOn: isoDate,
    expiresOn: isoDate,
    notes: text(2000),
  })
  .refine((v) => !v.issuedOn || !v.expiresOn || v.expiresOn >= v.issuedOn, { path: ['expiresOn'], message: 'The expiry date is before the issue date' });
export const updateVehicleDocumentSchema = z
  .object({
    type: z.enum(VEHICLE_DOCUMENT_TYPES).optional(),
    title: z.string().trim().min(1).max(120).optional(),
    referenceNumber: text(60),
    issuedOn: isoDate,
    expiresOn: isoDate,
    notes: text(2000),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to change' })
  .refine((v) => !v.issuedOn || !v.expiresOn || v.expiresOn >= v.issuedOn, { path: ['expiresOn'], message: 'The expiry date is before the issue date' });

export interface VehicleDocumentDto {
  id: string;
  vehicleId: string;
  type: VehicleDocumentType;
  title: string;
  referenceNumber: string | null;
  issuedOn: string | null;
  expiresOn: string | null;
  expiry: ExpiryDto | null;
  notes: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------- dashboard (real numbers only)

export type AttentionKind = 'VEHICLE_INSURANCE' | 'VEHICLE_INSPECTION' | 'VEHICLE_DOCUMENT' | 'DRIVER_LICENSE' | 'DEVICE_NO_SIGNAL';
export interface AttentionItemDto {
  kind: AttentionKind;
  /** EXPIRED / EXPIRING_SOON for papers; WARNING for a device that never reported. */
  severity: 'EXPIRED' | 'EXPIRING_SOON' | 'WARNING';
  /** What it is about: a vehicle, a driver or a device. */
  subject: { type: 'vehicle' | 'driver' | 'device'; id: string; label: string };
  /** Plain-language description, e.g. "Insurance". */
  title: string;
  date: string | null;
  daysLeft: number | null;
}

export interface DashboardDto {
  generatedAt: string;
  vehicles: { total: number; withDevice: number; withoutDevice: number; withDriver: number; withoutDriver: number; byCategory: { id: string | null; name: string; count: number }[] };
  /** null when the user may not read drivers. */
  drivers: { total: number; active: number; assigned: number; unassigned: number } | null;
  /** null when the user may not read devices. */
  devices: { total: number; byLifecycle: Partial<Record<DeviceLifecycleStatus, number>>; installed: number; notInstalled: number; installedNeverReported: number } | null;
  /** Live status of vehicles that have a tracker (same rule as the live map). null when the user may not view live tracking. */
  status: StatusSummaryDto | null;
  /** null when the user may not read alerts. */
  alerts: { unacknowledged: number; recent: AlertDto[] } | null;
  attention: AttentionItemDto[];
  attentionTotal: number;
}
