'use client';

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export interface FilterChip {
  id: string;
  label: string;
}

export interface FilterChipsProps {
  chips: FilterChip[];
  value: string;
  onChange: (id: string) => void;
  label: string;
  className?: string;
}

/**
 * A-14/C-18: filter (bukan tab) — role="group" + aria-pressed, pill h32,
 * scroll horizontal dengan fade tepi kanan dan scroll-snap (§4.4).
 */
export function FilterChips({ chips, value, onChange, label, className }: FilterChipsProps) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn('chip-scroll flex items-center gap-2 overflow-x-auto py-1.5', className)}
    >
      {chips.map((chip) => {
        const active = chip.id === value;
        return (
          <button
            key={chip.id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(chip.id)}
            className={cn(
              'relative h-8 min-w-11 shrink-0 snap-start rounded-full px-3 font-body text-label-md transition-colors duration-[var(--motion-fast)] focus-ring',
              active
                ? 'bg-primary font-semibold text-on-primary'
                : 'bg-surface-container-low text-on-surface-variant hover:text-on-surface',
            )}
          >
            {chip.label}
            {/* Purpose Gate: garis aktif meluncur 150ms tanpa menggeser layout. */}
            <span
              aria-hidden="true"
              className={cn(
                'pointer-events-none absolute inset-x-3 bottom-1 h-0.5 origin-left rounded-full bg-current transition-transform duration-[var(--motion-focus)] ease-[var(--ease-out-quart)] motion-reduce:transform-none',
                active ? 'scale-x-100' : 'scale-x-0',
              )}
            />
          </button>
        );
      })}
    </div>
  );
}
