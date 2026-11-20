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

/** Motion #9: drawer spring 320ms + backdrop fade 120ms, fokus terperangkap. */
export function Drawer({ open, onOpenChange, side = 'left', width, title, children, className }: DrawerProps) {
  const resolvedWidth = width ?? (side === 'right' ? '420px' : '280px');
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-drawer bg-ink/25 transition-opacity duration-[var(--motion-fast)] data-[state=open]:opacity-100 data-[state=closed]:opacity-0" />
        <DialogPrimitive.Content
          className={cn(
            'fixed top-0 z-drawer flex max-w-full flex-col border-border-hairline bg-surface shadow-overlay transition-transform duration-[var(--motion-slow)] ease-[var(--ease-spring)] data-[state=open]:translate-x-0',
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
            <div className="measurement-rule flex h-14 items-center justify-between px-4">
              <span className="font-body text-headline-sm text-ink">{title}</span>
              <DialogPrimitive.Close asChild>
                <button
                  type="button"
                  className="flex h-11 w-11 min-h-11 min-w-11 items-center justify-center rounded-control text-ink-muted-strong transition-colors duration-[var(--motion-fast)] hover:bg-row-hover focus-ring"
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
