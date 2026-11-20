'use client';

import { useState } from 'react';
import { AnnotatedText } from './share-citations';
import { MonoMeta } from '@/components/ui/mono-meta';
import type { ShareCitation, ShareMessage } from '@/lib/ui/share-contract';

function wibTime(iso: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date).replace(':', '.');
}

const OUTPUT_LABEL: Record<string, string> = {
  kpi: 'Angka tunggal', table: 'Tabel', line: 'Grafik garis', bar: 'Grafik batang',
  donut: 'Distribusi', quote: 'Kutipan', timeline: 'Linimasa',
  parameter_report: 'Laporan parameter', none: 'Jawaban teks',
};

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
  const usedCitations = message.citationIds
    .map((id) => citations.find((citation) => citation.id === id))
    .filter((citation): citation is ShareCitation => Boolean(citation));
  const answer = message.answer ?? '';
  const panelId = `bukti-${message.id}`;

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <MonoMeta>JAWABAN · {wibTime(message.createdAt)} WIB</MonoMeta>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls={panelId}
          className="inline-flex min-h-11 items-center gap-2 rounded-control font-body text-label-md font-semibold text-primary underline-offset-2 hover:underline focus-ring"
        >
          {open ? 'Sembunyikan bukti' : 'Tampilkan bukti'}
        </button>
      </div>
      <div
        id={panelId}
        className={`grid transition-[grid-template-rows] duration-[160ms] ease-[var(--ease-out-expo)] ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
      >
        <div className="overflow-hidden">
          <div className="rounded-card border border-border-hairline bg-surface p-4 sm:p-5">
            {message.meta?.source && (
              <MonoMeta className="mb-3 block">
                {message.meta.source}{message.meta.period ? ` · ${message.meta.period}` : ''}
              </MonoMeta>
            )}
            {message.guardrail ? (
              <>
                <p className="font-body text-body-lg leading-relaxed text-ink">
                  Informasi ini tidak ditemukan pada sumber yang tersedia
                </p>
                {message.guardrail.keywords.length > 0 && (
                  <p className="mt-2 font-body text-body-sm text-ink-muted-strong">
                    Kata kunci yang dicoba: {message.guardrail.keywords.join(', ')}
                  </p>
                )}
              </>
            ) : (
              <>
                <p className={`font-body text-body-lg leading-relaxed text-ink ${textExpanded ? '' : 'line-clamp-[12] lg:line-clamp-none'}`}>
                  <AnnotatedText text={answer} citations={citations} includeCitations={includeCitations} />
                </p>
                {answer.length > 900 && (
                  <button
                    type="button"
                    onClick={() => setTextExpanded((value) => !value)}
                    aria-expanded={textExpanded}
                    className="mt-2 inline-flex min-h-11 items-center font-body text-body-sm font-semibold text-primary underline-offset-2 hover:underline focus-ring lg:hidden"
                  >
                    {textExpanded ? 'Tutup' : 'Baca selengkapnya'}
                  </button>
                )}
              </>
            )}
            {message.outputs.length > 0 && (
              <p className="mt-3 border-t border-border-hairline pt-3 font-body text-body-sm text-ink-muted-strong">
                Output: {message.outputs.map((output) => OUTPUT_LABEL[output.type] ?? output.type).join(', ')}
              </p>
            )}
            {usedCitations.length > 0 && includeCitations && (
              <p className="mt-1 font-body text-body-sm text-ink-muted-strong">
                Sitasi: {usedCitations.map((citation) => `[${citation.id}]`).join(' ')}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Section 3 transcript read-only. Urutan DOM = urutan kronologis, tanpa nomor
 * urut rekaan, nama pengirim, atau avatar (M7). Motion: stagger 30ms × 8.
 */
export function ShareTranscript({
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
    <div className="flex flex-col gap-6">
      {messages.map((message, index) => (
        <div
          key={message.id}
          className="animate-share-stagger"
          style={{ animationDelay: `${Math.min(index, 7) * 30}ms` }}
        >
          {message.role === 'user' ? (
            <div className="min-w-0 rounded-card border border-border-hairline bg-canvas p-4 sm:p-5">
              <MonoMeta className="mb-2 block">PERTANYAAN · {wibTime(message.createdAt)} WIB</MonoMeta>
              <h3 className="max-w-[72ch] font-display text-headline-sm text-ink">
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
