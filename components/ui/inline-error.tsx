import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { AlertTriangle } from 'lucide-react';
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

/** B-06 / §4.13: banner error inline — ikon + judul + pesan API + aksi retry. */
export function InlineError({ title = 'Gagal memuat data', message, onRetry, className }: InlineErrorProps) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-start gap-2 rounded-md border border-error-container bg-error-container p-4 sm:flex-row sm:items-center',
        className,
      )}
    >
      <AlertTriangle className="h-5 w-5 shrink-0 text-on-error-container" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="font-body text-label-md font-semibold text-on-error-container">{title}</p>
        <p className="mt-0.5 font-body text-body-sm text-on-error-container">{message}</p>
      </div>
      {onRetry && (
        <Button size="sm" variant="secondary" onClick={onRetry} className="shrink-0">
          Coba lagi
        </Button>
      )}
    </div>
  );
}
