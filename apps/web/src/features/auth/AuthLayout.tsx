import type { ReactNode } from 'react';

/** Centered single-column frame for sign-in and recovery flows. */
export function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center px-4 py-10">
      <div className="mb-6 text-center">
        <p className="text-sm font-semibold tracking-wide text-text-muted">GPS Fleet Platform</p>
      </div>
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-6">
        <h1 className="text-xl font-semibold">{title}</h1>
        {subtitle && <p className="mt-1 text-[13px] text-text-muted">{subtitle}</p>}
        <div className="mt-5">{children}</div>
      </div>
      {footer && <div className="mt-4 text-[13px] text-text-muted">{footer}</div>}
    </div>
  );
}
