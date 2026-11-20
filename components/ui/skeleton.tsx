import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className }: SkeletonProps) {
  // Hydration: <span> adalah phrasing content, sah di dalam <p>. `block` menjaga
  // tampilan identik dengan <div> sehingga tidak ada browser-parser reflow yang
  // memicu "div cannot be descendant of p" / hydration mismatch.
  // A-16: opacity pulse 1,2s dari token (globals.css), mati saat reduced-motion.
  return <span className={cn('block rounded-md bg-surface-container animate-skeleton', className)} />;
}
