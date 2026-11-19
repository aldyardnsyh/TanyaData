'use client';

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { formatNumber, formatPercent, formatIdr } from '@/lib/ui/format';
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
  className?: string;
}

function formatValue(value: number | null, format: KpiFormat): string {
  if (format === 'percent') return formatPercent(value);
  if (format === 'currency') return formatIdr(value);
  return formatNumber(value);
}

export function KpiCard({ label, value, format = 'number', delta, note, tooltip, loading, className }: KpiCardProps) {
  if (loading) {
    return (
      <div className={cn('rounded-xl bg-surface-container-lowest border border-outline-variant p-5', className)}>
        <Skeleton className="h-3 w-24" />
        <Skeleton className="mt-2 h-8 w-20" />
        <Skeleton className="mt-1 h-3 w-16" />
      </div>
    );
  }

  const deltaChip = delta && delta.pct !== null ? (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 rounded-sm px-1.5 py-0.5 font-body text-label-sm font-bold',
        delta.direction === 'up' && 'bg-primary-fixed text-on-primary-fixed-variant',
        delta.direction === 'down' && 'bg-tertiary-fixed text-on-tertiary-fixed-variant',
        delta.direction === 'flat' && 'bg-surface-container-high text-on-surface-variant',
        delta.direction === null && 'hidden',
      )}
    >
      {delta.direction === 'up' && <TrendingUp className="h-3 w-3" />}
      {delta.direction === 'down' && <TrendingDown className="h-3 w-3" />}
      {delta.direction === 'flat' && <Minus className="h-3 w-3" />}
      {delta.pct > 0 ? `+${delta.pct.toFixed(1)}%` : `${delta.pct.toFixed(1)}%`}
      {delta.compareValue !== null && (
        <span className="text-on-surface-variant font-normal"> vs {formatValue(delta.compareValue, format)}</span>
      )}
    </span>
  ) : null;

  return (
    <div className={cn('rounded-xl bg-surface-container-lowest border border-outline-variant p-5', className)} title={tooltip}>
      <p className="font-body text-label-sm text-on-surface-variant uppercase tracking-wider">{label}</p>
      <div className="mt-1 flex items-baseline justify-between">
        <p className="font-display text-metric-xl font-bold text-on-surface tabular">{formatValue(value, format)}</p>
        {deltaChip}
      </div>
      {note && <p className="mt-1 font-body text-body-sm text-on-surface-variant">{note}</p>}
    </div>
  );
}
