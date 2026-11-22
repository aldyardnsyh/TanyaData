'use client';

import Link from 'next/link';
import type { SourceCitation } from '@/lib/contracts/http';
import { citationTargetPath } from '@/lib/ui/citation-target';

/**
 * Marker sitasi deep-link (SHARE_PAGE_SPEC §5 / API_CONTRACT §13.8).
 * Purpose Gate: menghubungkan klaim ke potongan asal. Marker adalah tautan
 * nyata, bukan span dekoratif. Sitasi dokumen membuka halaman detail sumber
 * pada potongan yang dirujuk (di-highlight di sana); sisanya fallback ke
 * panel drawer lokal.
 */
export function CitationMarks({
  citations,
  onOpen,
  className = '',
}: {
  citations: SourceCitation[];
  onOpen?: (citation: SourceCitation) => void;
  className?: string;
}) {
  if (citations.length === 0) return null;
  return (
    <div className={`flex flex-wrap items-center gap-s2 ${className}`} aria-label="Sitasi">
      <span className="font-body text-caption text-ink-72">Sitasi</span>
      {citations.map((citation, index) => {
        const label = `S${index + 1}`;
        const target = citationTargetPath(citation);
        const ariaLabel = `Sitasi ${index + 1}, ${citation.section ?? citation.docTitle ?? citation.sourceId}`;
        if (target) {
          return (
            <Link
              key={citation.chunkId ?? index}
              id={`cite-${label}`}
              href={target}
              aria-label={ariaLabel}
              className="mono-meta inline-flex min-h-11 items-center text-forest underline-offset-2 hover:underline focus-ring"
            >
              [{label}]
            </Link>
          );
        }
        return (
          <button
            key={citation.chunkId ?? index}
            id={`cite-${label}`}
            type="button"
            onClick={() => onOpen?.(citation)}
            aria-label={ariaLabel}
            className="mono-meta inline-flex min-h-11 items-center text-forest underline-offset-2 hover:underline focus-ring"
          >
            [{label}]
          </button>
        );
      })}
    </div>
  );
}

/**
 * Marker sitasi INLINE dalam kalimat jawaban (konsep NotebookLM): teks jawaban
 * diakhiri [n] per kutipan. Hover/focus membuka popover "kaca pembesar" yang
 * menampilkan KALIMAT persis yang dikutip (bukan satu paragraf hasil chunking)
 * + meta asal; klik tetap membuka sumber (deep-link / drawer).
 */
export function InlineCitationMark({
  index,
  citation,
  onOpen,
}: {
  index: number;
  citation: SourceCitation;
  onOpen?: (citation: SourceCitation) => void;
}) {
  const target = citationTargetPath(citation);
  const label = `Sitasi ${index + 1}`;
  const meta = [citation.docTitle ?? citation.sourceId, citation.section, citation.page ? `hlm ${citation.page}` : null]
    .filter(Boolean)
    .join(' · ');
  const popover = (
    <span
      role="tooltip"
      className="absolute bottom-full left-0 z-dropdown mb-s1 hidden w-80 rounded-control border border-[var(--border-hairline)] bg-porcelain p-s2 text-left elevated group-hover:inline-flex group-focus-within:inline-flex after:absolute after:left-0 after:top-full after:h-2 after:w-full after:content-['']"
    >
      <span className="flex flex-col gap-s1">
        {meta && <span className="mono-meta">{meta}</span>}
        {citation.quote && (
          <span className="border-l-2 border-lime bg-lime/20 px-s2 py-s1 font-body text-caption leading-relaxed text-ink">
            &ldquo;{citation.quote}&rdquo;
          </span>
        )}
        <span className="font-body text-[11px] text-ink-72">Klik untuk membuka sumber di dokumen</span>
      </span>
    </span>
  );
  const marker = (
    <>
      <span className="font-mono text-[0.85em] text-forest underline decoration-lime decoration-2 underline-offset-2">
        [{index + 1}]
      </span>
      {popover}
    </>
  );
  if (target) {
    return (
      <Link
        href={target}
        aria-label={label}
        className="group relative inline-flex items-baseline focus-ring"
      >
        {marker}
      </Link>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onOpen?.(citation)}
      aria-label={label}
      className="group relative inline-flex items-baseline focus-ring"
    >
      {marker}
    </button>
  );
}
