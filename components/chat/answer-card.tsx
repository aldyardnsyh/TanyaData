'use client';

import { useId, useState } from 'react';
import type { ChatMessage, ChatVisualHint, SourceCitation, Visualization } from '@/lib/contracts/http';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { Icon } from '@/components/ui/icons';
import { IconTooltip } from '@/components/ui/icon-tooltip';
import { MonoMeta } from '@/components/ui/mono-meta';
import { StatusDot } from '@/components/ui/status-dot';
import { formatIdr, formatNumber, formatPercent } from '@/lib/ui/format';
import { toast } from '@/components/ui/toaster';

function fmtCell(value: string | number | null, format?: string): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value;
  if (format === 'currency') return formatIdr(value);
  if (format === 'percent') return formatPercent(value);
  if (format === 'number') return formatNumber(value);
  return String(value);
}

const BAR_COLORS = ['bg-primary', 'bg-primary-dim', 'bg-border-control', 'bg-signal-lime', 'bg-signal-terracotta'];

type HintRow = Record<string, string | number | null>;

/** Kunci kolom mentah (snake_case dari SQL/adapter) jadi label yang terbaca. */
function humanizeKey(key: string): string {
  return key.replace(/[_-]+/g, ' ').trim().replace(/\b\w/g, (c) => c.toUpperCase());
}

function fmtHintCell(value: string | number | null): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'number') return formatNumber(value);
  return value;
}

/**
 * ADAPT-4a — penyajian adaptif per `meta.outputShape`.
 * Purpose-Gate: setiap blok menyajikan angka/kutipan yang SUDAH ada di payload
 * (`visualHint.rows` source=execution, atau bukti sitasi source=citations);
 * tidak ada nilai yang dihitung atau dikarang di UI. Respons lama tanpa field
 * baru tidak pernah masuk ke blok ini (gracing, jalur lama tak berubah).
 */

/** finance_narrative + visualHint: tabel/bar dari eksekusi, kutipan dari bukti. */
function AdaptiveFinanceVisual({ hint, documents }: { hint: ChatVisualHint; documents: SourceCitation[] }) {
  const rows = hint.rows ?? [];
  if (hint.source === 'citations') {
    if (documents.length === 0) return null;
    return (
      <div className="space-y-s2">
        <MonoMeta className="block">KUTIPAN BUKTI</MonoMeta>
        {documents.slice(0, 4).map((src, i) => (
          <blockquote key={`${src.sourceId}-${i}`} className="rounded-card border border-border-hairline bg-surface p-3">
            <p className="font-body text-body leading-relaxed text-ink">{src.quote ?? src.section ?? '—'}</p>
            <MonoMeta className="mt-s1 block">{src.docTitle ?? src.sourceId}{src.page != null ? ` · hlm ${src.page}` : ''}{src.section ? ` · ${src.section}` : ''}</MonoMeta>
          </blockquote>
        ))}
      </div>
    );
  }
  if (hint.source !== 'execution' || rows.length === 0 || !hint.columns || hint.columns.length === 0) return null;
  if (hint.kind === 'series' && hint.x_key && hint.y_keys && hint.y_keys.length > 0) {
    const xKey = hint.x_key;
    const yKey = hint.y_keys[0]!;
    const values = rows.map((r) => (typeof r[yKey] === 'number' ? (r[yKey] as number) : 0));
    const max = Math.max(1, ...values.map((v) => Math.abs(v)));
    return (
      <div className="rounded-card border border-border-hairline bg-surface p-4">
        <h4 className="mb-s3 font-body text-headline-sm text-ink">{hint.title ?? humanizeKey(yKey)}</h4>
        <div className="space-y-s2">
          {rows.map((row, i) => {
            const label = String(row[xKey] ?? '');
            const value = values[i]!;
            return (
              <div key={`${label}-${i}`} className="space-y-s1">
                <div className="flex items-center justify-between gap-s2 font-body text-body-sm">
                  <span className="min-w-0 truncate text-ink">{label}</span>
                  <span className="shrink-0 tabular text-ink">{formatNumber(value)}</span>
                </div>
                <div className="h-s2 w-full overflow-hidden rounded-control bg-row-hover">
                  <div className="h-full bg-primary" style={{ width: `${Math.max(2, (Math.abs(value) / max) * 100)}%` }} />
                </div>
              </div>
            );
          })}
        </div>
        {hint.note && <p className="mt-s2 font-body text-body-sm text-ink-muted-strong">{hint.note}</p>}
      </div>
    );
  }
  const columns: DataTableColumn<HintRow>[] = hint.columns.map((key) => {
    const allNumeric = rows.every((r) => r[key] == null || typeof r[key] === 'number');
    return { key, label: humanizeKey(key), align: allNumeric ? 'right' : 'left', format: (v) => fmtHintCell(v as string | number | null) };
  });
  return (
    <div className="rounded-card border border-border-hairline bg-surface p-4">
      {hint.title && <MonoMeta className="mb-s2 block">{hint.title.toUpperCase()}</MonoMeta>}
      <DataTable columns={columns} rows={rows} emptyTitle="Tidak ada baris pada hasil eksekusi." />
      {hint.note && <p className="mt-s2 font-body text-body-sm text-ink-muted-strong">{hint.note}</p>}
    </div>
  );
}

