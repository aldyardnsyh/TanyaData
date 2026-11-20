'use client';

import { useState } from 'react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { IconArrowUpRight, IconArrowDownRight, IconMinus } from './icons';
import { formatNumber, formatPercent, formatIdr } from '@/lib/ui/format';
import { useCountUp } from '@/lib/ui/count-up';
import { Skeleton } from './skeleton';

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
  /** C-07: count-up 600ms sekali saat mount; false = langsung nilai akhir (perubahan filter). */
  animateCount?: boolean;
  className?: string;
}

function formatValue(value: number | null, format: KpiFormat): string {
  if (format === 'percent') return formatPercent(value);
  if (format === 'currency') return formatIdr(value);
  return formatNumber(value);
}

export function KpiCard({ label, value, format = 'number', delta, note, tooltip, loading, animateCount = true, className }: KpiCardProps) {
  // Purpose Gate: hover mengulang count-up agar angka terasa "baru diukur", bukan dekorasi.
  const [replayToken, setReplayToken] = useState(0);
  const counted = useCountUp(animateCount ? value : null, 600, replayToken);
  const displayValue = animateCount ? counted : value;

  if (loading) {
    return (
      <div className={cn('rounded-xl bg-surface-container-lowest border border-outline-variant p-5', className)}>
        <Skeleton className="h-3 w-24" />
        <Skeleton className="mt-2 h-8 w-20" />
        <Skeleton className="mt-1 h-3 w-16" />
      </div>
    );
  }

  // A-15: arah tidak hanya warna — kata naik/turun/tetap + konteks pembanding (§4.6).
  const deltaWord = delta?.direction === 'up' ? 'naik' : delta?.direction === 'down' ? 'turun' : 'tetap';
  const deltaChip = delta && delta.pct !== null && delta.direction ? (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 rounded-sm px-1.5 py-0.5 font-body text-label-sm font-bold',
        delta.direction === 'up' && 'bg-primary-fixed text-on-primary-fixed-variant',
        delta.direction === 'down' && 'bg-tertiary-fixed text-on-tertiary-fixed-variant',
        delta.direction === 'flat' && 'bg-surface-container-high text-on-surface-variant',
      )}
    >
      {/* Purpose Gate: panah bergeser 2px saat hover untuk memperkuat arah delta. */}
      {delta.direction === 'up' && <IconArrowUpRight className="h-3 w-3 transition-transform duration-[var(--motion-fast)] group-hover:translate-x-0.5 motion-reduce:transform-none" aria-hidden="true" />}
      {delta.direction === 'down' && <IconArrowDownRight className="h-3 w-3 transition-transform duration-[var(--motion-fast)] group-hover:translate-x-0.5 motion-reduce:transform-none" aria-hidden="true" />}
      {delta.direction === 'flat' && <IconMinus className="h-3 w-3 transition-transform duration-[var(--motion-fast)] group-hover:translate-x-0.5 motion-reduce:transform-none" aria-hidden="true" />}
      {deltaWord} {formatPercent(Math.abs(delta.pct))}
      {delta.compareValue !== null && (
        <span className="text-on-surface-variant font-normal"> vs {formatValue(delta.compareValue, format)}</span>
      )}
    </span>
  ) : null;

  // Purpose Gate: kartu naik 2px saat hover sebagai affordance, tanpa shadow tambahan.
  return (
    <div
      className={cn(
        'group rounded-xl bg-surface-container-lowest border border-outline-variant p-5 transition-transform duration-[var(--motion-fast)] ease-[var(--ease-out-quart)] hover:-translate-y-0.5 motion-reduce:transform-none',
        className,
      )}
      onMouseEnter={() => setReplayToken((token) => token + 1)}
      title={tooltip}
    >
      <p className="font-body text-label-sm text-on-surface-variant uppercase tracking-wider">{label}</p>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <p className="font-display text-metric-xl font-bold text-on-surface tabular">{formatValue(displayValue, format)}</p>
        {deltaChip}
      </div>
      {note && <p className="mt-1 font-body text-body-sm text-on-surface-variant">{note}</p>}
    </div>
  );
}
