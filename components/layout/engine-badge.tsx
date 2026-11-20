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
 * DECISION-011: label UI Inggris. Versi aplikasi diberi label jujur "App",
 * bukan disajikan sebagai versi mesin. Titik status statis (tanpa ping loop).
 */
export function EngineBadge({ online, version, rail = false }: EngineBadgeProps) {
  const label = online ? 'Engine Online' : 'Engine Offline';
  const appVersion = version ? `App v${version}` : null;
  const full = appVersion ? `${label} · ${appVersion}` : label;

  return (
    <div
      className={cn('flex items-center gap-space-sm', rail && 'justify-center xl:justify-start')}
      title={full}
    >
      <span className="relative flex h-2 w-2 shrink-0" aria-hidden="true">
        <span className={cn('relative inline-flex h-2 w-2 rounded-full', online ? 'bg-signal-lime' : 'bg-error')} />
      </span>
      <span className={cn('font-label-sm text-on-surface-variant', rail && 'md:hidden xl:inline')}>
        {label}
      </span>
      {appVersion && (
        <span className={cn('font-label-sm font-mono text-on-surface-variant', rail && 'md:hidden xl:inline')}>
          {appVersion}
        </span>
      )}
      <span className="sr-only">{full}</span>
    </div>
  );
}
