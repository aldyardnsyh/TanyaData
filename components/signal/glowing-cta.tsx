'use client';

import { useEffect, useState } from 'react';
import type { ComponentState, StateCopy } from '@/lib/ui/component-state';
import { DEFAULT_STATE_COPY } from '@/lib/ui/component-state';

/**
 * C-03 Attention Border (dari Glowing Effect / Moving Border), bernama GlowingCTA.
 * Purpose Gate: sweep mengarahkan ke SATU aksi primer per layar. Tidak dipasang
 * pada tombol sekunder, kartu, atau badge (P2).
 * Motion: sweep 240ms linear, dihentikan saat tab tersembunyi (M4).
 *
 * tone 'light': forest bg + porcelain text, untuk permukaan porcelain (default,
 * dipakai modul kerja). tone 'dark': lime bg + ink text + glow lime saat hover,
 * untuk band gelap forest di landing: lime di atas forest ~6,8:1 dan ink di
 * atas lime ~10,5:1, keduanya lolos kontras.
 */
export interface GlowingCTAProps extends StateCopy {
  children: React.ReactNode;
  state?: ComponentState;
  tone?: 'light' | 'dark';
  onClick?: () => void;
  disabled?: boolean;
  type?: 'button' | 'submit';
  className?: string;
}

export function GlowingCTA({
  children,
  state = 'default',
  tone = 'light',
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
  const skin =
    tone === 'dark'
      ? 'attention-border-dark bg-lime px-s5 text-ink hover:shadow-[0_0_44px_color-mix(in_srgb,var(--color-lime)_30%,transparent)] focus-ring-forest'
      : 'attention-border bg-forest px-s4 text-porcelain focus-ring';

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      data-state={state}
      data-motion
      className={`${skin} touch-44 inline-flex items-center justify-center gap-s2 font-display text-label font-semibold transition-[box-shadow,transform] duration-[var(--motion-expand)] active:scale-[var(--scale-press)] disabled:opacity-60 ${className}`}
    >
      {loading && <span className="skeleton h-s2 w-s2" aria-hidden="true" />}
      <span>{label}</span>
    </button>
  );
}