/** sop_prose: rujukan bagian/pasal, hanya yang ada di bukti sitasi. */
function AdaptiveSopReferences({ hint, documents }: { hint: ChatVisualHint; documents: SourceCitation[] }) {
  const refs = hint.references ?? [];
  if (refs.length === 0 || documents.length === 0) return null;
  const evidence = documents.map((s) => `${s.section ?? ''} ${s.quote ?? ''}`.toLowerCase().trim());
  const shown = refs.filter((r) => {
    if (!r.section) return false;
    const needle = r.section.toLowerCase();
    return evidence.some((e) => e.includes(needle) || (e.length > 0 && needle.includes(e)));
  });
  if (shown.length === 0) return null;
  return (
    <div className="rounded-card border border-border-hairline bg-surface p-4">
      <MonoMeta className="mb-s2 block">RUJUKAN PASAL / BAGIAN</MonoMeta>
      <ul className="space-y-s1">
        {shown.map((r, i) => (
          <li key={`${r.section}-${i}`} className="flex items-baseline justify-between gap-s2 font-body text-body-sm">
            <span className="min-w-0 text-ink">{r.section}</span>
            {r.page != null && <span className="shrink-0 font-mono text-[11px] uppercase text-ink-muted-strong">hlm {r.page}</span>}
          </li>
        ))}
      </ul>
      {hint.note && <p className="mt-s2 font-body text-body-sm text-ink-muted-strong">{hint.note}</p>}
    </div>
  );
}

