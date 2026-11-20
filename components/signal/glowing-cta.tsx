'use client';

import { useEffect, useState } from 'react';
import type { ComponentState, StateCopy } from '@/lib/ui/component-state';
import { DEFAULT_STATE_COPY } from '@/lib/ui/component-state';

/**
 * C-03 Attention Border (dari Glowing Effect / Moving Border) — GlowingCTA.
 * Purpose Gate: sweep mengarahkan ke SATU aksi primer per layar. Tidak dipasang
 * pada tombol sekunder, kartu, atau badge (P2).
 * Motion: sweep 240ms linear, dihentikan saat tab tersembunyi (M4).
 */
export interface GlowingCTAProps extends StateCopy {
  children: React.ReactNode;
  state?: ComponentState;
  onClick?: () => void;
  disabled?: boolean;
  type?: 'button' | 'submit';
  className?: string;
}

export function GlowingCTA({
  children,
  state = 'default',
  onClick,
  disabled = false,
  type = 'button',
  loadingLabel = DEFAULT_STATE_COPY.loadingLabel,
  successLabel = DEFAULT_STATE_COPY.successLabel,
  errorTitle = DEFAULT_STATE_COPY.errorTitle,
  onRetry,
  className = '',
}: GlowingCTAProps) {
  const [showSuccess, setShowSuccess] = useState(false);

  // Success label tampil 1,2s lalu kembali (C-03). Timer dibersihkan saat unmount.
  useEffect(() => {
    if (state !== 'success') return;
    setShowSuccess(true);
    const timer = window.setTimeout(() => setShowSuccess(false), 1200);
    return () => window.clearTimeout(timer);
  }, [state]);

  if (state === 'empty') return null; // n/a: CTA selalu punya target (P2).

  if (state === 'error') {
    return (
      <div className={`flex flex-col items-start gap-s2 ${className}`} role="alert">
        <span className="inline-flex items-center gap-s2">
          <span className="state-dot state-dot-error" aria-hidden="true" />
          <span className="font-body text-body text-ink">{errorTitle}</span>
        </span>
        {onRetry && (
          <button type="button" onClick={onRetry} className="touch-44 rounded-control border border-forest px-s3 font-display text-label font-semibold text-forest focus-ring">
            Coba lagi
          </button>
        )}
      </div>
    );
  }

  const loading = state === 'loading';
  const label = loading ? loadingLabel : showSuccess ? successLabel : children;

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      data-state={state}
      data-motion
      className={`attention-border touch-44 inline-flex items-center justify-center gap-s2 bg-forest px-s4 font-display text-label font-semibold text-porcelain transition-transform duration-[var(--motion-fast)] active:scale-[var(--scale-press)] disabled:opacity-60 focus-ring ${className}`}
    >
      {loading && <span className="skeleton h-s2 w-s2" aria-hidden="true" />}
      <span>{label}</span>
    </button>
  );
}
