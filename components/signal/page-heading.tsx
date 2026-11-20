import type { ReactNode } from 'react';

/**
 * Satu `display` per halaman (UI_REFACTOR_DESIGN §3.1 / §5) dengan identitas
 * landing (eyebrow kecil di atas judul). Purpose Gate: memberi satu focal
 * point yang sama di semua modul kerja.
 */
export function PageHeading({
  eyebrow,
  title,
  caption,
  meta,
  actions,
}: {
  eyebrow?: string;
  title: string;
  caption?: string;
  meta?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-s5 flex flex-wrap items-end justify-between gap-s3">
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1 className={`font-display text-display text-ink ${eyebrow ? 'mt-s1' : ''}`}>{title}</h1>
        {caption && <p className="mt-s2 max-w-[68ch] font-body text-body text-ink-72">{caption}</p>}
        {meta && <p className="mono-meta mt-s2">{meta}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-s2">{actions}</div>}
    </div>
  );
}