/** technical_digest: nilai/kolom/istilah ringkas, monospace untuk nilai. */
function AdaptiveTechnicalDigest({ hint }: { hint: ChatVisualHint }) {
  const rows = hint.rows ?? [];
  if (rows.length === 0) return null;
  return (
    <div className="rounded-card border border-border-hairline bg-surface p-4">
      {hint.title && <MonoMeta className="mb-s2 block">{hint.title.toUpperCase()}</MonoMeta>}
      <div className="space-y-s2">
        {rows.slice(0, 12).map((row, i) => (
          <div key={i} className="rounded-control border border-border-hairline bg-canvas p-s2">
            <dl className="space-y-s1">
              {Object.entries(row).map(([k, v]) => (
                <div key={k} className="flex items-baseline justify-between gap-s3">
                  <dt className="shrink-0 font-body text-body-sm text-ink-muted-strong">{humanizeKey(k)}</dt>
                  <dd className="min-w-0 break-words text-right font-mono text-body-sm text-ink">{v == null ? '—' : String(v)}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
      {hint.note && <p className="mt-s2 font-body text-body-sm text-ink-muted-strong">{hint.note}</p>}
    </div>
  );
}

/** identity_fields: pasangan field-value dari visualHint.rows. */
function AdaptiveIdentityFields({ hint }: { hint: ChatVisualHint }) {
  const rows = hint.rows ?? [];
  if (rows.length === 0) return null;
  const fields = Object.entries(rows[0]!);
  if (fields.length === 0) return null;
  return (
    <div className="rounded-card border border-border-hairline bg-surface p-4">
      {hint.title && <MonoMeta className="mb-s2 block">{hint.title.toUpperCase()}</MonoMeta>}
      <dl className="grid grid-cols-1 gap-x-s4 sm:grid-cols-2">
        {fields.map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-s2 border-b border-border-hairline py-s2 last:border-b-0">
            <dt className="shrink-0 font-body text-body-sm text-ink-muted-strong">{humanizeKey(k)}</dt>
            <dd className="min-w-0 break-words text-right font-body text-body-md tabular text-ink">{v == null ? '—' : String(v)}</dd>
          </div>
        ))}
      </dl>
      {hint.note && <p className="mt-s2 font-body text-body-sm text-ink-muted-strong">{hint.note}</p>}
    </div>
  );
}

/** Audit P0: follow-up guardrail mengarah ke klarifikasi, bukan topik kanal baru. */
const GUARDRAIL_FOLLOW_UPS: Record<'id' | 'en', { label: string; question: string }[]> = {
  id: [
    { label: 'Lihat daftar kode kegagalan', question: 'Apa saja kode kegagalan transaksi dan artinya?' },
    { label: 'Tanya metrik transaksi', question: 'Berapa total transaksi bulan ini?' },
    { label: 'Lihat dokumen prosedur', question: 'Apa prosedur penanganan transaksi gagal?' },
  ],
  en: [
    { label: 'List failure codes', question: 'What are the transaction failure codes and their meanings?' },
    { label: 'Ask about metrics', question: 'What is the total transaction volume this month?' },
    { label: 'Open procedure docs', question: 'What is the failed-transaction procedure?' },
  ],
};

function wibTime(iso: string): string {
  return new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso)).replace(':', '.');
}

function MetricGrid({ viz, findings }: { viz: Visualization; findings: string[] }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {viz.rows.map((row, i) => {
        const label = String(row[viz.xKey] ?? '');
        const raw = row[viz.dataKey];
        const value = typeof raw === 'number' ? raw : null;
        const shown = viz.format === 'currency' ? formatIdr(value) : viz.format === 'percent' ? formatPercent(value) : formatNumber(value);
        return (
          <div key={`${label}-${i}`} className="rounded-card border border-border-hairline bg-surface p-4">
            <p className="font-body text-label-sm uppercase text-ink-muted-strong">{label}</p>
            <p className="mt-2 font-body text-metric-display tabular text-ink">{shown}</p>
            {findings[i] && <p className="mt-2 font-body text-body-sm text-ink-muted-strong">{findings[i]}</p>}
          </div>
        );
      })}
    </div>
  );
}

function ChannelBars({ viz, periodLabel }: { viz: Visualization; periodLabel: string }) {
  const rows = viz.rows ?? [];
  const values = rows.map((r) => (typeof r[viz.dataKey] === 'number' ? (r[viz.dataKey] as number) : 0));
  const total = values.reduce((acc, v) => acc + v, 0);
  return (
    <div className="rounded-card border border-border-hairline bg-surface p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-body text-headline-sm text-ink">{viz.title}</h4>
        <MonoMeta>{periodLabel}</MonoMeta>
      </div>
      <div className="space-y-3">
        {rows.map((row, i) => {
          const label = String(row[viz.xKey] ?? '');
          const value = values[i];
          const share = viz.format === 'percent' ? value : total > 0 ? (value / total) * 100 : 0;
          return (
            <div key={`${label}-${i}`} className="space-y-1">
              <div className="flex items-center justify-between gap-2 font-body text-body-sm">
                <span className="inline-flex min-w-0 items-center gap-2 text-ink"><span className={`state-dot shrink-0 ${BAR_COLORS[i % BAR_COLORS.length]}`} aria-hidden="true" /><span className="truncate">{label}</span></span>
                <span className="shrink-0 tabular text-ink">{formatPercent(share)} <span className="text-ink-muted-strong">({formatNumber(value)})</span></span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-control bg-row-hover">
                <div className={`h-full ${BAR_COLORS[i % BAR_COLORS.length]}`} style={{ width: `${Math.max(0, Math.min(100, share))}%` }} />
              </div>
            </div>
          );
        })}
        {rows.length === 0 && <p className="font-body text-body-sm text-ink-muted-strong">Tidak ada data visualisasi.</p>}
      </div>
    </div>
  );
}

function SourceCard({ src, onOpen }: { src: SourceCitation; onOpen?: (src: SourceCitation) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen?.(src)}
      className="flex min-h-11 flex-col justify-between gap-2 rounded-card border border-border-hairline bg-surface p-3 text-left transition-colors hover:border-primary focus-ring"
    >
      <span className="flex items-start gap-2">
        <Icon name={src.docTitle?.toLowerCase().endsWith('.pdf') ? 'picture_as_pdf' : 'description'} className="shrink-0 text-[20px] text-primary" aria-hidden="true" />
        <span className="min-w-0">
          <span className="block truncate font-body text-body-md font-semibold text-ink">{src.docTitle ?? src.sourceId}</span>
          <span className="mt-0.5 block font-body text-body-sm text-ink-muted-strong">{src.quote ?? src.section ?? '—'}</span>
        </span>
      </span>
      <span className="flex items-center justify-between font-body text-body-sm text-primary">
        {src.page != null ? `Halaman ${src.page}` : src.section ?? 'Sumber'}
        <Icon name="open_in_new" className="text-[16px]" aria-hidden="true" />
      </span>
    </button>
  );
}

