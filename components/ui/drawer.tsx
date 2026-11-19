'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { X } from 'lucide-react';

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

export function Drawer({ open, onOpenChange, side = 'left', width = '280px', title, children, className }: DrawerProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-drawer bg-inverse-surface/32 transition-opacity duration-[var(--motion-slow)] data-[state=open]:opacity-100 data-[state=closed]:opacity-0" />
        <DialogPrimitive.Content
          className={cn(
            'fixed top-0 z-drawer flex flex-col bg-surface-container-lowest border-outline-variant shadow-lg transition-transform duration-[var(--motion-slow)] data-[state=open]:translate-x-0 data-[state=closed]:translate-x-full',
            side === 'left' ? 'left-0 h-full border-r' : 'right-0 h-full border-l',
            className,
          )}
          style={{ width: side === 'left' ? width : '420px' }}
          onEscapeKeyDown={() => onOpenChange(false)}
          onPointerDownOutside={() => onOpenChange(false)}
        >
          {title && (
            <div className="flex h-14 items-center justify-between border-b border-outline-variant px-4">
              <span className="font-display text-headline-sm font-semibold text-on-surface">{title}</span>
              <DialogPrimitive.Close asChild>
                <button
                  type="button"
                  className="rounded-md p-1 text-on-surface-variant transition-colors duration-[var(--motion-fast)] hover:bg-surface-container focus-ring"
                  aria-label="Tutup"
                >
                  <X className="h-4 w-4" />
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
