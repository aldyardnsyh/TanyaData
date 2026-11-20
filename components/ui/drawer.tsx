'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { IconX } from './icons';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export interface DrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  side?: 'left' | 'right';
  width?: string;
  title?: string;
  children: React.ReactNode;
  className?: string;
}

export function Drawer({ open, onOpenChange, side = 'left', width, title, children, className }: DrawerProps) {
  // C-35: prop width dihormati kedua sisi; default kiri 280, kanan 420 (§4.12).
  const resolvedWidth = width ?? (side === 'right' ? '420px' : '280px');
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-drawer bg-inverse-surface/32 transition-opacity duration-[var(--motion-slow)] data-[state=open]:opacity-100 data-[state=closed]:opacity-0" />
        <DialogPrimitive.Content
          className={cn(
            'fixed top-0 z-drawer flex max-w-full flex-col bg-surface-container-lowest border-outline-variant shadow-lg transition-transform duration-[var(--motion-slow)] data-[state=open]:translate-x-0',
            side === 'left'
              ? 'left-0 h-full border-r data-[state=closed]:-translate-x-full'
              : 'right-0 h-full border-l data-[state=closed]:translate-x-full',
            className,
          )}
          style={{ width: resolvedWidth }}
          onEscapeKeyDown={() => onOpenChange(false)}
          onPointerDownOutside={() => onOpenChange(false)}
        >
          {title && (
            <div className="flex h-14 items-center justify-between border-b border-outline-variant px-4">
              <span className="font-display text-headline-sm font-semibold text-on-surface">{title}</span>
              <DialogPrimitive.Close asChild>
                <button
                  type="button"
                  className="flex h-11 w-11 items-center justify-center rounded-md text-on-surface-variant transition-colors duration-[var(--motion-fast)] hover:bg-surface-container focus-ring"
                  aria-label="Close"
                >
                  <IconX className="h-5 w-5" />
                </button>
              </DialogPrimitive.Close>
            </div>
          )}
          <div className="flex-1 overflow-y-auto p-4">{children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
