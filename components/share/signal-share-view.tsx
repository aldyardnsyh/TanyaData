'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  DOC_TYPE_LABEL,
  formatShareTimestamp,
  normalizeShareSnapshot,
  type ShareCitation,
  type ShareIdentity,
  type ShareMessage,
  type ShareSnapshotView,
} from '@/lib/ui/share-contract';
import { PageHeading } from '@/components/signal/page-heading';
import { SectionRule } from '@/components/signal/section-rule';
import { StatusBadge } from '@/components/signal/status-badge';
import { StatusDot } from '@/components/signal/status-dot';
import { AdaptiveOutputView } from '@/components/signal/adaptive-output';
import { Drawer } from '@/components/ui/drawer';
import { Icon } from '@/components/ui/icons';

type LoadState = 'loading' | 'ready' | 'notfound' | 'expired' | 'error';

const OUTPUT_LABEL: Record<string, string> = {
  kpi: 'Angka tunggal',
  table: 'Tabel',
  line: 'Grafik garis',
  bar: 'Grafik batang',
  donut: 'Distribusi',
  quote: 'Kutipan',
  timeline: 'Linimasa',
  parameter_report: 'Laporan parameter',
  none: 'Jawaban teks',
};

function stamp(iso: string): string {
  const value = formatShareTimestamp(iso);
  return value === '—' ? 'Waktu tidak tersedia' : value;
}

function wibTime(iso: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date).replace(':', '.');
}

/** Marker [S1] adalah tautan nyata ke panel, dua arah (SHARE_PAGE_SPEC §5). */
function AnnotatedText({
  text,
  citations,
  includeCitations,
}: {
  text: string;
  citations: ShareCitation[];
  includeCitations: boolean;
}) {
  if (!includeCitations || citations.length === 0) return <>{text}</>;
  const nodes: React.ReactNode[] = [];
  const parts = text.split(/(\[S\d+\])/g);
  let cursor = 0;
  for (const part of parts) {
    if (/^\[S\d+\]$/.test(part)) {
      const id = part.slice(1, -1);
      const citation = citations.find((item) => item.id === id);
      if (citation) {
        nodes.push(
          <a
            key={`${id}-${cursor}`}
            id={`answer-${citation.id}`}
            href={`#cite-${citation.id}`}
            aria-label={`Sitasi ${citation.id.slice(1)}, ${citation.sectionPath}`}
            className="mx-0.5 inline font-mono text-caption uppercase tracking-[0.04em] text-forest underline-offset-2 hover:underline focus-ring"
          >
            [{citation.id}]
          </a>,
        );
        cursor += 1;
        continue;
      }
    }
    nodes.push(part);
  }
  return <>{nodes}</>;
}

/** Identitas dokumen mengikuti classifier. Tanpa taksonomi tambahan (§4). */
function IdentityBlock({ identity }: { identity: ShareIdentity | null }) {
  const [expanded, setExpanded] = useState(false);
  if (!identity) {
    return <p className="mono-meta">Identitas dokumen disembunyikan</p>;
  }

  const label = DOC_TYPE_LABEL[identity.docType];
  const pageText = identity.page !== null ? `halaman ${identity.page}` : null;
  const fileName = identity.fileName ?? 'Nama berkas tidak tersedia';
  const nameNode = identity.documentIncluded && identity.anchorId ? (
    <a href={`#chunk-${identity.anchorId}`} className="font-body text-body text-forest underline-offset-2 hover:underline focus-ring">
      {fileName}
    </a>
  ) : (
    <span className="font-body text-body text-ink">{fileName}</span>
  );

  return (
    <div className="flex flex-wrap items-center gap-s2">
      <span className="inline-flex min-h-11 items-center rounded-control border border-[var(--border-hairline)] px-s2 font-body text-caption uppercase text-ink">
        {label}
      </span>
      <span className="hidden items-center gap-s2 lg:inline-flex">
        {nameNode}
        {pageText && <span className="mono-meta">{pageText}</span>}
      </span>
      <span className="inline-flex flex-col gap-s1 lg:hidden">
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          className="touch-44 inline-flex items-center gap-s2 rounded-control font-body text-body text-ink focus-ring"
        >
          <span>{label}{pageText ? ` · ${pageText}` : ''}</span>
          <Icon name={expanded ? 'expand_less' : 'expand_more'} className="text-[16px] text-ink-72" />
        </button>
        {expanded && <span className="max-w-full break-words font-body text-caption text-ink-72">{nameNode}</span>}
      </span>
    </div>
  );
}

