'use client';

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export interface EngineBadgeProps {
  online: boolean;
  version?: string;
  rail?: boolean;
}

/**
 * U-01/V-10: tanpa klaim "Engine Online", tanpa badge versi marketing.
 * Dot state + fakta teknis dari API. `version` diterima tapi tidak dirender.
 */
export function EngineBadge({ online, version: _version, rail = false }: EngineBadgeProps) {
  return (
    <div className={cn('flex min-h-11 items-center gap-2', rail && 'justify-center md:justify-start')}>
      <span className={cn('state-dot', online ? 'state-dot-active' : 'state-dot-error')} aria-hidden="true" />
      <span className={cn('font-mono text-body-sm text-ink-muted-strong', rail && 'md:hidden xl:inline')}>
        SQLite · SQL + FTS5
      </span>
      <span className="sr-only">{online ? 'Sumber tersedia' : 'Sumber tidak tersedia'}</span>
    </div>
  );
}
