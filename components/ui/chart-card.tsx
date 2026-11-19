'use client';

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { EmptyState } from './empty-state';
import { Skeleton } from './skeleton';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export interface ChartCardProps {
  title: string;
  subtitle?: string;
  headerAction?: React.ReactNode;
  loading?: boolean;
  error?: string | null;
  empty?: boolean;
  emptyText?: string;
  onRetry?: () => void;
  children: React.ReactNode;
  className?: string;
}

export function ChartCard({ title, subtitle, headerAction, loading, error, empty, emptyText, onRetry, children, className }: ChartCardProps) {
  return (
    <div className={cn('rounded-xl bg-surface-container-lowest border border-outline-variant', className)}>
      <div className="flex items-center justify-between border-b border-outline-variant px-5 py-4">
        <div>
          <h3 className="font-display text-headline-sm font-semibold text-on-surface">{title}</h3>
          {subtitle && <p className="font-body text-body-sm text-on-surface-variant mt-0.5">{subtitle}</p>}
        </div>
        {headerAction}
      </div>
      <div className="p-5">
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-[200px] w-full" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <AlertTriangle className="h-6 w-6 text-error" />
            <p className="font-body text-body-md text-error">{error}</p>
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex items-center gap-1.5 rounded-md bg-surface-container-lowest border border-outline-variant px-3 py-1.5 font-body text-label-md text-on-surface transition-colors duration-[var(--motion-fast)] hover:bg-surface-container focus-ring"
              >
                <RefreshCw className="h-4 w-4" />
                Coba lagi
              </button>
            )}
          </div>
        ) : empty ? (
          <EmptyState title={emptyText ?? 'Tidak ada data untuk filter ini.'} />
        ) : (
          children
        )}
      </div>
    </div>
  );
}
