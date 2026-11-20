'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { IconX } from './icons';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}

/** Motion #9: spring 320ms + backdrop fade 120ms. Radix: focus trap + Escape. */
export function Dialog({ open, onOpenChange, title, description, children, className }: DialogProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-modal bg-ink/25 transition-opacity duration-[var(--motion-fast)] data-[state=open]:opacity-100 data-[state=closed]:opacity-0" />
        <DialogPrimitive.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-modal w-full max-w-[480px] -translate-x-1/2 -translate-y-1/2 rounded-overlay border border-border-hairline bg-surface p-6 shadow-overlay transition-[transform,opacity] duration-[var(--motion-slow)] ease-[var(--ease-spring)] data-[state=open]:opacity-100 data-[state=closed]:opacity-0 data-[state=closed]:scale-95',
            className,
          )}
          onEscapeKeyDown={() => onOpenChange(false)}
          onPointerDownOutside={() => onOpenChange(false)}
        >
          {title && (
            <DialogPrimitive.Title className="font-body text-headline-sm text-ink">
              {title}
            </DialogPrimitive.Title>
          )}
          {description && (
            <DialogPrimitive.Description className="mt-1 font-body text-body-sm text-ink-muted-strong">
              {description}
            </DialogPrimitive.Description>
          )}
          <div className="mt-4 space-y-3">{children}</div>
          <DialogPrimitive.Close asChild>
            <button
              type="button"
              className="absolute right-2 top-2 flex h-11 w-11 min-h-11 min-w-11 items-center justify-center rounded-control text-ink-muted-strong transition-colors duration-[var(--motion-fast)] hover:bg-row-hover focus-ring"
              aria-label="Close"
            >
              <IconX className="h-5 w-5" />
            </button>
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
