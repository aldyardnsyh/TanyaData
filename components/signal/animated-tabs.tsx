'use client';

import { useRef, type KeyboardEvent } from 'react';
import type { ComponentState, StateCopy } from '@/lib/ui/component-state';
import { DEFAULT_STATE_COPY } from '@/lib/ui/component-state';

/**
 * C-04 Context Tabs (dari Animated Tabs).
 * Purpose Gate: indikator menunjukkan filter mana yang berlaku tanpa menggambar
 * ulang seluruh daftar. Label selalu teks, bukan ikon saja.
 * Motion: indikator 160ms ease-out, tanpa bounce (M5).
 *
 * Semantik: ini adalah **filter**, bukan tab. Container memakai role="group"
 * dengan tombol aria-pressed (bukan tablist/tab/aria-selected, F-03 / A-13).
 * Navigasi keyboard memakai roving tabindex: ←/→ berpindah ke opsi aktif
 * berikutnya (skip disabled, wrap), Home/End ke ujung. Fokus dan pilihan
 * berpindah bersama agar pembaca layar tidak kehilangan konteks.
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
  /** light = permukaan porcelain (default). dark = band gelap forest: indikator lime, teks porcelain. */
  tone?: 'light' | 'dark';
  /** Label kelompok untuk pembaca layar; ini filter, bukan tabpanel. */
  ariaLabel?: string;
  className?: string;
}

export function AnimatedTabs({
  tabs,
  activeId,
  onChange,
  state = 'default',
  tone = 'light',
  ariaLabel = 'Filter',
  errorTitle = DEFAULT_STATE_COPY.errorTitle,
  onRetry,
  className = '',
}: AnimatedTabsProps) {
  // Hook dipanggil sebelum early return agar urutan hook tetap konsisten.
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);

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
  const isDark = tone === 'dark';

  const enabledIndexes = tabs.reduce<number[]>((acc, tab, i) => {
    if (!tab.disabled) acc.push(i);
    return acc;
  }, []);
  // Satu-satunya tombol yang menerima Tab. Bila activeId tidak aktif/disabled,
  // jatuh ke opsi pertama agar kelompok tetap bisa dimasuki keyboard.
  const tabbableIndex = enabledIndexes.includes(index) ? index : (enabledIndexes[0] ?? -1);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (enabledIndexes.length === 0) return;
    let target: number | undefined;

    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowLeft': {
        const pos = enabledIndexes.indexOf(index);
        if (pos === -1) {
          target = enabledIndexes[0];
        } else {
          const step = event.key === 'ArrowRight' ? 1 : -1;
          target = enabledIndexes[(pos + step + enabledIndexes.length) % enabledIndexes.length];
        }
        break;
      }
      case 'Home':
        target = enabledIndexes[0];
        break;
      case 'End':
        target = enabledIndexes[enabledIndexes.length - 1];
        break;
      default:
        return;
    }

    if (target === undefined) return;
    event.preventDefault();
    const next = tabs[target];
    if (next && next.id !== activeId) onChange(next.id);
    buttonRefs.current[target]?.focus();
  };

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      data-state={state}
      onKeyDown={handleKeyDown}
      className={`relative flex w-full border-b ${isDark ? 'border-hairline-dark' : 'border-[var(--border-hairline)]'} ${className}`}
    >
      <span
        aria-hidden="true"
        data-motion
        className={`pointer-events-none absolute bottom-0 left-0 h-[2px] transition-transform duration-[var(--motion-normal)] ease-[var(--ease-sharp)] ${isDark ? 'bg-lime' : 'bg-forest-08'}`}
        style={{ width, transform: `translateX(${index * 100}%)` }}
      />
      {tabs.map((tab, i) => {
        const selected = tab.id === activeId;
        return (
          <button
            key={tab.id}
            ref={(el) => { buttonRefs.current[i] = el; }}
            type="button"
            aria-pressed={selected}
            tabIndex={i === tabbableIndex ? 0 : -1}
            disabled={tab.disabled}
            onClick={() => onChange(tab.id)}
            className={`touch-44 flex-1 px-s2 font-display text-label font-semibold transition-colors duration-[var(--motion-fast)] focus-ring ${
              isDark
                ? selected
                  ? 'text-porcelain'
                  : 'text-dark-muted hover:text-porcelain'
                : selected
                  ? 'text-forest'
                  : 'text-ink-72 hover:text-forest'
            } ${tab.error ? 'border-b-2 border-terracotta' : ''} disabled:opacity-50`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
