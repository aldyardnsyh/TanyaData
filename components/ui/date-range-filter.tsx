'use client';

import { FilterChips } from './filter-chips';

export type PeriodPreset = 'bulan_ini' | '7_hari' | '30_hari' | 'kustom';

export interface DateRangeFilterProps {
  presets: { id: PeriodPreset; label: string }[];
  value: PeriodPreset;
  onChange: (id: PeriodPreset) => void;
  className?: string;
}

/**
 * A-14: filter periode adalah filter, bukan tab — role="group" + aria-pressed
 * lewat komponen FilterChips bersama.
 */
export function DateRangeFilter({ presets, value, onChange, className }: DateRangeFilterProps) {
  return (
    <FilterChips
      chips={presets}
      value={value}
      onChange={(id) => onChange(id as PeriodPreset)}
      label="Filter periode"
      className={className}
    />
  );
}
