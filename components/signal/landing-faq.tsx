'use client';

import { useState } from 'react';
import { Icon } from '@/components/ui/icons';

/**
 * FAQ accordion (LandingCopySEO §2-S6): pertanyaan yang dijawab produk ini,
 * bukan template "apakah data saya aman" (R-28).
 * Purpose Gate: jawaban panjang tidak muat tampil serentak tanpa menutupi
 * copy di atasnya; satu item terbuka pada satu waktu.
 * tone light = permukaan porcelain (teks ink/forest). tone dark = band gelap
 * forest: pertanyaan porcelain, terbuka/hover lime, jawaban porcelain-72.
 * Motion: expand memakai token animate-grid-expand (220ms transform + opacity,
 * §6 aturan 5 mengizinkan accordion), reduced-motion menonaktifkannya global.
 */
export interface FaqItem {
  id: string;
  question: string;
  answer: string;
}

export function FaqAccordion({
  items,
  tone = 'light',
}: {
  items: FaqItem[];
  tone?: 'light' | 'dark';
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const isDark = tone === 'dark';
  const lineColor = isDark ? 'border-hairline-dark' : 'border-[var(--border-hairline)]';

  return (
    <div className={`border-t ${lineColor}`}>
      {items.map((item) => {
        const open = openId === item.id;
        return (
          <div key={item.id} className={`border-b ${lineColor}`}>
            <button
              type="button"
              aria-expanded={open}
              aria-controls={`faq-${item.id}`}
              onClick={() => setOpenId(open ? null : item.id)}
              className={`flex min-h-11 w-full items-center justify-between gap-s3 py-s3 text-left font-display text-label font-semibold transition-colors duration-[var(--motion-fast)] focus-ring ${
                isDark
                  ? open
                    ? 'text-lime'
                    : 'text-porcelain hover:text-lime'
                  : open
                    ? 'text-forest'
                    : 'text-ink hover:text-forest'
              }`}
            >
              {item.question}
              <Icon
                name={open ? 'expand_less' : 'expand_more'}
                className={`text-[20px] ${isDark ? 'text-dark-muted' : 'text-ink-72'}`}
                aria-hidden="true"
              />
            </button>
            <div id={`faq-${item.id}`} hidden={!open} data-motion className="animate-grid-expand">
              {open && (
                <p
                  className={`max-w-[68ch] pb-s3 font-body text-body ${isDark ? 'text-dark-muted' : 'text-ink-72'}`}
                >
                  {item.answer}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
