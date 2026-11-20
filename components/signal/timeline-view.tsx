'use client';

import type { ComponentState, StateCopy } from '@/lib/ui/component-state';
import { DEFAULT_STATE_COPY } from '@/lib/ui/component-state';

/**
 * C-07 Evidence Timeline (dari Timeline).
 * Purpose Gate: urutan waktu adalah bukti, bukan dekorasi. Urutan DOM sama
 * dengan urutan kronologis. Tanggal selalu teks, bukan hanya posisi.
 * Motion: node masuk 200ms opacity (M7).
 */
export interface TimelineNode {
  id: string;
  /** ISO YYYY-MM-DD. Diverifikasi dari sumber, bukan rekaan. */
  date: string;
  label: string;
  evidence?: string;
  citation?: { id: string; label: string; href: string };
  error?: boolean;
}

export interface TimelineViewProps extends StateCopy {
  nodes: TimelineNode[];
  state?: ComponentState;
  className?: string;
}

export function TimelineView({
  nodes,
  state = 'default',
  emptyTitle = 'Tidak ada kejadian bertanggal pada sumber ini.',
  emptyAction,
  errorTitle = 'Garis waktu gagal dimuat.',
  onRetry,
  className = '',
}: TimelineViewProps) {
  if (state === 'loading') {
    return (
      <ol className={`relative ml-s2 border-l border-[var(--border-hairline)] pl-s4 ${className}`} aria-busy="true">
        {[0, 1, 2].map((i) => (
          <li key={i} className="relative pb-s4" aria-hidden="true">
            <span className="absolute -left-[25px] top-1 state-dot" />
            <div className="skeleton h-s2 w-24" />
            <div className="skeleton mt-s2 h-s3 w-2/3" />
          </li>
        ))}
      </ol>
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
    <ol className={`relative ml-s2 border-l border-[var(--border-hairline)] pl-s4 ${className}`} data-state={state}>
      {nodes.map((node) => (
        <li key={node.id} className="relative pb-s4 last:pb-0" data-state={state}>
          <span
            className={`absolute -left-[25px] top-1 state-dot ${node.error ? 'state-dot-error' : ''} ${state === 'active' ? 'state-dot-active' : ''}`}
            aria-hidden="true"
          />
          <time dateTime={node.date} className="mono-meta block">{node.date}</time>
          <p className="mt-s1 font-display text-label font-semibold text-ink underline-offset-2 hover:underline">{node.label}</p>
          {node.evidence && <p className="mt-s1 font-body text-body text-ink-72">{node.evidence}</p>}
          {node.citation && (
            <a
              href={node.citation.href}
              className="mono-meta mt-s1 inline-flex min-h-11 items-center text-forest underline-offset-2 hover:underline focus-ring"
              aria-label={`Sitasi: ${node.citation.label}`}
            >
              {node.citation.label}
            </a>
          )}
        </li>
      ))}
    </ol>
  );
}
