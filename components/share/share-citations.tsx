'use client';

import { useState } from 'react';
import { Drawer } from '@/components/ui/drawer';
import { MonoMeta } from '@/components/ui/mono-meta';
import type { ShareCitation } from '@/lib/ui/share-contract';

/** Marker inline [S1]: tautan nyata ke panel, dua arah (SHARE_PAGE_SPEC §5). */
export function CitationMarker({ citation }: { citation: ShareCitation }) {
  return (
    <a
      id={`answer-${citation.id}`}
      href={`#cite-${citation.id}`}
      aria-label={`Sitasi ${citation.id.slice(1)}, ${citation.sectionPath}`}
      className="mx-0.5 inline font-mono text-[12px] leading-[18px] tracking-[0.04em] uppercase text-primary underline-offset-2 hover:underline focus-ring"
    >
      [{citation.id}]
    </a>
  );
}

/** Sisipkan marker ke teks jawaban berdasarkan daftar id sitasi yang dipakai. */
export function AnnotatedText({
  text,
  citations,
  includeCitations,
}: {
  text: string;
  citations: ShareCitation[];
  includeCitations: boolean;
}) {
  if (!includeCitations || citations.length === 0) {
    return <>{text}</>;
  }
  const nodes: React.ReactNode[] = [];
  const parts = text.split(/(\[S\d+\])/g);
  let cursor = 0;
  for (const part of parts) {
    if (/^\[S\d+\]$/.test(part)) {
      const id = part.slice(1, -1);
      const citation = citations.find((item) => item.id === id);
      if (citation) {
        nodes.push(<CitationMarker key={`${id}-${cursor}`} citation={citation} />);
        cursor += 1;
        continue;
      }
    }
    nodes.push(part);
  }
  return <>{nodes}</>;
}

function CitationPanel({ citation }: { citation: ShareCitation }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <article
      id={`cite-${citation.id}`}
      tabIndex={-1}
      className="min-w-0 rounded-card border border-border-hairline bg-canvas p-4 focus-ring"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-body text-headline-sm text-ink">{citation.sectionPath}</h4>
        {citation.page != null && <MonoMeta>halaman {citation.page}</MonoMeta>}
      </div>
      <blockquote className={`mt-3 font-body text-body-md leading-relaxed text-ink ${expanded ? '' : 'line-clamp-6'}`}>
        {citation.quote}
      </blockquote>
      {citation.quote.length > 240 && (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          className="mt-2 inline-flex min-h-11 items-center font-body text-body-sm font-semibold text-primary underline-offset-2 hover:underline focus-ring"
        >
          {expanded ? 'Sembunyikan kutipan' : 'Baca selengkapnya'}
        </button>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-4 border-t border-border-hairline pt-3">
        <a href={`#answer-${citation.id}`} className="inline-flex min-h-11 items-center font-body text-body-sm text-primary underline-offset-2 hover:underline focus-ring">
          Kembali ke jawaban
        </a>
        {citation.documentIncluded && citation.anchorId && (
          <a href={`#chunk-${citation.anchorId}`} className="inline-flex min-h-11 items-center font-body text-body-sm text-primary underline-offset-2 hover:underline focus-ring">
            Lihat di dokumen
          </a>
        )}
      </div>
    </article>
  );
}

/** Panel kutipan: 1440 di samping (sticky), 1024 di bawah 2 kolom, 390 drawer. */
export function CitationPanels({ citations }: { citations: ShareCitation[] }) {
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 min-[1440px]:grid-cols-1">
      {citations.map((citation) => <CitationPanel key={citation.id} citation={citation} />)}
    </div>
  );
}

/** Pemicu drawer sitasi mobile: area sentuh 44px, fokus terperangkap, Escape menutup. */
export function CitationDrawer({
  citations,
  open,
  onOpenChange,
}: {
  citations: ShareCitation[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <div className="lg:hidden">
      <button
        type="button"
        onClick={() => onOpenChange(true)}
        className="inline-flex min-h-11 items-center gap-2 rounded-control border border-border-control px-3 font-body text-label-md font-semibold text-ink transition-colors hover:border-primary focus-ring"
      >
        Lihat sitasi ({citations.length})
      </button>
      <Drawer open={open} onOpenChange={onOpenChange} side="bottom" title="Sitasi" className="max-h-[85vh]">
        <div className="flex flex-col gap-3">
          {citations.map((citation) => <CitationPanel key={citation.id} citation={citation} />)}
        </div>
      </Drawer>
    </div>
  );
}
