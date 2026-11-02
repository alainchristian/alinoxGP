import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

/** Dates are shown in the organization's time zone, 24-hour clock (DD/MM/YYYY), per gps-fleet-ui §7. */
export function formatDateTime(iso: string | null | undefined, timeZone = 'Africa/Kigali'): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'short', timeStyle: 'short', hour12: false, timeZone }).format(new Date(iso));
}

/** Relative time with the absolute value available as a tooltip by the caller. */
export function formatRelative(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '—';
  const diff = Math.round((new Date(iso).getTime() - now) / 1000);
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(diff, 'second');
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  return rtf.format(Math.round(diff / 86400), 'day');
}
