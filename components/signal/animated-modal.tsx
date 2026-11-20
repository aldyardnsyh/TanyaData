'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';
import type { ComponentState, StateCopy } from '@/lib/ui/component-state';
import { DEFAULT_STATE_COPY } from '@/lib/ui/component-state';
import { GlowingCTA } from './glowing-cta';

/**
 * C-09 Confirm Modal (dari Animated Modal).
 * Purpose Gate: mencegah data terekspos sebelum persetujuan. Konfirmasi adalah
 * syarat FR-E.3. Fokus terperangkap, Escape menutup, fokus kembali ke pemicu.
 * Motion: masuk 240ms spring + backdrop 120ms fade (M9).
 */
export interface AnimatedModalProps extends StateCopy {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm?: () => void;
  state?: ComponentState;
}

export function AnimatedModal({
  open,
  onClose,
  title,
  children,
  confirmLabel = 'Buat tautan',
  cancelLabel = 'Batal',
  onConfirm,
  state = 'default',
  loadingLabel,
  errorTitle,
  onRetry,
}: AnimatedModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    triggerRef.current = document.activeElement as HTMLElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const panel = panelRef.current;
    const focusables = () =>
      Array.from(
        panel?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
    focusables()[0]?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      triggerRef.current?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-modal flex items-center justify-center p-s3">
      <div
        className="animate-backdrop-in absolute inset-0 bg-ink/40"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-state={state}
        className="animate-modal-in elevated relative w-full max-w-[520px] rounded-overlay border border-[var(--border-hairline)] bg-porcelain p-s4"
      >
        <h2 id={titleId} className="font-display text-title font-semibold text-ink">{title}</h2>
        <div className="mt-s3 font-body text-body text-ink-72">{children}</div>

        {state === 'error' && (
          <p className="mt-s3 inline-flex items-center gap-s2" role="alert">
            <span className="state-dot state-dot-error" aria-hidden="true" />
            <span className="font-body text-body text-ink">{errorTitle ?? DEFAULT_STATE_COPY.errorTitle}</span>
          </p>
        )}

        <div className="mt-s4 flex flex-wrap justify-end gap-s2">
          <button
            type="button"
            onClick={onClose}
            className="touch-44 rounded-control border border-[var(--border-hairline)] px-s3 font-display text-label font-semibold text-ink focus-ring"
          >
            {cancelLabel}
          </button>
          <GlowingCTA
            state={state === 'loading' || state === 'error' ? state : 'default'}
            onClick={onConfirm}
            loadingLabel={loadingLabel}
            errorTitle={errorTitle}
            onRetry={onRetry}
          >
            {confirmLabel}
          </GlowingCTA>
        </div>
      </div>
    </div>
  );
}
