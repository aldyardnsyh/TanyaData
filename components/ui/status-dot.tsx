'use client';

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export type DotState = 'neutral' | 'active' | 'error' | 'empty' | 'loading';

export interface StatusDotProps {
  state?: DotState;
  label: string;
  /** Wrapper interaktif: dot + label menjadi tombol dengan focus ring. */
  onClick?: () => void;
  /** Label berisi metadata teknis (SQL/FTS5/kode) → pakai font-mono. */
  mono?: boolean;
  className?: string;
}

const dotClass: Record<DotState, string> = {
  neutral: 'state-dot',
  active: 'state-dot state-dot-active',
  error: 'state-dot state-dot-error',
  empty: 'state-dot state-dot-empty',
  loading: 'state-dot animate-skeleton',
};

const labelClass: Record<DotState, string> = {
  neutral: 'text-ink-muted-strong',
  active: 'text-ink',
  error: 'text-error-text',
  empty: 'text-ink-muted-strong',
  loading: 'text-ink-muted-strong',
};

/**
 * Signature 3.4: dot 6px + label teks wajib. Tanpa ping permanen (V-05).
 * Loading pulse hanya saat proses nyata dan berhenti saat tab tersembunyi
 * lewat aturan global `visibilitychange` di motion-tokens.
 */
export function StatusDot({ state = 'neutral', label, onClick, mono = false, className }: StatusDotProps) {
  const content = (
    <>
      <span className={dotClass[state]} aria-hidden="true" />
      <span className={cn(mono ? 'font-mono' : 'font-body', 'text-body-sm transition-colors duration-[var(--motion-fast)]', labelClass[state])}>
        {label}
      </span>
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'inline-flex min-h-11 items-center gap-2 rounded-control px-2 text-left transition-colors duration-[var(--motion-fast)] hover:bg-row-hover focus-ring',
          className,
        )}
      >
        {content}
      </button>
    );
  }

  return <span className={cn('inline-flex items-center gap-2', className)}>{content}</span>;
}
