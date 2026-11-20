'use client';

import { useRef, type PointerEvent } from 'react';
import type { ComponentState, StateCopy } from '@/lib/ui/component-state';
import { DEFAULT_STATE_COPY } from '@/lib/ui/component-state';

/**
 * C-02 Focus Spotlight Card (dari Card Spotlight).
 * Purpose Gate: halo radial menandakan kartu bisa diklik untuk detail. Bukan
 * glow dekoratif; satu kartu aktif maksimal. Halo tidak pernah keluar kartu.
 * Motion: 120ms opacity, mengikuti pointer tanpa delay tambahan (M3).
 */
export interface SpotlightCardProps extends StateCopy {
  children: React.ReactNode;
  state?: ComponentState;
  active?: boolean;
  onClick?: () => void;
  label?: string;
  className?: string;
}

export function SpotlightCard({
  children,
  state = 'default',
  active = false,
  onClick,
  label,
  emptyTitle = DEFAULT_STATE_COPY.emptyTitle,
  emptyAction,
  errorTitle = DEFAULT_STATE_COPY.errorTitle,
  onRetry,
  className = '',
}: SpotlightCardProps) {
  const hostRef = useRef<HTMLDivElement>(null);

  // Halo mengikuti pointer HANYA di dalam kartu yang di-hover.
  const moveHalo = (event: PointerEvent<HTMLDivElement>) => {
    const host = hostRef.current;
    if (!host) return;
    const rect = host.getBoundingClientRect();
    host.style.setProperty('--spot-x', `${event.clientX - rect.left}px`);
    host.style.setProperty('--spot-y', `${event.clientY - rect.top}px`);
    host.style.setProperty('--spot-opacity', '1');
  };
  const hideHalo = () => hostRef.current?.style.setProperty('--spot-opacity', '0');

  if (state === 'loading') {
    return (
      <div className={`surface spotlight-host p-s4 ${className}`} aria-busy="true">
        <div className="skeleton h-s2 w-2/3" />
        <div className="skeleton mt-s4 h-s5 w-1/2" />
      </div>
    );
  }

  if (state === 'empty') {
    return (
      <div className={`surface flex flex-col items-start gap-s3 p-s4 ${className}`}>
        <span className="state-dot state-dot-empty" aria-hidden="true" />
        <p className="font-body text-body text-ink">{emptyTitle}</p>
        {emptyAction && (
          <button type="button" onClick={emptyAction.onClick} className="touch-44 rounded-control border border-forest px-s3 font-display text-label font-semibold text-forest focus-ring">
            {emptyAction.label}
          </button>
        )}
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className={`surface flex flex-col items-start gap-s3 p-s4 ${className}`} role="alert">
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

  const interactive = typeof onClick === 'function';

  return (
    <div
      ref={hostRef}
      data-state={state}
      onPointerMove={interactive ? moveHalo : undefined}
      onPointerLeave={interactive ? hideHalo : undefined}
      onFocus={interactive ? () => hostRef.current?.style.setProperty('--spot-opacity', '1') : undefined}
      onBlur={interactive ? hideHalo : undefined}
      className={`surface spotlight-host transition-colors duration-[var(--motion-fast)] hover:border-forest focus-within:border-forest ${className}`}
    >
      <span className="spotlight-halo" aria-hidden="true" />
      {interactive ? (
        <button
          type="button"
          onClick={onClick}
          aria-label={label}
          className="relative z-10 flex h-full w-full flex-col items-start gap-s2 p-s4 text-left focus-ring"
        >
          {active && <span className="state-dot state-dot-active" aria-label="Aktif" role="img" />}
          {children}
        </button>
      ) : (
        <div className="relative z-10 flex flex-col gap-s2 p-s4">
          {active && <span className="state-dot state-dot-active" aria-label="Aktif" role="img" />}
          {children}
        </div>
      )}
    </div>
  );
}
