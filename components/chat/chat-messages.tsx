'use client';

/**
 * Area pesan chat (components/chat/chat-messages.tsx).
 * Satu-satunya yang menggulir: container ref di-scroll ke bawah saat pesan
 * berubah — header, sidebar, dan composer tetap di tempat.
 */
import { useEffect, useRef, useState } from 'react';
import type { ChatMessage, SourceCitation } from '@/lib/contracts/http';
import { useI18n } from '@/lib/ui/i18n-provider';
import { normalizeChatOutputs } from '@/lib/ui/adaptive-output';
import { Icon } from '@/components/ui/icons';
import { StatusDot } from '@/components/signal/status-dot';
import { TextGenerate } from '@/components/signal/text-generate';
import { AdaptiveOutputView } from '@/components/signal/adaptive-output';
import { CitationMarks } from '@/components/signal/citation-marks';
import { NoDocumentsEmpty } from '@/components/ui/no-documents-empty';

const SUGGESTED = [
  { icon: 'pinvoke', text: 'Berapa total transaksi bulan ini?' },
  { icon: 'donut_small', text: 'Bagaimana distribusi status transaksi?' },
  { icon: 'trending_up', text: 'Mengapa tingkat kegagalan meningkat?' },
  { icon: 'description', text: 'Prosedur apa yang berlaku saat transaksi gagal?' },
];

function wibTime(iso: string): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(iso)).replace(':', '.');
}

function TypingIndicator() {
  return (
    <span className="inline-flex items-center gap-s2" role="status" aria-live="polite">
      <span className="inline-flex gap-s1" aria-hidden="true">
        {[0, 1, 2].map((i) => <span key={i} className="animate-typing-dot state-dot" style={{ animationDelay: `${i * 120}ms` }} />)}
      </span>
      <span className="font-body text-caption text-ink-72">Menyusun jawaban</span>
    </span>
  );
}

interface ChatMessagesProps {
  messages: ChatMessage[];
  docCount: number;
  /** null = meta masih dimuat/gagal; jangan klaim "kosong" sebelum tahu. */
  hasDocuments: boolean | null;
  detailLoading: boolean;
  detailError: string | null;
  sending: boolean;
  sendError: string | null;
  lastFailed: string | null;
  savingReportId: string | null;
  onFollowUp: (q: string) => void;
  onShare: (m: ChatMessage) => void;
  onSaveReport: (m: ChatMessage) => void;
  onRetry: () => void;
  onCopyQuestion: () => void;
  onOpenCitation: (c: SourceCitation) => void;
}

