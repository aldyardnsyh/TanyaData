import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Check, Clock, AlertTriangle, Minus, Loader2 } from 'lucide-react';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export type Status = 'success' | 'warning' | 'danger' | 'neutral' | 'info';

const statusConfig: Record<Status, { bg: string; text: string; icon: React.ReactNode }> = {
  success: { bg: 'bg-secondary-container', text: 'text-on-secondary-fixed', icon: <Check className="h-3 w-3" /> },
  warning: { bg: 'bg-tertiary-fixed', text: 'text-on-tertiary-fixed-variant', icon: <Clock className="h-3 w-3" /> },
  danger: { bg: 'bg-error-container', text: 'text-on-error-container', icon: <AlertTriangle className="h-3 w-3" /> },
  neutral: { bg: 'bg-surface-container-high', text: 'text-on-surface-variant', icon: <Minus className="h-3 w-3" /> },
  info: { bg: 'bg-surface-container-low', text: 'text-primary', icon: <Loader2 className="h-3 w-3 animate-spin" /> },
};

export interface StatusBadgeProps {
  status: Status;
  label: string;
  className?: string;
}

export function StatusBadge({ status, label, className }: StatusBadgeProps) {
  const config = statusConfig[status];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-body text-label-sm font-semibold',
        config.bg,
        config.text,
        className,
      )}
    >
      {config.icon}
      {label}
    </span>
  );
}
