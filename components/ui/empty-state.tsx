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

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center gap-3 py-12 text-center', className)}>
      <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-surface-container text-outline">
        {icon ?? <FileText className="h-6 w-6" />}
      </div>
      <h3 className="font-display text-headline-sm font-semibold text-on-surface">{title}</h3>
      {description && (
        <p className="max-w-sm font-body text-body-md text-on-surface-variant">{description}</p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
