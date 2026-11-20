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
  /** Keluar 120ms setelah aksi/auto-dismiss (§3.2). */
  closing?: boolean;
}

export function Toast({ status, message, action, onAction, onClose, className, closing = false }: ToastProps) {
  return (
    <div
      role={status === 'error' ? 'alert' : 'status'}
      className={cn(
        'fixed right-4 bottom-4 z-toast flex items-center gap-2 rounded-md bg-inverse-surface px-4 py-2 text-inverse-on-surface shadow-lg',
        // Purpose Gate: masuk 180ms / keluar 120ms sebagai umpan balik aksi (§3.2).
        closing ? 'animate-[toast-out_120ms_ease-in_both]' : 'animate-[toast-in_180ms_var(--ease-out-quart)_both]',
        className,
      )}
    >
      {/* A-11: ikon status terang di atas latar gelap; bentuk glyph membedakan status, bukan warna saja. */}
      {status === 'success' && <IconCheckCircle className="h-4 w-4 shrink-0 text-secondary-container" aria-hidden="true" />}
      {status === 'error' && <IconAlertTriangle className="h-4 w-4 shrink-0 text-error-container" aria-hidden="true" />}
      {status === 'info' && <IconInfo className="h-4 w-4 shrink-0 text-inverse-on-surface" aria-hidden="true" />}
      <span className="font-body text-label-md">{message}</span>
      {action && onAction && (
        <button type="button" onClick={onAction} className="font-body text-label-md font-semibold text-inverse-on-surface underline focus-ring">
          {action}
        </button>
      )}
      <button
        type="button"
        onClick={onClose}
        className="ml-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-inverse-on-surface transition-colors duration-[var(--motion-fast)] hover:bg-surface-container-lowest/10 focus-ring"
        aria-label="Tutup toast"
      >
        <IconX className="h-4 w-4" />
      </button>
    </div>
  );
}
