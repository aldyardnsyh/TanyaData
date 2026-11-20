'use client';

import { useRef, type PointerEvent } from 'react';
import type { ComponentState, StateCopy } from '@/lib/ui/component-state';
import { DEFAULT_STATE_COPY } from '@/lib/ui/component-state';
import { shouldAnimate } from '@/lib/motion-tokens';

/**
 * Magnetic Button — aksi sekunder dengan umpan balik fisik saat pointer dekat.
 * Purpose Gate: efek magnet menandakan satu aksi yang layak perhatian tanpa
 * memakai glow. Dilarang dipasang pada semua tombol; satu per layar maksimal.
 * Motion: transform saja (bukan width/height), dimatikan saat reduced-motion.
 *
 * 8 state: hover/focus/active diwakili posisi magnet + :active; loading/empty/
 * error/success mengikuti kontrak state bersama.
 */
export interface MagneticButtonProps extends StateCopy {
  children: React.ReactNode;
  state?: ComponentState;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}

const MAGNET_STRENGTH = 0.18;

export function MagneticButton({
  children,
  state = 'default',
  onClick,
  disabled = false,
  loadingLabel = DEFAULT_STATE_COPY.loadingLabel,
  successLabel = DEFAULT_STATE_COPY.successLabel,
  errorTitle = DEFAULT_STATE_COPY.errorTitle,
  onRetry,
  className = '',
}: MagneticButtonProps) {
  const ref = useRef<HTMLButtonElement>(null);

  const move = (event: PointerEvent<HTMLButtonElement>) => {
    if (!shouldAnimate() || disabled) return;
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const dx = event.clientX - (rect.left + rect.width / 2);
    const dy = event.clientY - (rect.top + rect.height / 2);
    el.style.transform = `translate(${dx * MAGNET_STRENGTH}px, ${dy * MAGNET_STRENGTH}px)`;
  };

  const reset = () => {
    if (ref.current) ref.current.style.transform = '';
  };

  if (state === 'empty') return null; // n/a: tombol selalu punya target.

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

  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      data-state={state}
      data-motion
      onPointerMove={move}
      onPointerLeave={reset}
      onBlur={reset}
      className={`touch-44 inline-flex items-center justify-center gap-s2 rounded-control border border-forest bg-porcelain px-s4 font-display text-label font-semibold text-forest transition-transform duration-[var(--motion-normal)] disabled:opacity-60 focus-ring ${className}`}
    >
      {loading && <span className="skeleton h-s2 w-s2" aria-hidden="true" />}
      <span>{loading ? loadingLabel : state === 'success' ? successLabel : children}</span>
    </button>
  );
}
