import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { Calendar, Diamond, Inbox, Loader2, Search } from 'lucide-react';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------- Button

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
const buttonStyles: Record<ButtonVariant, string> = {
  primary: 'bg-brand text-brand-text hover:bg-brand-hover border-transparent font-semibold shadow-2xs active:translate-y-[0.5px]',
  secondary: 'bg-surface text-text border-border hover:bg-surface-2 hover:border-border-strong font-medium shadow-2xs active:translate-y-[0.5px]',
  ghost: 'bg-transparent text-text-muted border-transparent hover:bg-surface-2 hover:text-text font-medium',
  danger: 'bg-danger text-white border-transparent hover:bg-danger/90 font-semibold shadow-2xs active:translate-y-[0.5px]',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, disabled, className, children, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      // Disabled while pending: prevents double submits (gps-fleet-ui §6).
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex cursor-pointer items-center justify-center gap-2 rounded-[10px] border transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'h-8 px-3 text-xs' : 'h-10 px-4 text-[13px]',
        buttonStyles[variant],
        className,
      )}
      {...rest}
    >
      {loading && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
      {children}
    </button>
  );
});

// ---------------------------------------------------------------- Form controls

const controlStyles =
  'w-full rounded-[10px] border bg-surface-2/80 px-3.5 text-[13px] font-medium text-text placeholder:font-normal placeholder:text-text-faint transition-all duration-150 focus:border-brand focus:bg-surface focus:ring-3 focus:ring-brand/15 focus:outline-none disabled:bg-surface-3 disabled:text-text-muted';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(function Input(
  { className, invalid, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(controlStyles, 'h-10', invalid ? 'border-danger focus:ring-danger/15' : 'border-border hover:border-border-strong', className)}
      {...rest}
    />
  );
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }>(function Select(
  { className, invalid, children, ...rest },
  ref,
) {
  return (
    <select
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(controlStyles, 'h-10 pr-8 cursor-pointer', invalid ? 'border-danger focus:ring-danger/15' : 'border-border hover:border-border-strong', className)}
      {...rest}
    >
      {children}
    </select>
  );
});

