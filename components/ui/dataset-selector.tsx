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

/** Kontrol nyata: native select, bukan div role=button tanpa aksi (R-26). */
export function DatasetSelector({ datasets, value, onChange, className }: DatasetSelectorProps) {
  return (
    <label className={cn('inline-flex min-h-11 items-center gap-2 rounded-control border border-border-control bg-surface px-3 focus-within:border-primary', className)}>
      <Database className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
      <span className="sr-only">Pilih dataset aktif</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="max-w-[180px] cursor-pointer appearance-none bg-transparent font-body text-label-md text-ink focus-ring"
      >
        {datasets.map((d) => (
          <option key={d.id} value={d.id}>{d.name}</option>
        ))}
      </select>
    </label>
  );
}
