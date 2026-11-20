'use client';

import { useId, useState } from 'react';
import type { ComponentState, StateCopy } from '@/lib/ui/component-state';
import { DEFAULT_STATE_COPY } from '@/lib/ui/component-state';

/**
 * C-11 Reveal Grid (dari Layout Grid).
 * Purpose Gate: mengungkap detail tanpa kehilangan konteks daftar. Layout
 * animation dipakai hanya pada SATU kartu, bukan seluruh grid.
 * Motion: 220ms transform skala konten, bukan animasi width/height (M8).
 */
export interface RevealCard {
  id: string;
  title: string;
  meta?: string;
  preview: React.ReactNode;
  detail: React.ReactNode;
}

export interface LayoutGridProps extends StateCopy {
  cards: RevealCard[];
  state?: ComponentState;
  className?: string;
}

export function LayoutGrid({
  cards,
  state = 'default',
  emptyTitle = 'Belum ada sumber data.',
  emptyAction,
  errorTitle = 'Pratinjau gagal.',
  onRetry,
  className = '',
}: LayoutGridProps) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const panelId = useId();

  if (state === 'loading') {
    return (
      <div className={`grid-dashboard ${className}`} aria-busy="true">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="surface col-span-4 flex flex-col gap-s2 p-s3 md:col-span-4 xl:col-span-3" aria-hidden="true">
            <div className="skeleton h-s2 w-2/3" />
            <div className="skeleton h-s5 w-full" />
          </div>
        ))}
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

  return (
    <div className={`grid-dashboard ${className}`} data-state={state}>
      {cards.map((card) => {
        const open = expanded === card.id || state === 'active';
        return (
          <div key={card.id} className="surface col-span-4 p-s3 transition-colors duration-[var(--motion-fast)] hover:border-forest md:col-span-4 xl:col-span-3">
            <button
              type="button"
              onClick={() => setExpanded(open ? null : card.id)}
              aria-expanded={open}
              aria-controls={`${panelId}-${card.id}`}
              className="flex min-h-11 w-full flex-col items-start gap-s1 text-left focus-ring"
            >
              <span className="font-display text-label font-semibold text-ink">{card.title}</span>
              {card.meta && <span className="mono-meta">{card.meta}</span>}
            </button>
            <div id={`${panelId}-${card.id}`} hidden={!open} data-motion className="animate-grid-expand pt-s2">
              {open ? card.detail : card.preview}
            </div>
          </div>
        );
      })}
    </div>
  );
}
