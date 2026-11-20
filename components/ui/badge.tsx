import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { StatusDot, type DotState } from './status-dot';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export type Status = 'success' | 'warning' | 'danger' | 'neutral' | 'info';

const statusMap: Record<Status, DotState> = {
  success: 'active',
  warning: 'neutral',
  danger: 'error',
  neutral: 'empty',
  info: 'loading',
};

export interface StatusBadgeProps {
  status: Status;
  label: string;
  className?: string;
}

/** V-06: badge tanpa capsule/glow. Hanya status nyata dari API, ditandai dot + teks. */
export function StatusBadge({ status, label, className }: StatusBadgeProps) {
  return <StatusDot state={statusMap[status]} label={label} className={cn('px-0', className)} />;
}
