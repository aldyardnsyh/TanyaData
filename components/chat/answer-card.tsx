'use client';

import { useState, useId } from 'react';
import { ChevronDown, Copy, Check, Database, FileText } from 'lucide-react';
import type { ChatMessage, SourceCitation } from '@/lib/contracts/http';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { Button } from '@/components/ui/button';
import { VisualizationView } from './visualization-view';
import { formatIdr, formatNumber, formatPercent } from '@/lib/ui/format';
import { useI18n } from '@/lib/ui/i18n-provider';
import type { DictionaryKey } from '@/lib/i18n/dictionary';
import { toast } from '@/components/ui/toaster';

function fmtCell(value: string | number | null, format?: string): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value;
  if (format === 'currency') return formatIdr(value);
  if (format === 'percent') return formatPercent(value);
  if (format === 'number') return formatNumber(value);
  return String(value);
}

function SourceChip({ src }: { src: SourceCitation }) {
  if (src.kind === 'dataset') {
    return (
      <span className="inline-flex max-w-full items-center gap-1 rounded-sm bg-surface-container-low px-1.5 py-0.5 font-mono text-label-sm text-primary">
        <Database className="h-3 w-3 shrink-0" aria-hidden="true" />
        <span className="truncate">{src.table ?? src.sourceId}{src.period ? ` · ${src.period}` : ''}</span>
      </span>
    );
  }
  const label = src.docTitle ?? src.sourceId;
  const meta = [src.section ? `Bagian ${src.sectionNo ?? ''} ${src.section}`.trim() : null, src.page ? `hlm ${src.page}` : null]
    .filter(Boolean)
    .join(' · ');
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-sm bg-surface-container-low px-1.5 py-0.5 font-body text-label-sm text-on-surface" title={src.quote}>
      <FileText className="h-3 w-3 shrink-0 text-tertiary" aria-hidden="true" />
      <span className="truncate">{label}</span>
      {meta && <span className="shrink-0 text-on-surface-variant">{meta}</span>}
    </span>
  );
}

export interface AnswerCardProps {
  message: ChatMessage;
  onSaveReport?: (msg: ChatMessage) => void;
  savingReport?: boolean;
  onFollowUp?: (question: string) => void;
  disabled?: boolean;
}

