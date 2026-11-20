'use client';

import { useRef } from 'react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export interface Tab {
  id: string;
  label: string;
}

export interface TabsProps {
  tabs: Tab[];
  value: string;
  onChange: (id: string) => void;
  /** Prefix untuk id panel yang dikontrol; tiap tab mendapat aria-controls={`${idPrefix}-${id}`}. */
  idPrefix?: string;
  /** 'underline' = tab underline desktop h40 (default); 'chip' = filter chip pill h32. */
  variant?: 'underline' | 'chip';
  className?: string;
  label?: string;
}

export function Tabs({ tabs, value, onChange, idPrefix = 'tab', variant = 'underline', className, label = 'Tab' }: TabsProps) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (e: React.KeyboardEvent, index: number) => {
    let next: number | null = null;
    if (e.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    if (next === null) return;
    e.preventDefault();
    onChange(tabs[next].id);
    refs.current[next]?.focus();
  };

  const underline = variant === 'underline';

  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn(
        'flex',
        underline ? 'gap-4 border-b border-outline-variant' : 'chip-scroll items-center gap-2 overflow-x-auto',
        className,
      )}
    >
      {tabs.map((tab, i) => {
        const active = tab.id === value;
        return (
          <button
            key={tab.id}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            role="tab"
            id={`${idPrefix}-${tab.id}`}
            aria-selected={active}
            aria-controls={`${idPrefix}-panel-${tab.id}`}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              'shrink-0 font-body text-label-md transition-colors duration-[var(--motion-fast)] focus-ring',
              underline
                ? cn(
                    'relative h-10 px-1',
                    active
                      ? 'font-semibold text-primary'
                      : 'text-on-surface-variant hover:text-on-surface',
                  )
                : cn(
                    'h-8 min-w-11 rounded-full px-3',
                    active
                      ? 'bg-primary font-semibold text-on-primary'
                      : 'bg-surface-container-low text-on-surface-variant hover:text-on-surface',
                  ),
            )}
          >
            {tab.label}
            {/* Purpose Gate: garis bawah tab tumbuh dari kiri 120ms menandai tab aktif (§4.4); transform-only, tanpa layout shift. */}
            {underline && (
              <span
                aria-hidden="true"
                className={cn(
                  'absolute inset-x-0 bottom-0 h-0.5 origin-left bg-primary transition-transform duration-[var(--motion-fast)]',
                  active ? 'scale-x-100' : 'scale-x-0',
                )}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
