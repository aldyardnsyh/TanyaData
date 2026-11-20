'use client';

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { IconCheckCircle, IconAlertTriangle, IconInfo, IconX } from './icons';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export type ToastStatus = 'success' | 'error' | 'info';

export interface ToastProps {
  status: ToastStatus;
  message: string;
  action?: string;
  onAction?: () => void;
  onClose: () => void;
  className?: string;
  closing?: boolean;
}

/** Motion #8: toast slide-in spring 320ms. Surface + hairline + E1, bukan blok gelap. */
export function Toast({ status, message, action, onAction, onClose, className, closing = false }: ToastProps) {
  return (
    <div
      role={status === 'error' ? 'alert' : 'status'}
      className={cn(
        'flex items-center gap-3 rounded-card border border-border-hairline bg-surface px-4 py-3 text-ink shadow-overlay',
        closing ? 'animate-crossfade' : 'animate-toast-in',
        className,
      )}
    >
      <span
        className={cn(
          'state-dot',
          status === 'success' && 'state-dot-active',
          status === 'error' && 'state-dot-error',
          status === 'info' && 'state-dot',
        )}
        aria-hidden="true"
      />
      {status === 'success' && <IconCheckCircle className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />}
      {status === 'error' && <IconAlertTriangle className="h-4 w-4 shrink-0 text-error-text" aria-hidden="true" />}
      {status === 'info' && <IconInfo className="h-4 w-4 shrink-0 text-ink-muted-strong" aria-hidden="true" />}
      <span className="font-body text-body-md">{message}</span>
      {action && onAction && (
        <button type="button" onClick={onAction} className="min-h-11 font-body text-label-md font-semibold text-primary underline focus-ring">
          {action}
        </button>
      )}
      <button
        type="button"
        onClick={onClose}
        className="ml-2 flex h-11 w-11 min-h-11 min-w-11 shrink-0 items-center justify-center rounded-control text-ink-muted-strong transition-colors duration-[var(--motion-fast)] hover:bg-row-hover focus-ring"
        aria-label="Dismiss notification"
      >
        <IconX className="h-4 w-4" />
      </button>
    </div>
  );
}