function CitationPanel({ citation }: { citation: ShareCitation }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <article
      id={`cite-${citation.id}`}
      tabIndex={-1}
      className="surface min-w-0 p-s3 focus-ring"
    >
      <div className="flex flex-wrap items-center justify-between gap-s2">
        <h4 className="font-display text-label font-semibold text-ink">{citation.sectionPath}</h4>
        {citation.page !== null && <span className="mono-meta">halaman {citation.page}</span>}
      </div>
      <blockquote className={`mt-s3 font-body text-body leading-relaxed text-ink ${expanded ? '' : 'line-clamp-6'}`}>
        {citation.quote}
      </blockquote>
      {citation.quote.length > 240 && (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          className="touch-44 inline-flex items-center font-body text-caption font-semibold text-forest underline-offset-2 hover:underline focus-ring"
        >
          {expanded ? 'Sembunyikan kutipan' : 'Baca selengkapnya'}
        </button>
      )}
      <div className="mt-s3 flex flex-wrap items-center gap-s3 border-t border-[var(--border-hairline)] pt-s2">
        <a href={`#answer-${citation.id}`} className="touch-44 inline-flex items-center font-body text-caption text-forest underline-offset-2 hover:underline focus-ring">
          Kembali ke jawaban
        </a>
        {citation.documentIncluded && citation.anchorId && (
          <a href={`#chunk-${citation.anchorId}`} className="touch-44 inline-flex items-center font-body text-caption text-forest underline-offset-2 hover:underline focus-ring">
            Lihat di dokumen
          </a>
        )}
      </div>
    </article>
  );
}

function CitationPanels({ citations }: { citations: ShareCitation[] }) {
  return (
    <div className="grid grid-cols-1 gap-s2 lg:grid-cols-2 min-[1440px]:grid-cols-1">
      {citations.map((citation) => <CitationPanel key={citation.id} citation={citation} />)}
    </div>
  );
}

function CitationDrawer({
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
        className="touch-44 inline-flex items-center gap-s2 rounded-control border border-[var(--border-hairline)] px-s3 font-display text-label font-semibold text-ink focus-ring"
      >
        <Icon name="description" className="text-[16px]" />
        Lihat sitasi ({citations.length})
      </button>
      <Drawer open={open} onOpenChange={onOpenChange} side="bottom" title="Sitasi" className="max-h-[85vh]">
        <div className="flex flex-col gap-s2">
          {citations.map((citation) => <CitationPanel key={citation.id} citation={citation} />)}
        </div>
      </Drawer>
    </div>
  );
}

