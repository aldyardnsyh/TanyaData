'use client';

import type { ComponentState, StateCopy } from '@/lib/ui/component-state';
import { DEFAULT_STATE_COPY } from '@/lib/ui/component-state';

/**
 * C-04 Context Tabs (dari Animated Tabs).
 * Purpose Gate: indikator menunjukkan filter mana yang berlaku tanpa menggambar
 * ulang seluruh daftar. Label selalu teks, bukan ikon saja.
 * Motion: indikator 160ms ease-out, tanpa bounce (M5).
 */
export interface TabItem {
  id: string;
  label: string;
  disabled?: boolean;
  error?: boolean;
}

export interface AnimatedTabsProps extends StateCopy {
  tabs: TabItem[];
  activeId: string;
  onChange: (id: string) => void;
  state?: ComponentState;
  className?: string;
}

export function AnimatedTabs({
  tabs,
  activeId,
  onChange,
  state = 'default',
  errorTitle = DEFAULT_STATE_COPY.errorTitle,
  onRetry,
  className = '',
}: AnimatedTabsProps) {
  if (state === 'empty') return null; // n/a: tab selalu punya opsi.

  if (state === 'loading') {
    return (
      <div className={`flex gap-s2 ${className}`} aria-busy="true">
        {tabs.map((tab) => (
          <div key={tab.id} className="skeleton h-s5 w-24" aria-hidden="true" />
        ))}
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className={`flex flex-col items-start gap-s2 ${className}`} role="alert">
        <span className="inline-flex items-center gap-s2">
          <span className="state-dot state-dot-error" aria-hidden="true" />
          <span className="font-body text-body text-ink">{errorTitle}</span>
        </span>
        {onRetry && (
          <button type="button" onClick={onRetry} className="touch-44 rounded-control border border-forest px-s3 font-display text-label font-semibold text-forest focus-ring">
            Coba lagi
          </button>
        )}
      </div>
    );
  }

  const index = Math.max(0, tabs.findIndex((tab) => tab.id === activeId));
  const width = `${100 / Math.max(tabs.length, 1)}%`;

  return (
    <div
      role="tablist"
      data-state={state}
      className={`relative flex w-full border-b border-[var(--border-hairline)] ${className}`}
    >
      <span
        aria-hidden="true"
        data-motion
        className="pointer-events-none absolute bottom-0 left-0 h-[2px] bg-forest-08 transition-transform duration-[var(--motion-normal)] ease-[var(--ease-sharp)]"
        style={{ width, transform: `translateX(${index * 100}%)` }}
      />
      {tabs.map((tab) => {
        const selected = tab.id === activeId;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
            disabled={tab.disabled}
            onClick={() => onChange(tab.id)}
            className={`touch-44 flex-1 px-s2 font-display text-label font-semibold transition-colors duration-[var(--motion-fast)] focus-ring ${
              selected ? 'text-forest' : 'text-ink-72 hover:text-forest'
            } ${tab.error ? 'border-b-2 border-terracotta' : ''} disabled:opacity-50`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