export function ChatMessages({
  messages, docCount, hasDocuments, detailLoading, detailError, sending, sendError, lastFailed,
  savingReportId, onFollowUp, onShare, onSaveReport, onRetry, onCopyQuestion, onOpenCitation,
}: ChatMessagesProps) {
  const { lang } = useI18n();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll area pesan (BUKAN halaman) ke pesan terbaru.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages.length, sending]);

  return (
    // relative: containing block untuk caption sr-only (position:absolute)
    // agar tidak lolos clipping dan membuah halaman melebihi viewport.
    <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-y-auto px-s3 py-s4">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-s4" role="log" aria-live="polite" aria-relevant="additions">
        {messages.length === 0 && !detailLoading && !sending && hasDocuments !== null && (
          hasDocuments ? (
            <div className="flex flex-col items-start gap-s4 py-s6">
              <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-forest-08">
                <Icon name="query_stats" className="text-[24px] text-forest" />
              </span>
              <div>
                <h2 className="font-display text-title text-ink">
                  {lang === 'id' ? 'Halo, ada yang bisa saya bantu analisis?' : 'Hi, what can I help you analyze?'}
                </h2>
                <p className="mt-s1 font-body text-body text-ink-72">
                  {lang === 'id'
                    ? `Ajukan pertanyaan tentang ${docCount} dokumen terindeks atau data transaksi. Setiap jawaban menyertakan sumbernya.`
                    : `Ask about ${docCount} indexed documents or transaction data. Every answer includes its sources.`}
                </p>
              </div>
              <div className="grid w-full grid-cols-1 gap-s2 sm:grid-cols-2">
                {SUGGESTED.map((item) => (
                  <button
                    key={item.text}
                    type="button"
                    onClick={() => onFollowUp(item.text)}
                    className="touch-44 flex items-center justify-between gap-s2 rounded-control border border-[var(--border-hairline)] bg-porcelain px-s3 text-left font-body text-caption text-ink transition-colors hover:border-forest focus-ring"
                  >
                    <span className="flex items-center gap-s2"><Icon name={item.icon} className="text-[16px] text-forest" />{item.text}</span>
                    <Icon name="arrow_forward" className="shrink-0 text-[16px] text-ink-72" />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            /* SEED_PROFILE=none: arahkan ke unggah, tanpa contoh pertanyaan
               tentang data yang belum ada (R-17/R-38). */
            <div className="py-s6">
              <NoDocumentsEmpty heading="Belum ada yang bisa ditanyakan" />
            </div>
          )
        )}

        {detailLoading && (
          <div className="space-y-s3" aria-busy="true"><div className="skeleton h-40 w-2/3" /><div className="skeleton h-80 w-full" /><div className="skeleton h-48 w-full" /></div>
        )}
        {detailError && (
          <div className="flex flex-col items-start gap-s2 rounded-control border border-[var(--border-hairline)] p-s3" role="alert">
            <span className="inline-flex items-center gap-s2"><StatusDot tone="error" /><span className="font-body text-body text-ink">{detailError}</span></span>
            <button type="button" onClick={onRetry} className="touch-44 rounded-control border border-forest px-s3 font-display text-label font-semibold text-forest focus-ring">Coba lagi</button>
          </div>
        )}

        {messages.map((m) => m.role === 'user' ? (
          <div key={m.id} className="flex items-start justify-end pl-s5">
            <div className="flex max-w-[85%] flex-col items-end gap-s1">
              <span className="mono-meta">{wibTime(m.createdAt)} WIB</span>
              <div className="rounded-card-lg rounded-br-control bg-forest px-s3 py-s2 text-porcelain">
                <p className="font-body text-body text-porcelain">{m.content}</p>
              </div>
            </div>
          </div>
        ) : (
          <article key={m.id} className="animate-phrase-in flex flex-col gap-s3">
            <div className="flex items-center gap-s2">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-forest-08" aria-hidden="true">
                <Icon name="query_stats" className="text-[14px] text-forest" />
              </span>
              <span className="mono-meta">{wibTime(m.createdAt)} WIB · {m.meta?.mode ?? 'jawaban'}</span>
            </div>
            <TextGenerate text={m.answer || m.content} state={m.guardrail ? 'empty' : 'default'} emptyTitle={m.guardrail?.explanation ?? 'Informasi ini tidak ditemukan pada sumber.'} citations={m.sources} onOpenCitation={onOpenCitation} />
            {m.guardrail && m.followUps && m.followUps.length > 0 && (
              <div className="flex flex-wrap gap-s2">
                {m.followUps.map((q) => <button key={q} type="button" onClick={() => onFollowUp(q)} className="touch-44 rounded-control border border-[var(--border-hairline)] px-s2 font-body text-caption text-ink hover:border-forest focus-ring">{q}</button>)}
              </div>
            )}
            {!m.guardrail && (
              <>
                {/* TRAP respons dobel: blok fallback 'none' memuat teks jawaban
                    yang SUDAH dirender TextGenerate di atas — buang duplikatnya.
                    Sisa blok visual (tabel/chart) hanya dirender bila ada. */}
                {(() => {
                  const outputs = normalizeChatOutputs(m).filter((o) => !(o.type === 'none' && o.text && o.text === (m.answer || m.content)));
                  if (!outputs.length) return null;
                  return <AdaptiveOutputView outputs={outputs} onOpenCitation={(id) => {
                    const sources = m.sources ?? [];
                    const found = sources.find((s) => `S${sources.indexOf(s) + 1}` === id);
                    if (found) onOpenCitation(found);
                  }} />;
                })()}
                {/* Marker inline [n] dalam jawaban sudah menunjuk sitasi;
                    daftar S1..S5 di bawah hanya tampil bila jawaban tanpa marker. */}
                {(!m.answer || !/\[\d+\]/.test(m.answer)) && (
                  <CitationMarks citations={m.sources ?? []} onOpen={onOpenCitation} />
                )}
                {m.followUps && m.followUps.length > 0 && (
                  <div className="flex flex-wrap gap-s2">
                    {m.followUps.map((q) => <button key={q} type="button" onClick={() => onFollowUp(q)} className="touch-44 rounded-control border border-[var(--border-hairline)] px-s2 font-body text-caption text-ink hover:border-forest focus-ring">{q}</button>)}
                  </div>
                )}
                {/* Aksi per jawaban: ikon ramping (tidak menutupi konten),
                    tooltip menjelaskan fungsi. */}
                <div className="flex items-center gap-s1">
                  <button type="button" onClick={() => onShare(m)} aria-label="Bagikan jawaban" title="Bagikan jawaban" className="touch-44 flex items-center justify-center rounded-control text-ink-72 transition-colors hover:bg-forest-08 hover:text-forest focus-ring">
                    <Icon name="ios_share" className="text-[16px]" />
                  </button>
                  <button type="button" onClick={() => onSaveReport(m)} disabled={savingReportId === m.id} aria-label="Simpan sebagai laporan" title="Simpan sebagai laporan" className="touch-44 flex items-center justify-center rounded-control text-ink-72 transition-colors hover:bg-forest-08 hover:text-forest focus-ring disabled:opacity-50">
                    <Icon name="save" className="text-[16px]" />
                  </button>
                </div>
              </>
            )}
          </article>
        ))}
        {sending && <TypingIndicator />}
        {sendError && (
          <div className="flex flex-col items-start gap-s2 rounded-control border border-[var(--border-hairline)] p-s3" role="alert">
            <span className="inline-flex items-center gap-s2"><StatusDot tone="error" /><span className="font-body text-body text-ink">{sendError}</span></span>
            <div className="flex flex-wrap gap-s2">
              {lastFailed && <><button type="button" onClick={onRetry} className="touch-44 rounded-control border border-forest px-s3 font-display text-label font-semibold text-forest focus-ring">Coba lagi</button><button type="button" onClick={onCopyQuestion} className="touch-44 rounded-control px-s3 font-display text-label text-ink-72 focus-ring">Salin pertanyaan</button></>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
