/**
 * C-10 / §4.5: satu indikator mesin untuk Shell dan Asisten.
 * Pill sinyal hidup `#d6ea5b`/`#191e00` dengan dot 6px; gagal = pill error + tautan periksa.
 */
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

export function EngineIndicator({ online, label, href, className }: EngineIndicatorProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 rounded-full px-3 py-2 font-body text-label-sm font-semibold',
        online ? 'bg-secondary-container text-on-secondary-fixed' : 'bg-error-container text-on-error-container',
        className,
      )}
    >
      <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', online ? 'bg-primary' : 'bg-error')} aria-hidden="true" />
      {label ?? (online ? 'Mesin: SQLite · SQL + FTS5' : 'Mesin tidak tersedia')}
      {href && !online && (
        <Link href={href} className="ml-1 underline focus-ring">
          Periksa sumber
        </Link>
      )}
    </span>
  );
}
