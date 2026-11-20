import Link from 'next/link';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export interface EngineIndicatorProps {
  online: boolean;
  label?: string;
  href?: string;
  className?: string;
}

/** U-01: tanpa klaim "live". Dot + fakta teknis dari API. */
export function EngineIndicator({ online, label, href, className }: EngineIndicatorProps) {
  return (
    <span className={cn('inline-flex min-h-11 items-center gap-2 px-2', className)}>
      <span className={cn('state-dot', online ? 'state-dot-active' : 'state-dot-error')} aria-hidden="true" />
      <span className="font-body text-body-sm text-ink-muted-strong">
        {label ?? (online ? 'SQLite · SQL + FTS5' : 'Sumber tidak tersedia')}
      </span>
      {href && !online && (
        <Link href={href} className="font-body text-body-sm text-primary underline focus-ring">
          Periksa sumber
        </Link>
      )}
    </span>
  );
}
