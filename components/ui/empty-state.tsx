import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { IconFileText as FileText } from './icons';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

/** U-06/R-27: empty state menyebut penyebab + satu aksi, bukan "No data". */
export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center gap-3 py-12 text-center', className)}>
      <div className="flex h-12 w-12 items-center justify-center rounded-card border border-border-hairline bg-canvas text-ink-muted-strong">
        {icon ?? <FileText className="h-6 w-6" />}
      </div>
      <h3 className="font-body text-headline-sm text-ink">{title}</h3>
      {description && (
        <p className="max-w-md font-body text-body-md text-ink-muted-strong">{description}</p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
