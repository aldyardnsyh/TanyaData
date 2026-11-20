import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export interface SkeletonProps {
  className?: string;
}

/** Loading jujur: skeleton 1,2s, bukan spinner. Mati saat reduced-motion. */
export function Skeleton({ className }: SkeletonProps) {
  return <span className={cn('block rounded-control bg-row-hover animate-skeleton', className)} />;
}
