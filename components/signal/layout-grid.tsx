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
  /** xl: 8 kolom (dipasangkan 8+4 atau 4+4+4 agar baris penuh untuk jumlah kartu ganjil). */
  wide?: boolean;
  /** Label penanda pada kartu yang sedang menjadi pilihan utama (primary). */
  selectedLabel?: string;
}

export interface LayoutGridProps extends StateCopy {
  cards: RevealCard[];
  state?: ComponentState;
  className?: string;
  /**
   * Seleksi terkontrol. Bila disediakan, kartu mengikuti nilai ini dan
   * `onSelect` dipanggil saat header kartu diklik. Bila tidak disediakan,
   * komponen memakai state `expanded` internal seperti sebelumnya.
   */
  selectedId?: string | null;
  onSelect?: (id: string) => void;
}

export function LayoutGrid({
  cards,
  state = 'default',
  emptyTitle = 'Belum ada sumber data.',
  emptyAction,
  errorTitle = 'Pratinjau gagal.',
  onRetry,
  selectedId,
  onSelect,
  className = '',
}: LayoutGridProps) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const panelId = useId();
  const controlled = selectedId !== undefined;

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
        const selected = controlled && selectedId === card.id;
        const open = controlled ? selected : expanded === card.id || state === 'active';
        const handleSelect = () => {
          if (controlled) onSelect?.(card.id);
          else setExpanded(open ? null : card.id);
        };
        return (
          <div
            key={card.id}
            data-selected={selected || undefined}
            className={`col-span-4 p-s3 transition-[border-color,box-shadow,transform] duration-[var(--motion-expand)] hover:-translate-y-0.5 hover:border-forest hover:shadow-lift md:col-span-4 motion-reduce:transform-none ${card.wide ? 'xl:col-span-8' : 'xl:col-span-3'} ${selected ? 'rounded-surface border border-forest bg-forest-08 shadow-lift' : 'surface'}`}
          >
            <button
              type="button"
              onClick={handleSelect}
              aria-expanded={open}
              aria-pressed={controlled ? selected : undefined}
              aria-controls={`${panelId}-${card.id}`}
              className="flex min-h-11 w-full flex-col items-start gap-s1 text-left focus-ring"
            >
              <span className="flex w-full items-center justify-between gap-s2">
                <span className="min-w-0 truncate font-display text-label font-semibold text-ink">
                  <span className="sr-only">Pilih sumber </span>{card.title}
                </span>
                {selected && (
                  <span className="mono-meta inline-flex shrink-0 items-center gap-s1 text-forest">
                    <span className="state-dot state-dot-active" aria-hidden="true" />
                    {card.selectedLabel ?? 'Dipilih'}
                  </span>
                )}
              </span>
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