export function Field({
  label,
  htmlFor,
  error,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-xs font-semibold tracking-tight text-text">
        {label}
      </label>
      {children}
      {hint && !error && (
        <p id={`${htmlFor}-hint`} className="text-xs text-text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${htmlFor}-error`} role="alert" className="text-xs font-semibold text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Surfaces

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-xl rounded-lg border border-border/90 bg-surface card-shadow', className)} {...rest} />;
}

export function CardHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 px-6 pt-5 pb-3">
      <div>
        <h2 className="text-[16px] font-bold tracking-tight text-text">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

// ---------------------------------------------------------------- Aegis KPI Card (from 01_dashboard, 03_vehicles, 04_gps_devices, 06_alerts_events)

type KpiDotTone = 'brand' | 'ok' | 'warn' | 'danger' | 'neutral';
const kpiDotBox: Record<KpiDotTone, { box: string; dot: string }> = {
  brand: { box: 'bg-[#EEF3FF]', dot: 'bg-[#2458E8]' },
  ok: { box: 'bg-[#E6F7F0]', dot: 'bg-[#16A36A]' },
  warn: { box: 'bg-[#FEF6E6]', dot: 'bg-[#D69B32]' },
  danger: { box: 'bg-[#FDEEEE]', dot: 'bg-[#DC5555]' },
  neutral: { box: 'bg-[#EDF2F7]', dot: 'bg-[#718096]' },
};

export function KpiCard({
  label,
  value,
  caption,
  captionTone = 'muted',
  tone = 'brand',
  className,
}: {
  label: string;
  value: ReactNode;
  caption?: ReactNode;
  captionTone?: 'muted' | 'ok' | 'warn' | 'danger';
  tone?: KpiDotTone;
  className?: string;
}) {
  const palette = kpiDotBox[tone];
  return (
    <div className={cn('rounded-xl border border-border/90 bg-surface p-5 card-shadow flex flex-col justify-between min-h-[132px]', className)}>
      <div className="flex items-center gap-3">
        <span className={cn('grid size-8 shrink-0 place-items-center rounded-lg', palette.box)} aria-hidden>
          <span className={cn('size-2.5 rounded-full', palette.dot)} />
        </span>
        <span className="text-[13px] font-medium text-text-muted">{label}</span>
      </div>
      <div className="mt-3">
        <div className="tabular text-[28px] font-bold leading-none tracking-tight text-text">{value}</div>
        {caption && (
          <div
            className={cn('mt-2 text-xs font-medium', {
              'text-text-muted': captionTone === 'muted',
              'text-ok font-semibold': captionTone === 'ok',
              'text-warn font-semibold': captionTone === 'warn',
              'text-danger font-semibold': captionTone === 'danger',
            })}
          >
            {caption}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Badges & Alerts

type Tone = 'neutral' | 'brand' | 'ok' | 'warn' | 'danger';
const toneStyles: Record<Tone, string> = {
  neutral: 'bg-[#EDF2F7] text-[#4A5568]',
  brand: 'bg-[#EEF3FF] text-[#2458E8]',
  ok: 'bg-[#E6F7F0] text-[#16A36A]',
  warn: 'bg-[#FEF6E6] text-[#B7791F]',
  danger: 'bg-[#FDEEEE] text-[#DC5555]',
};

/** Soft pill badge matching 03_vehicles.png & 06_alerts_events.png */
export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-3 py-0.5 text-xs font-semibold tracking-tight', toneStyles[tone])}>
      {children}
    </span>
  );
}

export function Alert({ tone = 'danger', children }: { tone?: 'danger' | 'ok' | 'warn' | 'neutral'; children: ReactNode }) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn('rounded-xl border px-4 py-3 text-[13px] font-medium leading-relaxed', {
        'border-danger/25 bg-danger-soft text-danger': tone === 'danger',
        'border-ok/25 bg-ok-soft text-ok': tone === 'ok',
        'border-warn/25 bg-warn-soft text-amber-900': tone === 'warn',
        'border-border bg-surface-2 text-text-muted': tone === 'neutral',
      })}
    >
      {children}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('animate-pulse rounded-xl bg-surface-3', className)} />;
}

/**
 * Top page header matching the Aegis Fleet reference mockups (01_dashboard.png .. 07_reports_analytics.png):
 * Title + subtitle on the left, clean search/date/action bar on the right.
 */
export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="-mx-4 -mt-4 mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-border/80 bg-surface px-4 py-4 sm:-mx-6 sm:-mt-6 sm:px-6 lg:-mx-8 lg:-mt-8 lg:px-8">
      <div>
        <h1 className="text-[24px] font-bold tracking-tight text-text leading-tight">{title}</h1>
        {description && <p className="mt-0.5 max-w-3xl text-[13px] text-text-muted">{description}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2.5">
        <div aria-hidden className="hidden md:flex items-center gap-2.5">
          <div className="flex h-10 w-52 items-center gap-2 rounded-[10px] border border-border bg-surface px-3.5 text-xs text-text-muted">
            <Search className="size-3.5 text-text-faint" />
            <span>Search</span>
          </div>
          <div className="flex h-10 items-center gap-2 rounded-[10px] border border-border bg-surface px-3.5 text-xs font-semibold text-text">
            <Calendar className="size-3.5 text-text-muted" />
            <span>Last 30 days</span>
          </div>
          <div className="grid size-10 place-items-center rounded-[10px] border border-border bg-surface text-text-muted">
            <Diamond className="size-3.5" />
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2.5">{actions}</div>}
      </div>
    </div>
  );
}

/** Empty states explain what to do next (gps-fleet-ui §3). */
export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <div className="mb-1 flex size-11 items-center justify-center rounded-xl bg-surface-2 text-text-faint">
        <Inbox className="size-5" aria-hidden />
      </div>
      <p className="text-sm font-bold tracking-tight text-text">{title}</p>
      <p className="max-w-md text-[13px] leading-relaxed text-text-muted">{description}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- Table (Clean borderless header, airy rows like 03_vehicles.png & 04_gps_devices.png)

export function Table({ className, ...rest }: HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="overflow-x-auto px-2">
      <table className={cn('w-full border-collapse text-[13px]', className)} {...rest} />
    </div>
  );
}
export const Th = ({ className, ...rest }: HTMLAttributes<HTMLTableCellElement>) => (
  <th
    scope="col"
    className={cn(
      'border-b border-border/90 px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-text-muted select-none',
      className,
    )}
    {...rest}
  />
);
export const Td = ({ className, ...rest }: HTMLAttributes<HTMLTableCellElement>) => (
  <td className={cn('h-14 border-b border-border/60 px-4 align-middle text-text transition-colors', className)} {...rest} />
);
