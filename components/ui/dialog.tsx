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

export function Dialog({ open, onOpenChange, title, description, children, className }: DialogProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-modal bg-inverse-surface/32 transition-opacity duration-[var(--motion-slow)] data-[state=open]:opacity-100 data-[state=closed]:opacity-0" />
        <DialogPrimitive.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-modal w-full max-w-[480px] -translate-x-1/2 -translate-y-1/2 rounded-lg bg-surface-container-lowest border border-outline-variant p-6 shadow-lg transition-all duration-[var(--motion-slow)] data-[state=open]:translate-y-0 data-[state=closed]:translate-y-4 data-[state=open]:opacity-100 data-[state=closed]:opacity-0',
            className,
          )}
          onEscapeKeyDown={() => onOpenChange(false)}
          onPointerDownOutside={() => onOpenChange(false)}
        >
          <DialogPrimitive.Title className="font-display text-headline-sm font-semibold text-on-surface">
            {title}
          </DialogPrimitive.Title>
          {description && (
            <DialogPrimitive.Description className="font-body text-body-sm text-on-surface-variant mt-1">
              {description}
            </DialogPrimitive.Description>
          )}
          <div className="mt-4 space-y-3">{children}</div>
          <DialogPrimitive.Close asChild>
            <button
              type="button"
              className="absolute right-2 top-2 flex h-11 w-11 items-center justify-center rounded-md text-on-surface-variant transition-colors duration-[var(--motion-fast)] hover:bg-surface-container focus-ring"
              aria-label="Tutup"
            >
              <IconX className="h-5 w-5" />
            </button>
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
