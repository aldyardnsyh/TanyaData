import type { ReactNode } from 'react';

/**
 * Satu `display` per halaman (UI_REFACTOR_DESIGN §3.1 / §5).
 * Purpose Gate: memberi satu focal point yang sama di semua modul kerja.
 * Token only: font-display, text-display, ink, ink-72, mono-meta.
 */
export function PageHeading({
  title,
  caption,
  meta,
  actions,
}: {
  title: string;
  caption?: string;
  meta?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-s5 flex flex-wrap items-end justify-between gap-s3">
      <div className="min-w-0">
        <h1 className="font-display text-display text-ink">{title}</h1>
        {caption && <p className="mt-s2 max-w-[68ch] font-body text-body text-ink-72">{caption}</p>}
        {meta && <p className="mono-meta mt-s2">{meta}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-s2">{actions}</div>}
    </div>
  );
}
