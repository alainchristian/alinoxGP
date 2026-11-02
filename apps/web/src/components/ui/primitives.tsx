import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------- Button

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
const buttonStyles: Record<ButtonVariant, string> = {
  primary: 'bg-brand text-brand-text hover:bg-brand-hover border-transparent',
  secondary: 'bg-surface text-text border-border-strong hover:bg-surface-2',
  ghost: 'bg-transparent text-text-muted border-transparent hover:bg-surface-2 hover:text-text',
  danger: 'bg-danger text-white border-transparent hover:opacity-90',
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
        'inline-flex items-center justify-center gap-2 rounded-md border font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-55',
        size === 'sm' ? 'h-8 px-3 text-[13px]' : 'h-9 px-4 text-sm',
        buttonStyles[variant],
        className,
      )}
      {...rest}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
});

// ---------------------------------------------------------------- Form controls

const controlStyles =
  'w-full rounded-md border bg-surface px-3 text-sm text-text placeholder:text-text-faint disabled:bg-surface-2 disabled:text-text-muted';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(function Input(
  { className, invalid, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(controlStyles, 'h-9', invalid ? 'border-danger' : 'border-border-strong', className)}
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
      className={cn(controlStyles, 'h-9 pr-8', invalid ? 'border-danger' : 'border-border-strong', className)}
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
      <label htmlFor={htmlFor} className="block text-[13px] font-medium text-text">
        {label}
      </label>
      {children}
      {hint && !error && (
        <p id={`${htmlFor}-hint`} className="text-xs text-text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${htmlFor}-error`} role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Surfaces

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-lg border border-border bg-surface', className)} {...rest} />;
}

export function CardHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-3.5">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        {description && <p className="mt-0.5 text-[13px] text-text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

type Tone = 'neutral' | 'brand' | 'ok' | 'warn' | 'danger';
const toneStyles: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-text-muted',
  brand: 'bg-brand-soft text-brand',
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  danger: 'bg-danger-soft text-danger',
};

/** Text badge. (Vehicle status colours are reserved for status components added with live tracking.) */
export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={cn('inline-flex items-center rounded-sm px-2 py-0.5 text-xs font-medium', toneStyles[tone])}>{children}</span>;
}

export function Alert({ tone = 'danger', children }: { tone?: 'danger' | 'ok' | 'warn' | 'neutral'; children: ReactNode }) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn('rounded-md border px-3 py-2 text-[13px]', {
        'border-danger/30 bg-danger-soft text-danger': tone === 'danger',
        'border-ok/30 bg-ok-soft text-ok': tone === 'ok',
        'border-warn/30 bg-warn-soft text-warn': tone === 'warn',
        'border-border bg-surface-2 text-text-muted': tone === 'neutral',
      })}
    >
      {children}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('animate-pulse rounded-md bg-surface-2', className)} />;
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-[13px] text-text-muted">{description}</p>}
      </div>
      {actions}
    </div>
  );
}

/** Empty states explain what to do next (gps-fleet-ui §3). */
export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      <p className="text-sm font-medium">{title}</p>
      <p className="max-w-md text-[13px] text-text-muted">{description}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- Table

export function Table({ className, ...rest }: HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="overflow-x-auto">
      <table className={cn('w-full border-collapse text-[13px]', className)} {...rest} />
    </div>
  );
}
export const Th = ({ className, ...rest }: HTMLAttributes<HTMLTableCellElement>) => (
  <th scope="col" className={cn('border-b border-border bg-surface-2 px-4 py-2 text-left text-xs font-semibold text-text-muted', className)} {...rest} />
);
export const Td = ({ className, ...rest }: HTMLAttributes<HTMLTableCellElement>) => (
  <td className={cn('h-10 border-b border-border px-4 align-middle', className)} {...rest} />
);
