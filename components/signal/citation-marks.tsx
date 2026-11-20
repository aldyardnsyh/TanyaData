'use client';

import type { SourceCitation } from '@/lib/contracts/http';

/**
 * Marker sitasi deep-link (SHARE_PAGE_SPEC §5 / API_CONTRACT §13.8).
 * Purpose Gate: menghubungkan klaim ke potongan asal. Marker adalah tautan
 * nyata, bukan span dekoratif. Fail-closed: deep_link invalid → panel lokal.
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
        const valid = citation.deep_link_status === 'valid' && Boolean(citation.deep_link);
        const ariaLabel = `Sitasi ${index + 1}, ${citation.section ?? citation.docTitle ?? citation.sourceId}`;
        if (valid) {
          return (
            <a
              key={citation.chunkId ?? index}
              id={`cite-${label}`}
              href={citation.deep_link!}
              aria-label={ariaLabel}
              className="mono-meta inline-flex min-h-11 items-center text-forest underline-offset-2 hover:underline focus-ring"
            >
              [{label}]
            </a>
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
