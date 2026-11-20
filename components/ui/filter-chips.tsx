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

/** §5.6 + motion #6: chip radius 8, visual 32px / sentuh 44px, slide aktif 120ms. */
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
              'touch-44 relative h-8 shrink-0 snap-start rounded-control border px-3 font-body text-label-md transition-colors duration-[var(--motion-fast)] focus-ring',
              active
                ? 'border-primary bg-primary text-on-primary'
                : 'border-border-control bg-surface text-ink-muted-strong hover:border-primary hover:text-ink',
            )}
          >
            <span className="inline-flex items-center gap-1.5">
              {active && <span className="state-dot state-dot-active" aria-hidden="true" />}
              {chip.label}
            </span>
            {/* Purpose Gate: indikator aktif meluncur 120ms, tanpa bounce. */}
            <span
              aria-hidden="true"
              className={cn(
                'pointer-events-none absolute inset-x-3 bottom-1 h-0.5 origin-left rounded-control bg-current transition-transform duration-[var(--motion-fast)] ease-[var(--ease-out-expo)] motion-reduce:transform-none',
                active ? 'scale-x-100' : 'scale-x-0',
              )}
            />
          </button>
        );
      })}
    </div>
  );
}
