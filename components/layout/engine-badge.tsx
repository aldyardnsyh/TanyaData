'use client';

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { useI18n } from '@/lib/ui/i18n-provider';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export interface EngineBadgeProps {
  online: boolean;
  version?: string;
  rail?: boolean;
}

export function EngineBadge({ online, version, rail = false }: EngineBadgeProps) {
  const { t } = useI18n();
  const label = online ? t('shell.engineOnline') : t('shell.engineOffline');
  const full = version ? `${label} v${version}` : label;

  return (
    <div
      className={cn('flex items-center gap-space-sm', rail && 'justify-center xl:justify-start')}
      title={full}
    >
      <span className="relative flex h-2 w-2 shrink-0" aria-hidden="true">
        {online && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-signal-lime opacity-60" />
        )}
        <span className={cn('relative inline-flex h-2 w-2 rounded-full', online ? 'bg-signal-lime' : 'bg-error')} />
      </span>
      <span className={cn('font-label-sm text-on-surface-variant', rail && 'md:hidden xl:inline')}>
        {label}
      </span>
      {version && (
        <span className={cn('font-label-sm font-mono text-on-surface-variant', rail && 'md:hidden xl:inline')}>
          v{version}
        </span>
      )}
      <span className="sr-only">{full}</span>
    </div>
  );
}
