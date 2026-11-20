'use client';

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { IconArrowUpDown as ArrowUpDown, IconArrowUp as ArrowUp, IconArrowDown as ArrowDown } from './icons';
import { Skeleton } from './skeleton';
import { EmptyState } from './empty-state';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export type SortDirection = 'asc' | 'desc' | null;

export interface DataTableColumn<T> {
  key: string;
  label: string;
  align?: 'left' | 'right';
  format?: (value: any) => string;
  sticky?: boolean;
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onSort?: (key: string, direction: SortDirection) => void;
  sortKey?: string;
  sortDirection?: SortDirection;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: React.ReactNode;
  /** Header sticky saat tabel berada di dalam wadah scroll vertikal (§D.5 pratinjau). */
  stickyHeader?: boolean;
  className?: string;
}

export function DataTable<T extends Record<string, any>>({
  columns,
  rows,
  loading,
  error,
  onRetry,
  onSort,
  sortKey,
  sortDirection,
  emptyTitle = 'Belum ada data',
  emptyDescription,
  emptyAction,
  stickyHeader,
  className,
}: DataTableProps<T>) {
  if (loading) {
    return (
      <div className={cn('overflow-x-auto', className)}>
        <table className="w-full text-left">
          <thead>
            <tr className="bg-surface-container-low">
              {columns.map((col) => (
                <th key={col.key} className="py-2.5 px-4 font-body text-label-sm text-on-surface-variant uppercase">
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 5 }).map((_, i) => (
              <tr key={i} className="border-b border-outline-variant">
                {columns.map((col) => (
                  <td key={col.key} className="py-3 px-4">
                    <Skeleton className="h-4 w-24" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-center">
        <p className="font-body text-body-md text-error">{error}</p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="rounded-md bg-surface-container-lowest border border-outline-variant px-3 py-1.5 font-body text-label-md text-on-surface transition-colors duration-[var(--motion-fast)] hover:bg-surface-container focus-ring"
          >
            Coba lagi
          </button>
        )}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        title={emptyTitle}
        description={emptyDescription}
        action={emptyAction}
        className={className}
      />
    );
  }

  return (
    <div className={cn('overflow-x-auto', className)}>
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="bg-surface-container-low border-b border-outline-variant">
            {columns.map((col) => {
              const isSortable = onSort && col.key === sortKey;
              return (
                <th
                  key={col.key}
                  className={cn(
                    'py-2.5 px-4 font-body text-label-sm text-on-surface-variant uppercase',
                    col.align === 'right' && 'text-right',
                    col.sticky && 'sticky left-0 bg-surface-container-low z-10',
                    stickyHeader && 'sticky top-0 z-sticky bg-surface-container-low',
                    stickyHeader && col.sticky && 'left-0 z-20',
                  )}
                  aria-sort={
                    isSortable
                      ? sortDirection === 'asc'
                        ? 'ascending'
                        : sortDirection === 'desc'
                          ? 'descending'
                          : 'none'
                      : undefined
                  }
                >
                  {isSortable ? (
                    <button
                      type="button"
                      onClick={() =>
                        onSort?.(col.key, sortDirection === 'asc' ? 'desc' : sortDirection === 'desc' ? null : 'asc')
                      }
                      className={cn(
                        'inline-flex items-center gap-1 font-body text-label-sm text-on-surface-variant transition-colors duration-[var(--motion-fast)] hover:text-on-surface focus-ring',
                        col.align === 'right' && 'justify-end w-full',
                      )}
                    >
                      {col.label}
                      {sortDirection === 'asc' ? (
                        <ArrowUp className="h-3 w-3" />
                      ) : sortDirection === 'desc' ? (
                        <ArrowDown className="h-3 w-3" />
                      ) : (
                        <ArrowUpDown className="h-3 w-3 opacity-40" />
                      )}
                    </button>
                  ) : (
                    col.label
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={i}
              className="border-b border-outline-variant last:border-b-0 hover:bg-surface-container-low transition-colors duration-[var(--motion-fast)]"
            >
              {columns.map((col) => {
                const value = row[col.key];
                const display = col.format ? col.format(value) : value;
                return (
                  <td
                    key={col.key}
                    className={cn(
                      'py-3 px-4 font-body text-body-md text-on-surface',
                      col.align === 'right' && 'text-right tabular',
                      col.sticky && 'sticky left-0 bg-surface-container-low z-10',
                    )}
                  >
                    {display}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
