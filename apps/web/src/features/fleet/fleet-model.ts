import {
  DRIVER_STATUSES,
  FUEL_TYPES,
  VEHICLE_DOCUMENT_TYPES,
  VEHICLE_TYPES,
  type AttentionItemDto,
  type DriverDto,
  type ExpiryDto,
  type FuelType,
  type VehicleDocumentDto,
  type VehicleDocumentType,
  type VehicleDto,
  type VehicleType,
} from '@gps/shared';

/** Pure helpers for the fleet pages (labels, expiry wording, form <-> API conversion). Unit-tested; no React here. */

export const VEHICLE_TYPE_LABEL: Record<VehicleType, string> = {
  CAR: 'Car', MOTORCYCLE: 'Motorcycle', TRUCK: 'Truck', VAN: 'Van', BUS: 'Bus', PICKUP: 'Pickup', TRACTOR: 'Tractor', OTHER: 'Other',
};
export const FUEL_TYPE_LABEL: Record<FuelType, string> = {
  PETROL: 'Petrol', DIESEL: 'Diesel', ELECTRIC: 'Electric', HYBRID: 'Hybrid', LPG: 'LPG', OTHER: 'Other',
};
export const DOCUMENT_TYPE_LABEL: Record<VehicleDocumentType, string> = {
  INSURANCE: 'Insurance', INSPECTION: 'Inspection', REGISTRATION: 'Registration', PERMIT: 'Permit', OTHER: 'Other',
};
export const vehicleTypeOptions = VEHICLE_TYPES.map((v) => ({ value: v, label: VEHICLE_TYPE_LABEL[v] }));
export const fuelTypeOptions = FUEL_TYPES.map((v) => ({ value: v, label: FUEL_TYPE_LABEL[v] }));
export const documentTypeOptions = VEHICLE_DOCUMENT_TYPES.map((v) => ({ value: v, label: DOCUMENT_TYPE_LABEL[v] }));
export const driverStatusOptions = DRIVER_STATUSES.map((v) => ({ value: v, label: v === 'ACTIVE' ? 'Active' : 'Inactive' }));

/** `2026-11-02` -> `02/11/2026` (the product's date format). Unknown is a dash, never a made-up date. */
export function formatDay(day: string | null | undefined): string {
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return '—';
  const [y, m, d] = day.split('-');
  return `${d}/${m}/${y}`;
}

const plural = (n: number) => (n === 1 ? '1 day' : `${n} days`);

/** Wording for an expiry: states what is known, in words (colour is never the only signal). */
export function expiryText(e: ExpiryDto | null | undefined): string {
  if (!e) return 'Not set';
  if (e.daysLeft < 0) return `Expired ${plural(-e.daysLeft)} ago`;
  if (e.daysLeft === 0) return 'Expires today';
  return `Expires in ${plural(e.daysLeft)}`;
}
export type ExpiryTone = 'neutral' | 'ok' | 'warn' | 'danger';
export const expiryTone = (e: ExpiryDto | null | undefined): ExpiryTone => (!e ? 'neutral' : e.status === 'EXPIRED' ? 'danger' : e.status === 'EXPIRING_SOON' ? 'warn' : 'ok');

/** "Toyota Hiace · 2019", or an empty string when nothing is known. */
export function vehicleSubtitle(v: Pick<VehicleDto, 'make' | 'model' | 'year'>): string {
  const name = [v.make, v.model].filter(Boolean).join(' ');
  return [name, v.year ? String(v.year) : ''].filter(Boolean).join(' · ');
}

/** Where an attention item leads. */
export function attentionHref(i: AttentionItemDto): string {
  if (i.subject.type === 'vehicle') return `/app/vehicles/${i.subject.id}`;
  if (i.subject.type === 'driver') return '/app/drivers';
  return '/app/monitor';
}

// ---------------------------------------------------------------- forms: strings in, API payload out

const blank = (s: string) => (s.trim() === '' ? null : s.trim());