export interface AnswerCardProps {
  message: ChatMessage;
  modeLabel?: string;
  onFollowUp?: (question: string) => void;
  /** Membuka dialog konfirmasi share. Tidak ada auto-share (SHARE_PAGE_SPEC §8). */
  onCreateShare?: (msg: ChatMessage) => void;
  onSaveReport?: (msg: ChatMessage) => void;
  savingReport?: boolean;
  onOpenSource?: (src: SourceCitation) => void;
  disabled?: boolean;
  lang?: 'id' | 'en';
}

/** §5.8 + motion #5: pesan masuk 180ms + 4px, bukti stagger 30ms maks 8. */
export function AnswerCard({
  message, modeLabel = 'SQLite · SQL + FTS5', onFollowUp, onCreateShare, onSaveReport, savingReport, onOpenSource, disabled, lang = 'id',
}: AnswerCardProps) {
  const [sqlOpen, setSqlOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const sqlPanelId = useId();

  const meta = message.meta;
  const guardrail = message.guardrail;
  const periodLabel = meta?.period?.label ?? '—';
  const findings = (message.keyFindings ?? []).map((kf) => kf.text);
  const kpiViz = (message.visualizations ?? []).find((v) => v.type === 'kpi');
  const otherViz = (message.visualizations ?? []).filter((v) => v.type !== 'kpi');
  const documents = (message.sources ?? []).filter((s) => s.kind === 'document');
  const datasetSources = (message.sources ?? []).filter((s) => s.kind === 'dataset');
  const followUps = guardrail
    ? GUARDRAIL_FOLLOW_UPS[lang]
    : (message.followUps ?? []).map((q) => ({ label: q, question: q }));

  const copyText = async (text: string, success: string) => {
    try { await navigator.clipboard.writeText(text); toast({ status: 'success', message: success }); }
    catch { toast({ status: 'error', message: 'Teks gagal disalin.' }); }
  };

  const copySql = async () => {
    if (!message.sql) return;
    await copyText(message.sql.query, 'SQL disalin.');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <MonoMeta>JAWABAN · {wibTime(message.createdAt)} WIB</MonoMeta>
          <StatusDot state="neutral" label={modeLabel} mono />
        </div>
        <div className="flex items-center gap-1">
          <IconTooltip label="Salin">
            <button type="button" aria-label="Salin jawaban" onClick={() => void copyText(message.answer ?? message.content, 'Jawaban disalin.')} className="flex h-11 w-11 min-h-11 min-w-11 items-center justify-center rounded-control text-ink-muted-strong hover:bg-row-hover focus-ring"><Icon name="content_copy" className="text-[16px]" aria-hidden="true" /></button>
          </IconTooltip>
          {onCreateShare && (
            <IconTooltip label="Bagikan">
              <button type="button" aria-label="Bagikan sesi" onClick={() => onCreateShare(message)} className="flex h-11 w-11 min-h-11 min-w-11 items-center justify-center rounded-control text-ink-muted-strong hover:bg-row-hover focus-ring"><Icon name="link" className="text-[16px]" aria-hidden="true" /></button>
            </IconTooltip>
          )}
          {onSaveReport && (
            <IconTooltip label="Simpan sebagai laporan">
              <button type="button" aria-label="Simpan sebagai laporan" disabled={disabled || savingReport} onClick={() => onSaveReport(message)} className="flex h-11 w-11 min-h-11 min-w-11 items-center justify-center rounded-control text-ink-muted-strong hover:bg-row-hover focus-ring disabled:opacity-45"><Icon name="save" className="text-[16px]" aria-hidden="true" /></button>
            </IconTooltip>
          )}
        </div>
      </div>

      {guardrail && (
        <div className="animate-message-in rounded-card border border-signal-terracotta bg-surface p-4">
          <StatusDot state="error" label="Di luar cakupan data" />
          <p className="mt-3 font-body text-body-lg text-ink">{message.answer ?? message.content}</p>
          <p className="mt-2 font-body text-body-sm text-ink-muted-strong">{guardrail.explanation}</p>
        </div>
      )}

      {!guardrail && (message.answer || message.content) && (
        <div className="animate-message-in rounded-card border border-border-hairline bg-surface p-4">
          <div className="measurement-rule -mx-4 -mt-4 mb-4 px-4 pb-3 pt-4">
            <MonoMeta>RINGKASAN · {meta?.mode ?? 'SQL'}{meta?.partial ? ' · SEBAGIAN' : ''}</MonoMeta>
          </div>
          <p className="font-body text-body-lg leading-relaxed text-ink">{message.answer ?? message.content}</p>
        </div>
      )}

      {/* ADAPT-4a: blok penyajian adaptif. Hanya aktif bila meta punya
          outputShape baru; respons lama (gracing) melewatinya tanpa perubahan. */}
      {!guardrail && meta?.outputShape && meta.outputShape !== 'general_text' && (
        <div className="animate-message-in space-y-s3" style={{ animationDelay: '45ms' }}>
          {meta.outputShape === 'finance_narrative' && meta.visualHint && (
            <AdaptiveFinanceVisual hint={meta.visualHint} documents={documents} />
          )}
          {meta.outputShape === 'sop_prose' && meta.visualHint && (
            <AdaptiveSopReferences hint={meta.visualHint} documents={documents} />
          )}
          {meta.outputShape === 'technical_digest' && meta.visualHint && (
            <AdaptiveTechnicalDigest hint={meta.visualHint} />
          )}
          {meta.outputShape === 'identity_fields' && meta.visualHint && (
            <AdaptiveIdentityFields hint={meta.visualHint} />
          )}
        </div>
      )}

      {kpiViz && kpiViz.rows.length > 0 && (
        <div className="animate-message-in" style={{ animationDelay: '30ms' }}><MetricGrid viz={kpiViz} findings={findings} /></div>
      )}

      {message.supportingTable && message.supportingTable.rows.length > 0 && (
        <div className="animate-message-in rounded-card border border-border-hairline bg-surface p-4" style={{ animationDelay: '60ms' }}>
          <MonoMeta className="mb-3 block">DATA PENDUKUNG</MonoMeta>
          <DataTable columns={message.supportingTable.columns.map<DataTableColumn<Record<string, string | number | null>>>((c) => ({ key: c.key, label: c.label, align: c.align, format: (v) => fmtCell(v as string | number | null, c.format) }))} rows={message.supportingTable.rows} emptyTitle="Tidak ada data pendukung" />
          {message.supportingTable.truncated && <p className="mt-2 font-body text-body-sm text-ink-muted-strong">Menampilkan {formatNumber(message.supportingTable.rows.length)} dari {formatNumber(message.supportingTable.totalRows)} baris.</p>}
        </div>
      )}

      {otherViz.length > 0 && (
        <div className="space-y-4">
          {otherViz.map((viz, i) => (
            <div key={viz.id} className="animate-message-in" style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }}>
              {viz.type === 'bar' ? <ChannelBars viz={viz} periodLabel={periodLabel} /> : (
                <div className="rounded-card border border-border-hairline bg-surface p-4">
                  <h4 className="mb-4 font-body text-headline-sm text-ink">{viz.title}</h4>
                  <ul className="space-y-s2">
                    {viz.rows.map((row, rowIndex) => {
                      const label = String(row[viz.xKey] ?? '');
                      const raw = row[viz.dataKey];
                      const shown = typeof raw === 'number'
                        ? viz.format === 'currency' ? formatIdr(raw) : viz.format === 'percent' ? formatPercent(raw) : formatNumber(raw)
                        : '—';
                      return (
                        <li key={`${label}-${rowIndex}`} className="flex items-center justify-between gap-s3 border-b border-border-hairline pb-s2 last:border-b-0">
                          <span className="font-body text-body text-ink">{label}</span>
                          <span className="font-body text-body tabular text-ink">{shown}</span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {message.sql && !guardrail && (
        <div className="overflow-hidden rounded-card border border-border-hairline bg-surface">
          <button type="button" onClick={() => setSqlOpen((o) => !o)} aria-expanded={sqlOpen} aria-controls={sqlPanelId} className="flex min-h-11 w-full items-center justify-between gap-2 bg-canvas px-4 text-left focus-ring">
            <span className="inline-flex items-center gap-2"><Icon name="terminal" className="text-[16px] text-primary" aria-hidden="true" /><MonoMeta>LIHAT SQL · {formatNumber(message.sql.durationMs)} MS · {formatNumber(message.sql.rowCount)} BARIS</MonoMeta></span>
            <Icon name="expand_more" className={`text-[18px] text-ink-muted-strong transition-transform duration-[var(--motion-fast)] ${sqlOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
          </button>
          <div id={sqlPanelId} className={`grid transition-[grid-template-rows] duration-[160ms] ease-[var(--ease-out-quart)] ${sqlOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
            <div className="overflow-hidden">
              <div className="space-y-2 p-4">
                <div className="flex items-center justify-between gap-2">
                  <MonoMeta>{meta?.dataset.name ?? 'dataset'}</MonoMeta>
                  <button type="button" onClick={() => void copySql()} tabIndex={sqlOpen ? 0 : -1} className="inline-flex min-h-11 items-center gap-1 font-body text-body-sm font-semibold text-primary focus-ring"><Icon name="content_copy" className="text-[14px]" aria-hidden="true" /> {copied ? 'Tersalin' : 'Salin SQL'}</button>
                </div>
                <pre className="overflow-x-auto rounded-control border border-border-hairline bg-canvas p-3 font-mono text-body-sm leading-relaxed text-ink"><code>{message.sql.query}</code></pre>
                {message.sql.error && <p className="font-body text-body-sm text-error-text">{message.sql.error}</p>}
              </div>
            </div>
          </div>
        </div>
      )}

      {datasetSources.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <MonoMeta>BUKTI DATASET</MonoMeta>
          {datasetSources.map((s, i) => (
            <span key={`${s.sourceId}-${i}`} className="inline-flex max-w-full items-center gap-1 rounded-control border border-border-hairline px-2 py-1 font-mono text-body-sm text-primary" title={s.sql ?? s.period ?? s.table ?? s.sourceId}>
              <Icon name="table_chart" className="shrink-0 text-[14px]" aria-hidden="true" />
              <span className="truncate">{s.table ?? s.sourceId}{s.period ? ` · ${s.period}` : ''}</span>
            </span>
          ))}
        </div>
      )}

      {documents.length > 0 && (
        <div className="space-y-2">
          <MonoMeta className="block">SITASI DOKUMEN</MonoMeta>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {documents.map((src, i) => <SourceCard key={`${src.sourceId}-${i}`} src={src} onOpen={onOpenSource} />)}
          </div>
        </div>
      )}

      {/* Audit: metadata teknis (SQL, row count) hanya untuk jawaban bertipe SQL. */}
      {meta && !guardrail && (
        <MonoMeta>{meta.period ? `${meta.period.label} · ` : ''}{formatNumber(meta.rowCount)} BARIS · {meta.mode}{meta.fallbackReason ? ' · JAWABAN DETERMINISTIK' : ''}</MonoMeta>
      )}

      {followUps.length > 0 && onFollowUp && (
        <div className="space-y-2 pt-1">
          <MonoMeta className="block">PERTANYAAN LANJUTAN</MonoMeta>
          <div className="flex flex-wrap gap-2">
            {followUps.slice(0, 8).map((item, i) => (
              <button key={item.label} type="button" disabled={disabled} onClick={() => onFollowUp(item.question)} className="animate-message-in min-h-11 rounded-control border border-border-control px-3 font-body text-body-sm text-ink transition-colors hover:border-primary focus-ring disabled:opacity-45" style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }}>{item.label}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