export function AnswerCard({ message, onSaveReport, savingReport, onFollowUp, disabled }: AnswerCardProps) {
  const { t } = useI18n();
  const [sqlOpen, setSqlOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const sqlPanelId = useId();

  const hasEvidence = (message.sources?.length ?? 0) > 0 || !!message.sql;
  const guardrail = message.guardrail;
  const meta = message.meta;

  const copySql = async () => {
    if (!message.sql) return;
    try {
      await navigator.clipboard.writeText(message.sql.query);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ status: 'error', message: 'Gagal menyalin SQL.' });
    }
  };

  return (
    <div className="space-y-3">
      {/* Guardrail */}
      {guardrail && (
        <div className="rounded-md border border-outline-variant bg-surface-container-low p-3">
          <p className="font-body text-label-md font-semibold text-on-surface">Di luar cakupan data</p>
          <p className="mt-1 font-body text-body-md text-on-surface-variant">
            {t(`guardrail.${guardrail.type}` as DictionaryKey)}
          </p>
          <p className="mt-1 font-body text-body-sm text-on-surface-variant">{guardrail.explanation}</p>
        </div>
      )}

      {/* Direct answer */}
      {message.answer && (
        <p className="font-body text-body-lg leading-relaxed text-on-surface">{message.answer}</p>
      )}
      {!message.answer && message.content && (
        <p className="font-body text-body-lg leading-relaxed text-on-surface">{message.content}</p>
      )}

      {/* Purpose Gate: bukti (finding/table/viz/sumber) masuk bertingkat 30ms, maks 8 item —
          mengikuti urutan baca tanpa menunda teks jawaban utama (§3.1/§3.2). */}
      {/* Key findings */}
      {message.keyFindings && message.keyFindings.length > 0 && (
        <ul className="space-y-1.5" aria-label={t('label.keyFindings')}>
          {message.keyFindings.map((kf, i) => (
            <li
              key={i}
              className="flex animate-[stagger-in_180ms_var(--ease-out-quart)_both] items-start gap-2 font-body text-body-md text-on-surface"
              style={{ animationDelay: `${Math.min(i, 7) * 30}ms` }}
            >
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
              <span>{kf.text}</span>
            </li>
          ))}
        </ul>
      )}

      {/* Supporting table */}
      {message.supportingTable && message.supportingTable.rows.length > 0 && (
        <div className="animate-[stagger-in_180ms_var(--ease-out-quart)_both] [animation-delay:60ms]">
          <p className="mb-1 font-body text-label-sm uppercase tracking-wider text-on-surface-variant">{t('label.supportingData')}</p>
          <DataTable
            columns={message.supportingTable.columns.map<DataTableColumn<Record<string, string | number | null>>>((c) => ({
              key: c.key,
              label: c.label,
              align: c.align,
              format: (v) => fmtCell(v as string | number | null, c.format),
            }))}
            rows={message.supportingTable.rows}
            emptyTitle={t('empty.noData')}
          />
          {message.supportingTable.truncated && (
            <p className="mt-1 font-body text-body-sm text-on-surface-variant">
              Menampilkan {message.supportingTable.rows.length} dari {formatNumber(message.supportingTable.totalRows)} {t('label.rows')}.
            </p>
          )}
        </div>
      )}

      {/* Visualizations */}
      {message.visualizations && message.visualizations.length > 0 && (
        <div className="animate-[stagger-in_180ms_var(--ease-out-quart)_both] [animation-delay:90ms] space-y-3">
          {message.visualizations.map((v) => (
            <VisualizationView key={v.id} viz={v} />
          ))}
        </div>
      )}

      {/* Sources */}
      {message.sources && message.sources.length > 0 && (
        <div className="flex animate-[stagger-in_180ms_var(--ease-out-quart)_both] flex-wrap items-center gap-1.5 [animation-delay:120ms]" aria-label={t('label.sources')}>
          <span className="font-body text-label-sm uppercase tracking-wider text-on-surface-variant">{t('label.sources')}:</span>
          {message.sources.map((s, i) => (
            <SourceChip key={`${s.sourceId}-${i}`} src={s} />
          ))}
        </div>
      )}

      {/* SQL disclosure */}
      {message.sql && (
        <div className="overflow-hidden rounded-md border border-outline-variant">
          <button
            type="button"
            onClick={() => setSqlOpen((o) => !o)}
            aria-expanded={sqlOpen}
            aria-controls={sqlPanelId}
            className="flex w-full items-center justify-between bg-surface-container-low px-3 py-2 text-left font-body text-label-md text-on-surface transition-colors duration-[var(--motion-fast)] hover:bg-surface-container focus-ring"
          >
              <span className="flex items-center gap-2">
                <span className="font-mono text-label-sm text-primary">SQL</span>
                {formatNumber(message.sql.rowCount)} {t('label.rows')} ·
                <abbr title="Diukur sekali saat permintaan ini" className="cursor-help no-underline">SQL {message.sql.durationMs} ms</abbr>
              </span>
            <ChevronDown className={`h-4 w-4 text-on-surface-variant transition-transform duration-[160ms] ${sqlOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
          </button>
          {/* C-13: grid-rows 0fr→1fr, 160ms — tinggi beranimasi, bukan lompat (§4.11). */}
          <div
            id={sqlPanelId}
            className={`grid transition-[grid-template-rows] duration-[160ms] ease-[var(--ease-out-quart)] ${sqlOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
          >
            <div className="overflow-hidden">
              <div className="bg-surface-container-highest p-3">
                <div className="mb-2 flex justify-end">
                  <Button size="sm" variant="ghost" onClick={copySql} tabIndex={sqlOpen ? 0 : -1}>
                    {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    {copied ? 'Tersalin' : 'Salin SQL'}
                  </Button>
                </div>
                <pre className="overflow-x-auto rounded-sm bg-inverse-surface p-3 font-mono text-[12.5px] leading-5 text-inverse-on-surface">
                  <code>{message.sql.query}</code>
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Meta */}
      {meta && (
        <p className="font-body text-body-sm text-on-surface-variant">
          {meta.period ? `${meta.period.label}${meta.partial ? ' · parsial' : ''} · ` : ''}
          {formatNumber(meta.rowCount)} {t('label.rows')} · {meta.mode} ·
          <abbr title="Diukur sekali saat permintaan ini" className="cursor-help">Pemrosesan {meta.latencyMs} ms</abbr>
          {meta.fallbackReason ? ' · jawaban deterministik' : ''}
        </p>
      )}

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        {hasEvidence && onSaveReport && (
          <Button size="sm" variant="secondary" loading={savingReport} disabled={disabled} onClick={() => onSaveReport(message)}>
            Simpan sebagai laporan
          </Button>
        )}
      </div>

      {/* Follow-ups */}
      {message.followUps && message.followUps.length > 0 && onFollowUp && (
        <div className="flex flex-wrap gap-2 pt-1" aria-label={t('label.followUps')}>
          {message.followUps.map((q) => (
            <button
              key={q}
              type="button"
              disabled={disabled}
              onClick={() => onFollowUp(q)}
              className="rounded-full border border-outline-variant bg-surface-container-lowest px-3 py-1.5 font-body text-label-md text-on-surface transition-colors duration-[var(--motion-fast)] hover:bg-surface-container disabled:opacity-45 focus-ring"
            >
              {q}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
