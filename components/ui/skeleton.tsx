import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className }: SkeletonProps) {
  // A-16: opacity pulse 1,2s dari token (globals.css), mati saat reduced-motion.
  return <div className={cn('rounded-md bg-surface-container animate-skeleton', className)} />;
}