export interface VehicleFormValues {
  registrationNumber: string;
  make: string;
  model: string;
  year: string;
  color: string;
  vehicleType: string;
  vin: string;
  fuelType: string;
  categoryId: string;
  insuranceExpiry: string;
  inspectionExpiry: string;
  notes: string;
}
export const emptyVehicleForm: VehicleFormValues = {
  registrationNumber: '', make: '', model: '', year: '', color: '', vehicleType: '', vin: '', fuelType: '', categoryId: '', insuranceExpiry: '', inspectionExpiry: '', notes: '',
};
export const vehicleToForm = (v: VehicleDto): VehicleFormValues => ({
  registrationNumber: v.registrationNumber,
  make: v.make ?? '',
  model: v.model ?? '',
  year: v.year ? String(v.year) : '',
  color: v.color ?? '',
  vehicleType: v.vehicleType ?? '',
  vin: v.vin ?? '',
  fuelType: v.fuelType ?? '',
  categoryId: v.category?.id ?? '',
  insuranceExpiry: v.insurance?.date ?? '',
  inspectionExpiry: v.inspection?.date ?? '',
  notes: v.notes ?? '',
});
/** Empty fields become `null` (clears the value on update, "unknown" on create); a year that is not a whole number is sent as-is so the server reports it. */
export function vehicleFormToPayload(f: VehicleFormValues) {
  const year = blank(f.year);
  return {
    registrationNumber: f.registrationNumber.trim(),
    make: blank(f.make),
    model: blank(f.model),
    year: year === null ? null : Number(year),
    color: blank(f.color),
    vehicleType: blank(f.vehicleType),
    vin: blank(f.vin),
    fuelType: blank(f.fuelType),
    categoryId: blank(f.categoryId),
    insuranceExpiry: blank(f.insuranceExpiry),
    inspectionExpiry: blank(f.inspectionExpiry),
    notes: blank(f.notes),
  };
}

export interface DriverFormValues {
  fullName: string; phone: string; email: string; licenseNumber: string; licenseClass: string; licenseExpiry: string; status: string; notes: string;
}
export const emptyDriverForm: DriverFormValues = { fullName: '', phone: '', email: '', licenseNumber: '', licenseClass: '', licenseExpiry: '', status: 'ACTIVE', notes: '' };
export const driverToForm = (d: DriverDto): DriverFormValues => ({
  fullName: d.fullName, phone: d.phone ?? '', email: d.email ?? '', licenseNumber: d.licenseNumber ?? '', licenseClass: d.licenseClass ?? '',
  licenseExpiry: d.license?.date ?? '', status: d.status, notes: d.notes ?? '',
});
export const driverFormToPayload = (f: DriverFormValues) => ({
  fullName: f.fullName.trim(),
  phone: blank(f.phone),
  email: blank(f.email),
  licenseNumber: blank(f.licenseNumber),
  licenseClass: blank(f.licenseClass),
  licenseExpiry: blank(f.licenseExpiry),
  status: f.status,
  notes: blank(f.notes),
});

export interface DocumentFormValues { type: string; title: string; referenceNumber: string; issuedOn: string; expiresOn: string; notes: string }
export const emptyDocumentForm: DocumentFormValues = { type: 'INSURANCE', title: '', referenceNumber: '', issuedOn: '', expiresOn: '', notes: '' };
export const documentToForm = (d: VehicleDocumentDto): DocumentFormValues => ({
  type: d.type, title: d.title, referenceNumber: d.referenceNumber ?? '', issuedOn: d.issuedOn ?? '', expiresOn: d.expiresOn ?? '', notes: d.notes ?? '',
});
export const documentFormToPayload = (f: DocumentFormValues) => ({
  type: f.type,
  title: f.title.trim(),
  referenceNumber: blank(f.referenceNumber),
  issuedOn: blank(f.issuedOn),
  expiresOn: blank(f.expiresOn),
  notes: blank(f.notes),
});