function AssistantTurn({
  message,
  citations,
  includeCitations,
  defaultOpen,
}: {
  message: ShareMessage;
  citations: ShareCitation[];
  includeCitations: boolean;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [textExpanded, setTextExpanded] = useState(false);
  const answer = message.answer ?? '';
  const usedCitations = message.citationIds
    .map((id) => citations.find((citation) => citation.id === id))
    .filter((citation): citation is ShareCitation => Boolean(citation));
  const panelId = `bukti-${message.id}`;

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-s2">
        <span className="mono-meta">JAWABAN · {wibTime(message.createdAt)} WIB</span>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls={panelId}
          className="touch-44 inline-flex items-center gap-s2 rounded-control font-display text-label font-semibold text-forest underline-offset-2 hover:underline focus-ring"
        >
          {open ? 'Sembunyikan bukti' : 'Tampilkan bukti'}
        </button>
      </div>
      <div className="surface mt-s2 p-s3 sm:p-s4">
        {message.guardrail ? (
          <>
            <p className="max-w-[72ch] font-body text-body leading-relaxed text-ink">
              Informasi ini tidak ditemukan pada sumber yang tersedia
            </p>
            {message.guardrail.keywords.length > 0 && (
              <p className="mt-s2 font-body text-caption text-ink-72">
                Kata kunci yang dicoba: {message.guardrail.keywords.join(', ')}
              </p>
            )}
          </>
        ) : (
          <>
            <p className={`max-w-[72ch] font-body text-body leading-relaxed text-ink ${textExpanded ? '' : 'line-clamp-[12] lg:line-clamp-none'}`}>
              <AnnotatedText text={answer} citations={citations} includeCitations={includeCitations} />
            </p>
            {answer.length > 900 && (
              <button
                type="button"
                onClick={() => setTextExpanded((value) => !value)}
                aria-expanded={textExpanded}
                className="touch-44 mt-s2 inline-flex items-center font-body text-caption font-semibold text-forest underline-offset-2 hover:underline focus-ring lg:hidden"
              >
                {textExpanded ? 'Tutup' : 'Baca selengkapnya'}
              </button>
            )}
          </>
        )}
      </div>
      <div
        id={panelId}
        className={`grid transition-[grid-template-rows] duration-[var(--motion-normal)] ease-[var(--ease-smooth)] ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
      >
        <div className="overflow-hidden">
          <div className="mt-s2 flex flex-col gap-s2 rounded-control border border-[var(--border-hairline)] p-s3">
            {message.meta?.source && (
              <p className="mono-meta">
                {message.meta.source}{message.meta.period ? ` · ${message.meta.period}` : ''}
              </p>
            )}
            {message.meta?.rowCount !== null && message.meta?.rowCount !== undefined && (
              <p className="font-body text-caption text-ink-72">Baris yang mendasari jawaban: {message.meta.rowCount}</p>
            )}
            {message.outputs.length > 0 && (
              <p className="font-body text-caption text-ink-72">
                Output: {message.outputs.map((output) => OUTPUT_LABEL[output.type] ?? output.type).join(', ')}
              </p>
            )}
            {usedCitations.length > 0 && includeCitations && (
              <p className="font-body text-caption text-ink-72">
                Sitasi: {usedCitations.map((citation) => `[${citation.id}]`).join(' ')}
              </p>
            )}
            {!message.meta?.source && message.outputs.length === 0 && usedCitations.length === 0 && (
              <p className="font-body text-caption text-ink-72">Bukti tambahan tidak tersedia pada snapshot ini.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Transcript({
  messages,
  citations,
  includeCitations,
}: {
  messages: ShareMessage[];
  citations: ShareCitation[];
  includeCitations: boolean;
}) {
  const firstAssistantId = messages.find((message) => message.role === 'assistant')?.id;
  return (
    <div className="flex flex-col gap-s4">
      {messages.map((message, index) => (
        <div
          key={message.id}
          className="animate-phrase-in"
          style={{ animationDelay: `${Math.min(index, 7) * 30}ms` }}
        >
          {message.role === 'user' ? (
            <div className="surface p-s3 sm:p-s4">
              <span className="mono-meta">PERTANYAAN · {wibTime(message.createdAt)} WIB</span>
              <h3 className="mt-s2 max-w-[72ch] font-display text-label font-semibold text-ink">
                {message.question ?? 'Pertanyaan tidak tersedia'}
              </h3>
            </div>
          ) : (
            <AssistantTurn
              message={message}
              citations={citations}
              includeCitations={includeCitations}
              defaultOpen={message.id === firstAssistantId}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function Results({
  messages,
  onOpenCitation,
}: {
  messages: ShareMessage[];
  onOpenCitation: () => void;
}) {
  const assistants = messages.filter((message) => message.role === 'assistant' && message.outputs.length > 0);
  if (assistants.length === 0) {
    return (
      <div className="flex items-center gap-s2">
        <StatusDot tone="neutral" />
        <p className="font-body text-body text-ink-72">Tidak ada hasil visual pada snapshot ini.</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-s4">
      {assistants.map((message) => (
        <div key={message.id} className="flex flex-col gap-s2">
          <span className="mono-meta">HASIL · {wibTime(message.createdAt)} WIB</span>
          <AdaptiveOutputView outputs={message.outputs.slice(0, 2)} readOnly onOpenCitation={onOpenCitation} />
        </div>
      ))}
    </div>
  );
}

function ShareSkeleton() {
  return (
    <main className="page-container py-s5" aria-busy="true">
      <div className="skeleton mb-s3 h-10 w-1/2" />
      <div className="skeleton mb-s2 h-4 w-1/3" />
      <div className="skeleton mb-s5 h-s5 w-40" />
      <div className="grid grid-cols-1 gap-s4 min-[1440px]:grid-cols-12">
        <div className="flex flex-col gap-s4 min-[1440px]:col-span-8">
          {[0, 1, 2].map((index) => (
            <div key={index} className="surface flex flex-col gap-s2 p-s4">
              <div className="skeleton h-s2 w-1/4" />
              <div className="skeleton h-s4 w-full" />
              <div className="skeleton h-s4 w-2/3" />
            </div>
          ))}
          <div className="skeleton h-64 w-full" />
        </div>
        <div className="hidden min-[1440px]:col-span-4 min-[1440px]:block">
          <div className="skeleton h-48 w-full" />
        </div>
      </div>
    </main>
  );
}

function StateShell({
  title,
  description,
  expired = false,
  onRetry,
}: {
  title: string;
  description: string;
  expired?: boolean;
  onRetry?: () => void;
}) {
  return (
    <main className="page-container py-s5">
      <div className="mb-s5 flex flex-wrap items-center gap-s2">
        <span className="inline-flex min-h-11 items-center rounded-control border border-[var(--border-hairline)] px-s2 font-body text-caption uppercase text-ink">
          Shared view
        </span>
      </div>
      <PageHeading title={title} caption={description} />
      <div className="flex min-h-[40vh] flex-col items-start justify-center gap-s3">
        {expired && (
          <span className="inline-flex items-center gap-s2">
            <StatusDot tone="error" />
            <span className="font-body text-body text-ink">Tautan tidak berlaku</span>
          </span>
        )}
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="touch-44 rounded-control border border-forest px-s3 font-display text-label font-semibold text-forest focus-ring"
          >
            Coba lagi
          </button>
        ) : (
          <Link href="/" className="touch-44 inline-flex items-center rounded-control border border-[var(--border-hairline)] px-s3 font-display text-label font-semibold text-ink focus-ring">
            Kembali ke TanyaData
          </Link>
        )}
      </div>
    </main>
  );
}

/**
 * Halaman /share/[id]: enam section read-only, tanpa sidebar, composer, filter,
 * badge live, atau count-up (SHARE_PAGE_SPEC §1–§3). Satu-satunya interaksi:
 * scroll, klik sitasi, expand/collapse bukti, dan drawer sitasi di mobile.
 */
export function SignalShareView({ id }: { id: string }) {
  const [state, setState] = useState<LoadState>('loading');
  const [snapshot, setSnapshot] = useState<ShareSnapshotView | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setState('loading');

    fetch(`/api/share/${encodeURIComponent(id)}`, { signal: controller.signal })
      .then(async (response) => {
        if (response.status === 404) return { kind: 'notfound' as const };
        if (response.status === 410) return { kind: 'expired' as const };
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          const code = body?.error?.code;
          if (code === 'EXPIRED' || code === 'REVOKED') return { kind: 'expired' as const };
          return { kind: 'error' as const };
        }
        const json = await response.json();
        return { kind: 'ready' as const, data: normalizeShareSnapshot(json) };
      })
      .then((result) => {
        if (cancelled) return;
        if (result.kind === 'ready') {
          setSnapshot(result.data);
          setState('ready');
        } else {
          setState(result.kind);
        }
      })
      .catch((error: unknown) => {
        if (cancelled || (error instanceof DOMException && error.name === 'AbortError')) return;
        setState('error');
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [id, attempt]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const openCitationDrawer = useCallback(() => setDrawerOpen(true), []);

  if (state === 'loading') return <ShareSkeleton />;
  if (state === 'notfound') {
    return (
      <StateShell
        title="Tautan berbagi tidak ditemukan"
        description="Periksa kembali alamat atau minta tautan baru."
      />
    );
  }
  if (state === 'expired') {
    return (
      <StateShell
        title="Tautan berbagi ini sudah tidak berlaku"
        description="Minta tautan baru dari pembuatnya."
        expired
      />
    );
  }
  if (state === 'error' || !snapshot) {
    return (
      <StateShell
        title="Halaman gagal dimuat"
        description="Coba lagi."
        onRetry={retry}
      />
    );
  }

  const showCitations = snapshot.includeCitations && snapshot.citations.length > 0;

  return (
    <main className="animate-phrase-in page-container py-s5">
      <div className="grid grid-cols-1 gap-s5 min-[1440px]:grid-cols-12">
        <div className="flex min-w-0 flex-col gap-s5 min-[1440px]:col-span-8">
          {/* 1. Header */}
          <section aria-labelledby="share-title">
            <div className="mb-s3 flex flex-wrap items-center gap-s2">
              <span className="inline-flex min-h-11 items-center rounded-control border border-[var(--border-hairline)] px-s2 font-body text-caption uppercase text-ink">
                Shared view
              </span>
              <span className="mono-meta">{stamp(snapshot.createdAt)}</span>
            </div>
            <PageHeading
              title={snapshot.title ?? 'Sesi tanpa judul'}
              caption={snapshot.title ? undefined : 'Judul tidak tersedia pada snapshot ini.'}
            />
            <IdentityBlock identity={snapshot.identity} />
            <SectionRule className="mt-s4" />
          </section>

          {/* 2. Ringkasan eksekutif: tidak dirender bila kosong. */}
          {snapshot.summary && (
            <section aria-labelledby="share-summary">
              <h2 id="share-summary" className="mono-meta mb-s2">RINGKASAN EKSEKUTIF</h2>
              <p className="max-w-[72ch] font-body text-body leading-relaxed text-ink">{snapshot.summary}</p>
              <SectionRule className="mt-s4" />
            </section>
          )}

          {/* 3. Pertanyaan → jawaban */}
          <section aria-labelledby="share-transcript">
            <h2 id="share-transcript" className="mono-meta mb-s3">PERTANYAAN & JAWABAN</h2>
            <Transcript
              messages={snapshot.messages}
              citations={snapshot.citations}
              includeCitations={snapshot.includeCitations}
            />
            <SectionRule className="mt-s4" />
          </section>

          {/* 4. Hasil visual: 9 tipe adaptif, count-up dimatikan. */}
          <section aria-labelledby="share-results">
            <h2 id="share-results" className="mono-meta mb-s3">HASIL VISUAL</h2>
            <Results messages={snapshot.messages} onOpenCitation={openCitationDrawer} />
            <SectionRule className="mt-s4 min-[1440px]:hidden" />
          </section>
        </div>

        {/* 5. Sitasi: samping sticky di 1440, bawah di 1024, drawer di 390. */}
        {showCitations && (
          <div className="min-w-0 min-[1440px]:col-span-4 min-[1440px]:sticky min-[1440px]:top-s5 min-[1440px]:self-start">
            <h2 className="mono-meta mb-s3">SITASI</h2>
            <div className="hidden lg:block">
              <CitationPanels citations={snapshot.citations} />
            </div>
            <CitationDrawer
              citations={snapshot.citations}
              open={drawerOpen}
              onOpenChange={setDrawerOpen}
            />
          </div>
        )}
      </div>

      {/* 6. Footer: satu baris, satu tautan keluar. */}
      <footer className="mt-s5 flex flex-wrap items-center justify-between gap-s3 border-t border-[var(--border-hairline)] pt-s3">
        <div className="flex flex-wrap items-center gap-s3">
          <span className="font-body text-caption text-ink-72">dibagikan dari TanyaData</span>
          <Link href="/" className="touch-44 inline-flex items-center font-body text-caption font-semibold text-forest underline-offset-2 hover:underline focus-ring">
            Buka TanyaData
          </Link>
        </div>
        <span className="mono-meta">{stamp(snapshot.createdAt)}</span>
      </footer>
    </main>
  );
}
