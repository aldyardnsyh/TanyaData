'use client';

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { IconArrowUpDown as ArrowUpDown, IconArrowUp as ArrowUp, IconArrowDown as ArrowDown } from './icons';
import { Skeleton } from './skeleton';
import { EmptyState } from './empty-state';
import { InlineError } from './inline-error';
import { MonoMeta } from './mono-meta';

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
  stickyHeader?: boolean;
  activeRowKey?: string | null;
  rowKey?: (row: T) => string;
  className?: string;
}

/** §5.3: header sticky, baris 44/52px, garis kiri primary untuk baris aktif. */
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
  activeRowKey,
  rowKey,
  className,
}: DataTableProps<T>) {
  if (loading) {
    return (
      <div className={cn('overflow-x-auto', className)}>
        <table className="w-full text-left">
          <thead>
            <tr className="bg-canvas">
              {columns.map((col) => (
                <th key={col.key} className="px-4 py-3 font-body text-label-sm uppercase text-ink-muted-strong">
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 5 }).map((_, i) => (
              <tr key={i} className="border-b border-border-hairline">
                {columns.map((col) => (
                  <td key={col.key} className="px-4 py-3"><Skeleton className="h-4 w-24" /></td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (error) {
    return <InlineError message={error} onRetry={onRetry} className={className} />;
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
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="bg-canvas">
            {columns.map((col) => {
              const isSortable = onSort && col.key === sortKey;
              return (
                <th
                  key={col.key}
                  className={cn(
                    'whitespace-nowrap px-4 py-3 font-body text-label-sm uppercase text-ink-muted-strong',
                    col.align === 'right' && 'text-right',
                    col.sticky && 'sticky left-0 z-10 bg-canvas',
                    stickyHeader && 'sticky top-0 z-sticky bg-canvas',
                    stickyHeader && col.sticky && 'left-0 z-20',
                  )}
                  aria-sort={
                    isSortable
                      ? sortDirection === 'asc' ? 'ascending' : sortDirection === 'desc' ? 'descending' : 'none'
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
                        'inline-flex min-h-11 items-center gap-1 font-body text-label-sm text-ink-muted-strong transition-colors duration-[var(--motion-fast)] hover:text-ink focus-ring',
                        col.align === 'right' && 'w-full justify-end',
                      )}
                    >
                      {col.label}
                      {sortDirection === 'asc' ? <ArrowUp className="h-3 w-3" /> :
                        sortDirection === 'desc' ? <ArrowDown className="h-3 w-3" /> :
                        <ArrowUpDown className="h-3 w-3 opacity-40" />}
                    </button>
                  ) : col.label}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="animate-crossfade">
          {rows.map((row, i) => {
            const key = rowKey ? rowKey(row) : String(i);
            const active = activeRowKey != null && key === activeRowKey;
            return (
              <tr
                key={key}
                className={cn(
                  'relative min-h-11 border-b border-border-hairline transition-colors duration-[var(--motion-fast)] last:border-b-0 hover:bg-row-hover',
                  active && 'bg-row-hover',
                )}
              >
                {columns.map((col, ci) => {
                  const value = row[col.key];
                  const display = col.format ? col.format(value) : value;
                  return (
                    <td
                      key={col.key}
                      className={cn(
                        'min-h-11 px-4 py-3 align-middle font-body text-body-md text-ink',
                        col.align === 'right' && 'text-right tabular',
                        col.sticky && 'sticky left-0 z-10 bg-surface',
                        active && ci === 0 && 'border-l-2 border-primary pl-3',
                      )}
                    >
                      {display}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="border-t border-border-hairline px-4 py-2">
        <MonoMeta>{rows.length} baris</MonoMeta>
      </div>
    </div>
  );
}
