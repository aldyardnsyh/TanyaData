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
  /** Frasa yang disorot. Satu per halaman. */
  highlight: string;
  /** light = sorotan latar forest-08 (permukaan porcelain). dark = frasa lime + glow (band gelap forest). */
  tone?: 'light' | 'dark';
  /** hero = skala judul landing (clamp 40-68px), page = token display standar. */
  size?: 'page' | 'hero';
  state?: ComponentState;
  className?: string;
}

export function HeroHighlight({
  children,
  highlight,
  tone = 'light',
  size = 'page',
  state = 'default',
  className = '',
}: HeroHighlightProps) {
  const parts = String(children).split(highlight);
  const headlineTone =
    tone === 'dark'
      ? 'text-porcelain'
      : 'text-ink';
  const markTone =
    tone === 'dark'
      ? 'bg-transparent px-0 text-lime text-glow-lime'
      : 'bg-forest-08 px-s1 text-ink';
  const sizeTone = size === 'hero' ? 'text-display-hero' : 'text-display';

  return (
    <h1
      data-state={state}
      data-motion
      className={`animate-phrase-in max-w-[24ch] font-display ${sizeTone} font-bold tracking-[-0.03em] ${headlineTone} ${className}`}
    >
      {parts.map((part, i) => (
        <span key={i}>
          {part}
          {i < parts.length - 1 && <mark className={markTone}>{highlight}</mark>}
        </span>
      ))}
    </h1>
  );
}
