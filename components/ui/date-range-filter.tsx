'use client';

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export type PeriodPreset = 'bulan_ini' | '7_hari' | '30_hari' | 'kustom';

export interface DateRangeFilterProps {
  presets: { id: PeriodPreset; label: string }[];
  value: PeriodPreset;
  onChange: (id: PeriodPreset) => void;
  className?: string;
}

export function DateRangeFilter({ presets, value, onChange, className }: DateRangeFilterProps) {
  return (
    <div className={cn('flex items-center gap-1 rounded-md bg-surface-container-low p-0.5', className)} role="tablist">
      {presets.map((preset) => (
        <button
          key={preset.id}
          role="tab"
          aria-selected={value === preset.id}
          onClick={() => onChange(preset.id)}
          className={cn(
            'rounded-md px-2.5 py-1 font-body text-label-md transition-colors duration-[var(--motion-fast)] focus-ring focus-visible:outline-none',
            value === preset.id
              ? 'bg-surface-container-lowest text-primary font-semibold'
              : 'text-on-surface-variant hover:text-on-surface',
          )}
        >
          {preset.label}
        </button>
      ))}
    </div>
  );
}
