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
  idPrefix?: string;
  variant?: 'underline' | 'chip';
  className?: string;
  label?: string;
}

/** Navigasi tab: underline 2px primary (state, bukan dekorasi), target 44px. */
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
        underline ? 'gap-4 border-b border-border-hairline' : 'chip-scroll items-center gap-2 overflow-x-auto',
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
                ? cn('relative min-h-11 px-1', active ? 'font-semibold text-primary' : 'text-ink-muted-strong hover:text-ink')
                : cn(
                    'min-h-11 rounded-control border px-3',
                    active ? 'border-primary bg-primary font-semibold text-on-primary' : 'border-border-control bg-surface text-ink-muted-strong hover:text-ink',
                  ),
            )}
          >
            {tab.label}
            {underline && (
              <span
                aria-hidden="true"
                className={cn(
                  'absolute inset-x-0 bottom-0 h-0.5 origin-left bg-primary transition-transform duration-[var(--motion-fast)] ease-[var(--ease-out-expo)] motion-reduce:transform-none',
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
