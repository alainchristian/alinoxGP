import { useEffect, useState, type ReactNode } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import type { ExpiryDto } from '@gps/shared';
import { Alert, Badge, Button } from '@/components/ui/primitives';
import { ApiError } from '@/lib/api';
import { errorMessage } from '@/lib/i18n';
import { expiryText, expiryTone, formatDay } from './fleet-model';

/** An expiry as words plus tone; the date is available as a tooltip. Unknown reads "Not set", never "OK". */
export function ExpiryBadge({ expiry }: { expiry: ExpiryDto | null | undefined }) {
  return (
    <span title={expiry ? `Valid through ${formatDay(expiry.date)}` : undefined}>
      <Badge tone={expiryTone(expiry)}>{expiryText(expiry)}</Badge>
    </span>
  );
}

/** Devices whose identifier starts with SIM- are simulated (the API only allows them in sandbox organizations). */
export const isSimulatedDevice = (uniqueId: string | null | undefined) => !!uniqueId && uniqueId.startsWith('SIM-');
export const SimulatedBadge = () => <Badge tone="warn">Simulated</Badge>;

/** The value, delayed until typing pauses (search boxes). */
export function useDebounced<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

/** Says what failed in plain language (by error code) and offers a retry. */
export function QueryError({ query, what }: { query: UseQueryResult<unknown>; what: string }) {
  const err = query.error;
  const message = err instanceof ApiError ? errorMessage(err.code) : `Could not load ${what}.`;
  return (
    <div className="p-5">
      <Alert>
        {message}{' '}
        <button className="underline" onClick={() => void query.refetch()}>
          Retry
        </button>
      </Alert>
    </div>
  );
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return <p className="border-t border-border/70 bg-slate-50/40 px-4 py-3 text-xs font-medium text-text-muted">{total} in total</p>;
  return (
    <div className="flex items-center justify-between gap-3 border-t border-border/70 bg-slate-50/40 px-4 py-3 text-xs font-medium text-text-muted">
      <span className="tabular">
        Page {page} of {pages} · {total} in total
      </span>
      <span className="flex gap-2">
        <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </Button>
        <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next
        </Button>
      </span>
    </div>
  );
}

/** A label/value row for detail panels; a missing value is a dash (unknown), never an invented default. */
export function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border/40 py-2 last:border-b-0">
      <dt className="shrink-0 text-text-muted">{label}</dt>
      <dd className="min-w-0 break-words text-right font-medium text-slate-900">{children ?? '—'}</dd>
    </div>
  );
}
