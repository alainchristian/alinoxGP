import * as RadixDialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';

/** Accessible modal (focus trap, Esc to close). Use for short confirmations; workflows needing context use pages/panels. */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  size = 'md',
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  /** `lg` is for forms with many fields; it scrolls inside the viewport on small screens. */
  size?: 'md' | 'lg';
  children: ReactNode;
}) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-slate-900/40" />
        <RadixDialog.Content
          className={`fixed left-1/2 top-1/2 z-50 max-h-[calc(100dvh-32px)] w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-border bg-surface p-5 shadow-lg ${size === 'lg' ? 'max-w-2xl' : 'max-w-md'}`}
        >
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <RadixDialog.Title className="text-base font-semibold">{title}</RadixDialog.Title>
              <RadixDialog.Description className={description ? 'mt-1 text-[13px] text-text-muted' : 'sr-only'}>
                {description ?? title}
              </RadixDialog.Description>
            </div>
            <RadixDialog.Close aria-label="Close" className="rounded-md p-1 text-text-muted hover:bg-surface-2">
              <X className="size-4" aria-hidden />
            </RadixDialog.Close>
          </div>
          {children}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
