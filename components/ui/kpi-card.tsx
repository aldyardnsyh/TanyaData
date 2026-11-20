'use client';

import { useState } from 'react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { IconArrowUpRight, IconArrowDownRight, IconMinus } from './icons';
import { formatNumber, formatPercent, formatIdr } from '@/lib/ui/format';
import { useCountUp } from '@/lib/ui/count-up';
import { Skeleton } from './skeleton';
import { InlineError } from './inline-error';
import { MonoMeta } from './mono-meta';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export type KpiFormat = 'number' | 'percent' | 'currency';

export interface KpiCardProps {
  label: string;
  value: number | null;
  format?: KpiFormat;
  delta?: { pct: number | null; direction: 'up' | 'down' | 'flat' | null; compareValue: number | null } | null;
  note?: string;
  tooltip?: string;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  /** Signature 3.3: satu kartu hero lebih besar (spans 6 dari 12). */
  hero?: boolean;
  meta?: string;
  sparkline?: number[];
  animateCount?: boolean;
  className?: string;
}

function formatValue(value: number | null, format: KpiFormat): string {
  if (format === 'percent') return formatPercent(value);
  if (format === 'currency') return formatIdr(value);
  return formatNumber(value);
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const points = values
    .map((v, i) => `${(i / (values.length - 1)) * 100},${40 - ((v - min) / span) * 36 - 2}`)
    .join(' ');
  return (
    <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="mt-3 h-10 w-full" aria-hidden="true">
      <polyline points={points} fill="none" stroke="var(--color-primary)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/**
 * Signature 3.3 + motion #2: asymmetric bento, count-up 320ms sekali,
 * hover replay 120ms berupa emphasis angka (bukan hitung ulang penuh).
 */
export function KpiCard({
  label,
  value,
  format = 'number',
  delta,
  note,
  tooltip,
  loading,
  error,
  onRetry,
  hero = false,
  meta,
  sparkline,
  animateCount = true,
  className,
}: KpiCardProps) {
  const [replayToken, setReplayToken] = useState(0);
  const counted = useCountUp(animateCount ? value : null, replayToken);
  const displayValue = animateCount ? counted : value;

  if (loading) {
    return (
      <div className={cn('flex min-h-40 flex-col rounded-card border border-border-hairline bg-surface p-5', hero && 'rounded-overlay', className)}>
        <Skeleton className="h-3 w-24" />
        <Skeleton className="mt-3 h-8 w-28" />
        <Skeleton className="mt-2 h-3 w-20" />
      </div>
    );
  }

  if (error) {
    return (
      <div className={cn('min-h-40 rounded-card border border-border-hairline bg-surface p-5', hero && 'rounded-overlay', className)}>
        <InlineError message={error} onRetry={onRetry} />
      </div>
    );
  }

  const direction = delta?.direction ?? null;
  const word = direction === 'up' ? 'naik' : direction === 'down' ? 'turun' : 'stabil';
  const deltaChip = delta && delta.pct !== null && direction ? (
    <span
      className={cn(
        'inline-flex min-h-11 items-center gap-1 rounded-control px-2 font-body text-body-sm',
        direction === 'up' && 'text-error-text',
        direction === 'down' && 'text-primary',
        direction === 'flat' && 'text-ink-muted-strong',
      )}
    >
      <span
        className={cn(
          'state-dot',
          direction === 'up' && 'state-dot-error',
          direction === 'down' && 'state-dot-active',
          direction === 'flat' && 'state-dot-empty',
        )}
        aria-hidden="true"
      />
      {direction === 'up' && <IconArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />}
      {direction === 'down' && <IconArrowDownRight className="h-3.5 w-3.5" aria-hidden="true" />}
      {direction === 'flat' && <IconMinus className="h-3.5 w-3.5" aria-hidden="true" />}
      <span className="tabular">{word} {formatPercent(Math.abs(delta.pct))}</span>
      {delta.compareValue !== null && (
        <span className="text-ink-muted-strong">vs {formatValue(delta.compareValue, format)}</span>
      )}
    </span>
  ) : null;

  return (
    <section
      className={cn(
        'group flex min-h-40 flex-col rounded-card border border-border-hairline bg-surface p-5 transition-colors duration-[var(--motion-fast)] hover:border-primary motion-reduce:transition-none',
        hero && 'rounded-overlay',
        className,
      )}
      onMouseEnter={() => setReplayToken((token) => token + 1)}
      title={tooltip}
    >
      <div className="measurement-rule -mx-5 -mt-5 mb-4 px-5 pt-4 pb-3">
        <p className="font-body text-label-sm uppercase text-ink-muted-strong">{label}</p>
      </div>

      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p
          key={replayToken}
          className="animate-emphasis font-body text-metric-display tabular text-ink"
        >
          {value === null ? '—' : formatValue(displayValue, format)}
        </p>
        {deltaChip}
      </div>

      {note && <p className="mt-1 font-body text-body-sm text-ink-muted-strong">{note}</p>}
      {sparkline && sparkline.length > 1 && <Sparkline values={sparkline} />}

      {meta && <div className="mt-auto pt-3"><MonoMeta>{meta}</MonoMeta></div>}
    </section>
  );
}
