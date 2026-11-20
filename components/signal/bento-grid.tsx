'use client';

import type { ComponentState, StateCopy } from '@/lib/ui/component-state';
import { DEFAULT_STATE_COPY } from '@/lib/ui/component-state';
import { IconTooltip } from '@/components/ui/icon-tooltip';

/**
 * C-01 Signal Bento (dari Bento Grid).
 * Purpose Gate: bento dipakai karena isinya memang berbeda bobot, satu metrik
 * utama span 6 dan empat pendukung span 3. Bukan tren visual.
 * Motion: masuk 160ms opacity only, tanpa stagger per kartu (M1 dari §6).
 */
export interface BentoItem {
  id: string;
  label: string;
  /** Sudah diformat dari result_json. Komponen tidak menghitung angka. */
  value: string;
  source?: string;
  /** C-12: tooltip menjelaskan sumber angka. Hanya muncul saat hover/fokus, tidak pernah terlihat saat halaman dibuka (§6 aturan 6). */
  tooltip?: string;
  /** hero = 6 kolom, support = 3, wide = 6 (melengkapi baris agar grid penuh). */
  span?: 'hero' | 'support' | 'wide';
  active?: boolean;
}

export interface BentoGridProps extends StateCopy {
  items: BentoItem[];
  state?: ComponentState;
  className?: string;
}

function Cell({ item, state }: { item: BentoItem; state: ComponentState }) {
  const interactive = state === 'hover' || state === 'focus' || state === 'active';
  return (
    <div
      data-cell
      data-span={item.span ?? 'support'}
      data-state={state}
      tabIndex={interactive ? 0 : undefined}
      className="surface flex flex-col justify-between gap-s2 p-s3 transition-[border-color,box-shadow,transform] duration-[var(--motion-expand)] hover:-translate-y-0.5 hover:border-forest hover:shadow-lift focus-ring motion-reduce:transform-none"
    >
      <div className="flex items-start justify-between gap-s2">
        <span className="font-display text-label font-semibold text-ink">{item.label}</span>
        {item.active && <span className="state-dot state-dot-active" aria-label="Aktif" role="img" />}
      </div>
      <div>
        <p className="font-body text-metric tabular text-ink">{item.value}</p>
        {item.source && item.tooltip ? (
          <IconTooltip label={item.tooltip}>
            <span className="mono-meta mt-s1 inline-flex min-h-11 items-center">{item.source}</span>
          </IconTooltip>
        ) : (
          item.source && <p className="mono-meta mt-s1">{item.source}</p>
        )}
      </div>
    </div>
  );
}

function SkeletonCell({ hero }: { hero: boolean }) {
  return (
    <div data-cell data-span={hero ? 'hero' : 'support'} className="surface flex flex-col justify-between gap-s3 p-s3" aria-hidden="true">
      <div className="skeleton h-s2 w-2/3" />
      <div className="skeleton h-s4 w-1/2" />
    </div>
  );
}

export function BentoGrid({
  items,
  state = 'default',
  emptyTitle = DEFAULT_STATE_COPY.emptyTitle,
  emptyAction,
  errorTitle = DEFAULT_STATE_COPY.errorTitle,
  onRetry,
  className = '',
}: BentoGridProps) {
  if (state === 'loading') {
    return (
      <div className={`bento ${className}`} aria-busy="true" aria-label="Memuat metrik">
        <SkeletonCell hero />
        {[0, 1, 2, 3].map((i) => <SkeletonCell key={i} hero={false} />)}
      </div>
    );
  }

  if (state === 'empty') {
    return (
      <div className={`surface flex min-h-37 flex-col items-start justify-center gap-s3 p-s4 ${className}`}>
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
      <div className={`surface flex min-h-37 flex-col items-start justify-center gap-s3 p-s4 ${className}`} role="alert">
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
    <div className={`bento ${className}`} data-state={state}>
      {items.map((item) => <Cell key={item.id} item={item} state={state} />)}
    </div>
  );
}
