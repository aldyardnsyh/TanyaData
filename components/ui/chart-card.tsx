'use client';

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { EmptyState } from './empty-state';
import { Skeleton } from './skeleton';
import { InlineError } from './inline-error';
import { MonoMeta } from './mono-meta';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export interface ChartCardProps {
  title: string;
  subtitle?: string;
  meta?: string;
  headerAction?: React.ReactNode;
  loading?: boolean;
  error?: string | null;
  empty?: boolean;
  emptyText?: string;
  emptyAction?: React.ReactNode;
  onRetry?: () => void;
  /** §5.2: tabel sr-only berisi data yang sama dengan plot. */
  srTable?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

/** §5.2: judul pertanyaan, measurement rule, legend, plot, tooltip hover/fokus saja. */
export function ChartCard({
  title,
  subtitle,
  meta,
  headerAction,
  loading,
  error,
  empty,
  emptyText,
  emptyAction,
  onRetry,
  srTable,
  children,
  className,
}: ChartCardProps) {
  return (
    <section className={cn('rounded-card border border-border-hairline bg-surface', className)}>
      <header className="measurement-rule px-5 pb-3 pt-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="font-body text-headline-sm text-ink">{title}</h3>
            {subtitle && <p className="mt-1 font-body text-body-sm text-ink-muted-strong">{subtitle}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-3">
            {meta && <MonoMeta>{meta}</MonoMeta>}
            {headerAction}
          </div>
        </div>
      </header>
      <div className="p-5">
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-[200px] w-full" />
          </div>
        ) : error ? (
          <InlineError message={error} onRetry={onRetry} />
        ) : empty ? (
          <EmptyState
            title={emptyText ?? 'Tidak ada data pada periode ini.'}
            description="Pilih periode lain untuk melihat transaksi."
            action={emptyAction}
          />
        ) : (
          <>
            {children}
            {srTable && <div className="sr-only">{srTable}</div>}
          </>
        )}
      </div>
    </section>
  );
}
