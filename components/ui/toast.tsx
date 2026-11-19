'use client';

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { CheckCircle, AlertTriangle, X } from 'lucide-react';

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
}

export function Toast({ status, message, action, onAction, onClose, className }: ToastProps) {
  return (
    <div
      role={status === 'error' ? 'alert' : 'status'}
      className={cn(
        'fixed right-4 bottom-4 z-toast flex items-center gap-2 rounded-md bg-inverse-surface px-4 py-2 text-inverse-on-surface shadow-lg transition-all duration-[var(--motion-base)]',
        className,
      )}
    >
      {status === 'success' && <CheckCircle className="h-4 w-4 text-secondary" />}
      {status === 'error' && <AlertTriangle className="h-4 w-4 text-error" />}
      {status === 'info' && <CheckCircle className="h-4 w-4 text-primary" />}
      <span className="font-body text-label-md">{message}</span>
      {action && onAction && (
        <button type="button" onClick={onAction} className="font-body text-label-md font-semibold text-primary underline">
          {action}
        </button>
      )}
      <button type="button" onClick={onClose} className="ml-2 text-on-surface-variant hover:text-on-surface" aria-label="Tutup toast">
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
