import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { IconAlertTriangle as AlertTriangle } from './icons';
import { Button } from './button';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export interface InlineErrorProps {
  title?: string;
  message: string;
  onRetry?: () => void;
  className?: string;
}

/** V-03: teks error memakai --error-text (10,3:1), terracotta hanya border/dot. */
export function InlineError({ title = 'Gagal memuat data', message, onRetry, className }: InlineErrorProps) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-start gap-2 rounded-card border border-signal-terracotta bg-surface p-4 sm:flex-row sm:items-center',
        className,
      )}
    >
      <AlertTriangle className="h-5 w-5 shrink-0 text-error-text" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="font-body text-label-md font-semibold text-error-text">{title}</p>
        <p className="mt-0.5 font-body text-body-sm text-ink-muted-strong">{message}</p>
      </div>
      {onRetry && (
        <Button size="sm" variant="secondary" onClick={onRetry} className="shrink-0">
          Coba lagi
        </Button>
      )}
    </div>
  );
}
