'use client';

import type { ComponentState } from '@/lib/ui/component-state';

/**
 * C-10 Highlight Headline (dari Hero Highlight).
 * Purpose Gate: menandakan satu janji produk di landing. Sorotan statis, tidak
 * mengikuti kursor (spotlight pengikut kursor ditolak: tidak memberi informasi).
 * Motion: 200ms opacity saat mount, tanpa parallax.
 *
 * 8 state: hover/focus/active/loading/empty/error adalah n/a karena ini judul
 * statis, bukan kontrol atau tampilan data. Alasan: tidak ada aksi atau data
 * yang bisa berubah, jadi state tersebut tidak punya arti (§4).
 */
export interface HeroHighlightProps {
  children: React.ReactNode;
  /** Frasa yang disorot latar forest-08. Satu per halaman. */
  highlight: string;
  state?: ComponentState;
  className?: string;
}

export function HeroHighlight({ children, highlight, state = 'default', className = '' }: HeroHighlightProps) {
  const parts = String(children).split(highlight);

  return (
    <h1
      data-state={state}
      data-motion
      className={`animate-phrase-in max-w-[68ch] font-display text-display font-bold tracking-[-0.03em] text-ink ${className}`}
    >
      {parts.map((part, i) => (
        <span key={i}>
          {part}
          {i < parts.length - 1 && (
            <mark className="bg-forest-08 px-s1 text-ink">{highlight}</mark>
          )}
        </span>
      ))}
    </h1>
  );
}
