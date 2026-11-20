'use client';

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { IconDatabase as Database } from './icons';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export interface DatasetSelectorProps {
  datasets: { id: string; name: string; rowCount: number }[];
  value: string;
  onChange: (id: string) => void;
  className?: string;
}

export function DatasetSelector({ datasets, value, onChange, className }: DatasetSelectorProps) {
  const selected = datasets.find((d) => d.id === value);
  return (
    <div
      className={cn(
        'flex items-center gap-1.5 rounded-md bg-surface-container-low px-2.5 py-1.5 text-on-surface font-body text-label-md transition-colors duration-[var(--motion-fast)] hover:bg-surface-container focus-ring',
        className,
      )}
      role="button"
      tabIndex={0}
      aria-label="Pilih dataset aktif"
    >
      <Database className="h-4 w-4 text-primary" />
      <span className="max-w-[150px] truncate">{selected?.name ?? value}</span>
      <span className="text-on-surface-variant">▾</span>
    </div>
  );
}
