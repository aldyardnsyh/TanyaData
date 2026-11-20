'use client';

import { useState } from 'react';
import { Icon } from '@/components/ui/icons';

/**
 * FAQ S6 (LANDING_COPY_SEO §2-S6): accordion untuk empat pertanyaan yang
 * dijawab produk ini, bukan template "apakah data saya aman" (R-28).
 * Purpose Gate: jawaban panjang tidak muat tampil serentak tanpa menutupi
 * copy privasi di atasnya; satu item terbuka pada satu waktu.
 * Motion: expand memakai token animate-grid-expand (220ms transform + opacity,
 * §6 aturan 5 mengizinkan accordion), reduced-motion menonaktifkannya global.
 */
export interface FaqItem {
  id: string;
  question: string;
  answer: string;
}

export function FaqAccordion({ items }: { items: FaqItem[] }) {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="border-t border-[var(--border-hairline)]">
      {items.map((item) => {
        const open = openId === item.id;
        return (
          <div key={item.id} className="border-b border-[var(--border-hairline)]">
            <button
              type="button"
              aria-expanded={open}
              aria-controls={`faq-${item.id}`}
              onClick={() => setOpenId(open ? null : item.id)}
              className="flex min-h-11 w-full items-center justify-between gap-s3 py-s3 text-left font-display text-label font-semibold text-ink transition-colors duration-[var(--motion-fast)] hover:text-forest focus-ring"
            >
              {item.question}
              <Icon
                name={open ? 'expand_less' : 'expand_more'}
                className="text-[20px] text-ink-72"
                aria-hidden="true"
              />
            </button>
            <div id={`faq-${item.id}`} hidden={!open} data-motion className="animate-grid-expand">
              {open && <p className="max-w-[68ch] pb-s3 font-body text-body text-ink-72">{item.answer}</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
