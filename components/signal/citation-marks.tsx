'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
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

const SENTENCE_RE = /(?<=[.!?])\s+/;
const STOPWORDS = new Set([
  'yang', 'dengan', 'untuk', 'dalam', 'pada', 'dari', 'ini', 'itu', 'dan', 'atau',
  'tidak', 'juga', 'sebagai', 'oleh', 'agar', 'bagaimana', 'apa', 'kapan', 'siapa',
  'tersebut', 'dijadwalkan', 'menunjukkan', 'berikut',
]);

function contentWords(text: string): string[] {
  return String(text ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((word) => word.length >= 4 && !STOPWORDS.has(word));
}

function clipped(text: string): string {
  return text.length > 340 ? `${text.slice(0, 337).trimEnd()}…` : text;
}

function focusedQuote(quote: string | undefined, context: string | undefined): string | null {
  const source = String(quote ?? '').replace(/\s+/g, ' ').trim();
  if (!source) return null;
  const sentences = source.split(SENTENCE_RE).map((s) => s.trim()).filter(Boolean);
  if (sentences.length === 1) return clipped(sentences[0]);
  const wanted = new Set(contentWords(context ?? ''));
  if (!wanted.size) return clipped(sentences[0]);
  let best = 0;
  let bestScore = -1;
  sentences.forEach((sentence, index) => {
    const score = contentWords(sentence).reduce((total, word) => total + (wanted.has(word) ? 1 : 0), 0);
    if (score > bestScore) {
      bestScore = score;
      best = index;
    }
  });
  return clipped(sentences[best]);
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
  context,
}: {
  index: number;
  citation: SourceCitation;
  onOpen?: (citation: SourceCitation) => void;
  context?: string;
}) {
  const target = citationTargetPath(citation);
  const label = `Sitasi ${index + 1}`;
  const tooltipId = useId();
  const anchorRef = useRef<HTMLSpanElement>(null);
  const timerRef = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ left: number; top: number; above: boolean } | null>(null);
  const meta = [citation.docTitle ?? citation.sourceId, citation.section, citation.page ? `hlm ${citation.page}` : null]
    .filter(Boolean)
    .join(' · ');
  const quote = focusedQuote(citation.quote, context);

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };
  const scheduleClose = () => {
    clearTimer();
    timerRef.current = window.setTimeout(() => setOpen(false), 140);
  };
  const show = () => {
    const rect = anchorRef.current?.getBoundingClientRect();
    if (!rect) return;
    clearTimer();
    const width = Math.min(352, Math.max(240, window.innerWidth - 16));
    const left = Math.max(8, Math.min(rect.left - 8, window.innerWidth - width - 8));
    const above = rect.top > 260;
    setAnchor({ left, top: above ? rect.top - 8 : rect.bottom + 8, above });
    setOpen(true);
  };

  useEffect(() => () => clearTimer(), []);

  const tooltip = open && anchor ? (
    <span
      id={tooltipId}
      role="tooltip"
      onPointerEnter={clearTimer}
      onPointerLeave={scheduleClose}
      className="fixed z-dropdown block w-[min(22rem,calc(100vw-2rem))] max-h-72 overflow-auto rounded-control border border-[var(--border-hairline)] bg-porcelain p-s2 elevated"
      style={{
        left: anchor.left,
        top: anchor.top,
        transform: anchor.above ? 'translateY(-100%)' : undefined,
      }}
    >
      <span className="flex flex-col gap-s1">
        <span className="mono-meta flex items-center justify-between gap-s2">
          <span>S{index + 1}</span>
          {meta && <span className="truncate text-ink-72">{meta}</span>}
        </span>
        <span className="font-body text-[11px] text-ink-72">Kutipan sumber</span>
        {quote ? (
          <span className="rounded-control border border-[var(--border-hairline)] bg-lime/10 px-s2 py-s1 font-body text-caption leading-relaxed text-ink">
            &ldquo;{quote}&rdquo;
          </span>
        ) : (
          <span className="font-body text-caption text-ink-72">Kutipan tidak tersedia pada sitasi ini.</span>
        )}
        <span className="font-body text-[11px] text-ink-72">Klik marker untuk membuka dokumen</span>
      </span>
    </span>
  ) : null;

  const marker = (
    <>
      <span
        ref={anchorRef}
        className="font-mono text-[0.85em] text-forest underline decoration-lime decoration-2 underline-offset-2"
      >
        [{index + 1}]
      </span>
      {tooltip}
    </>
  );
  const shared = {
    onPointerEnter: show,
    onPointerLeave: scheduleClose,
    onFocus: show,
    onBlur: scheduleClose,
    onKeyDown: (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        clearTimer();
        setOpen(false);
      }
    },
    'aria-describedby': open ? tooltipId : undefined,
    className: 'group relative inline-flex items-baseline focus-ring',
  };
  if (target) {
    return (
      <Link href={target} aria-label={label} {...shared}>
        {marker}
      </Link>
    );
  }
  return (
    <button type="button" onClick={() => onOpen?.(citation)} aria-label={label} {...shared}>
      {marker}
    </button>
  );
}
