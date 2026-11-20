'use client';

import { useId, useState } from 'react';
import type { ChatMessage, SourceCitation, Visualization } from '@/lib/contracts/http';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { VisualizationView } from './visualization-view';
import { formatIdr, formatNumber, formatPercent } from '@/lib/ui/format';
import { toast } from '@/components/ui/toaster';

/** Material Symbols self-hosted; semua ikon di sini dekoratif (blueprint §2). */
function Icon({ name, className }: { name: string; className?: string }) {
  return (
    <span className={`material-symbols-outlined ${className ?? ''}`} aria-hidden="true">
      {name}
    </span>
  );
}

function fmtCell(value: string | number | null, format?: string): string {
  if (value === null || value === undefined) return 'n/a';
  if (typeof value === 'string') return value;
  if (format === 'currency') return formatIdr(value);
  if (format === 'percent') return formatPercent(value);
  if (format === 'number') return formatNumber(value);
  return String(value);
}

/** Urutan warna Stitch untuk bar kanal (baris 192-252 code.html). */
const BAR_COLORS = [
  'bg-tertiary',
  'bg-primary-container',
  'bg-outline',
  'bg-primary-fixed-dim',
  'bg-secondary-fixed-dim',
];
const METRIC_COLORS = ['text-on-surface', 'text-error', 'text-tertiary'];
const FOOTER_ICONS = ['check_circle', 'trending_up', 'warning'];
const FOLLOWUP_ICONS = [
  { name: 'assignment', color: 'text-secondary' },
  { name: 'compare_arrows', color: 'text-primary' },
  { name: 'replay', color: 'text-tertiary' },
];

function MetricGrid({ viz, findings }: { viz: Visualization; findings: string[] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-space-sm">
      {viz.rows.map((row, i) => {
        const label = String(row[viz.xKey] ?? '');
        const raw = row[viz.dataKey];
        const value = typeof raw === 'number' ? raw : null;
        const shown =
          viz.format === 'currency'
            ? formatIdr(value)
            : viz.format === 'percent'
              ? formatPercent(value)
              : formatNumber(value);
        const footer = findings[i];
        return (
          <div
            key={`${label}-${i}`}
            className="p-space-sm rounded bg-surface-container-lowest shadow-sm flex flex-col justify-between"
          >
            <span className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider">{label}</span>
            <div className="mt-1 flex items-baseline gap-2">
              <span
                className={`font-metric-display text-metric-display font-bold tracking-tight tabular ${
                  METRIC_COLORS[i] ?? 'text-on-surface'
                }`}
              >
                {shown}
              </span>
            </div>
            {footer && (
              <div className="mt-2 text-on-surface-variant font-body-sm text-body-sm flex items-center gap-1">
                <Icon name={FOOTER_ICONS[i] ?? 'check_circle'} className="text-[14px]" />
                <span className="line-clamp-2">{footer}</span>
              </div>
            )}
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
    <div className="rounded-lg bg-surface-container-lowest p-space-md shadow-sm space-y-space-md">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-space-xs">
          <Icon name="bar_chart" className="text-[18px] text-primary" />
          <span className="font-headline-sm text-headline-sm text-on-surface font-bold">{viz.title}</span>
        </div>
        <span className="font-label-sm text-label-sm px-2 py-0.5 rounded bg-surface-container-high text-on-surface-variant font-semibold">
          {periodLabel}
        </span>
      </div>
      <div className="space-y-space-sm">
        {rows.map((row, i) => {
          const label = String(row[viz.xKey] ?? '');
          const value = values[i];
          const share = viz.format === 'percent' ? value : total > 0 ? (value / total) * 100 : 0;
          const color = BAR_COLORS[i % BAR_COLORS.length];
          return (
            <div key={`${label}-${i}`} className="space-y-1">
              <div className="flex items-center justify-between font-label-md text-label-md gap-2">
                <span className="font-semibold text-on-surface flex items-center gap-1.5 min-w-0">
                  <span className={`w-2.5 h-2.5 rounded-sm shrink-0 ${color}`} aria-hidden="true" />
                  <span className="truncate">{label}</span>
                </span>
                <span className="font-bold text-on-surface shrink-0 tabular">
                  {formatPercent(share)}{' '}
                  <span className="font-normal text-on-surface-variant font-body-sm text-body-sm">
                    ({formatNumber(value)})
                  </span>
                </span>
              </div>
              <div className="w-full h-3 rounded-full bg-surface-container overflow-hidden flex">
                <div
                  className={`h-full rounded-full transition-all duration-700 ${color}`}
                  style={{ width: `${Math.max(0, Math.min(100, share))}%` }}
                />
              </div>
            </div>
          );
        })}
        {rows.length === 0 && (
          <p className="font-body-sm text-body-sm text-on-surface-variant">No visualization data.</p>
        )}
      </div>
    </div>
  );
}

function SourceCard({ src, onOpen }: { src: SourceCitation; onOpen?: (src: SourceCitation) => void }) {
  const isPdf = (src.docTitle ?? '').toLowerCase().endsWith('.pdf');
  const activate = () => onOpen?.(src);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={activate}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          activate();
        }
      }}
      className="p-space-sm rounded-lg bg-surface-container-lowest shadow-sm flex flex-col justify-between space-y-2 hover:bg-surface-container-low transition-colors cursor-pointer group focus-ring"
    >
      <div className="flex items-start gap-2">
        <Icon
          name={isPdf ? 'picture_as_pdf' : 'description'}
          className={`text-[20px] shrink-0 ${isPdf ? 'text-tertiary' : 'text-primary'}`}
        />
        <div className="flex flex-col min-w-0">
          <span className="font-label-md text-label-md font-bold text-on-surface group-hover:text-primary truncate transition-colors">
            {src.docTitle ?? src.sourceId}
          </span>
          <span className="font-body-sm text-body-sm text-on-surface-variant line-clamp-2 mt-0.5">
            {src.quote ?? src.section ?? 'n/a'}
          </span>
        </div>
      </div>
      <div className="flex items-center justify-between pt-1 text-on-surface-variant font-label-sm text-label-sm">
        <span className="font-medium text-primary">
          Matched: Page {src.page ?? 'n/a'}
          {src.section ? ` · ${src.section}` : ''}
        </span>
        <Icon name="open_in_new" className="text-[16px] group-hover:text-primary transition-colors" />
      </div>
    </div>
  );
}

export interface AnswerCardProps {
  message: ChatMessage;
  modeLabel?: string;
  conversationId?: string;
  onFollowUp?: (question: string) => void;
  onSaveReport?: (msg: ChatMessage) => void;
  savingReport?: boolean;
  onOpenSource?: (src: SourceCitation) => void;
  disabled?: boolean;
}

export function AnswerCard({
  message,
  modeLabel = 'SQLite · SQL + FTS5',
  conversationId,
  onFollowUp,
  onSaveReport,
  savingReport,
  onOpenSource,
  disabled,
}: AnswerCardProps) {
  const [sqlOpen, setSqlOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const sqlPanelId = useId();

  const meta = message.meta;
  const guardrail = message.guardrail;
  const periodLabel = meta?.period?.label ?? 'n/a';
  const findings = (message.keyFindings ?? []).map((kf) => kf.text);
  const kpiViz = (message.visualizations ?? []).find((v) => v.type === 'kpi');
  const otherViz = (message.visualizations ?? []).filter((v) => v.type !== 'kpi');
  const documents = (message.sources ?? []).filter((s) => s.kind === 'document');
  const datasetSources = (message.sources ?? []).filter((s) => s.kind === 'dataset');
  const timestamp = `${new Date(message.createdAt).toISOString().slice(11, 19)} UTC`;

  const copyText = async (text: string, success: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ status: 'success', message: success });
    } catch {
      toast({ status: 'error', message: 'Could not copy to clipboard.' });
    }
  };

  const copySql = async () => {
    if (!message.sql) return;
    await copyText(message.sql.query, 'SQL copied.');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col space-y-space-md flex-1 min-w-0">
      {/* Metadata line (code.html 110-124) */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-space-xs flex-wrap">
          <span className="font-label-md text-label-md font-bold text-primary">TanyaData Intelligence</span>
          <span className="font-label-sm text-label-sm px-1.5 py-[0.2rem] rounded bg-surface-container-high text-on-surface-variant font-semibold">
            {modeLabel}
          </span>
          <span className="font-label-sm text-label-sm text-on-surface-variant">{timestamp}</span>
        </div>
        <div className="flex items-center gap-1 text-outline">
          <button
            type="button"
            title="Copy response"
            aria-label="Copy response"
            onClick={() => void copyText(message.answer ?? message.content, 'Response copied.')}
            className="p-1 rounded hover:bg-surface-container hover:text-on-surface focus-ring"
          >
            <Icon name="content_copy" className="text-[16px]" />
          </button>
          <button
            type="button"
            title="Share insight"
            aria-label="Share insight"
            onClick={() => {
              const base = typeof window === 'undefined' ? '' : window.location.origin + window.location.pathname;
              const query = conversationId ? `?conversation=${conversationId}&message=${message.id}` : '';
              void copyText(`${base}${query}`, 'Insight link copied.');
            }}
            className="p-1 rounded hover:bg-surface-container hover:text-on-surface focus-ring"
          >
            <Icon name="share" className="text-[16px]" />
          </button>
          {onSaveReport && (
            <button
              type="button"
              title="Save as report"
              aria-label="Save as report"
              disabled={disabled || savingReport}
              onClick={() => onSaveReport(message)}
              className="p-1 rounded hover:bg-surface-container hover:text-on-surface focus-ring disabled:opacity-45"
            >
              <Icon name="picture_as_pdf" className="text-[16px]" />
            </button>
          )}
        </div>
      </div>

      {/* Guardrail (kontrak §10.1): tanpa angka hasil karangan */}
      {guardrail && (
        <div className="rounded-lg bg-surface-container-lowest p-space-md shadow-sm relative overflow-hidden">
          <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-tertiary" aria-hidden="true" />
          <div className="pl-2 flex flex-col space-y-space-xs">
            <span className="font-label-sm text-label-sm font-bold text-tertiary uppercase tracking-wider flex items-center gap-1">
              <Icon name="warning" className="text-[14px]" /> Outside data scope
            </span>
            <p className="font-body-md text-body-md text-on-surface leading-relaxed">
              {message.answer ?? message.content}
            </p>
            <p className="font-body-sm text-body-sm text-on-surface-variant">{guardrail.explanation}</p>
          </div>
        </div>
      )}

      {/* Executive summary (code.html 126-141) */}
      {!guardrail && (message.answer || message.content) && (
        <div className="rounded-lg bg-surface-container-lowest p-space-md shadow-sm relative overflow-hidden">
          <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-primary" aria-hidden="true" />
          <div className="pl-2 flex flex-col space-y-space-xs">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <span className="font-label-sm text-label-sm font-bold text-primary uppercase tracking-wider flex items-center gap-1">
                <Icon name="insights" className="text-[14px]" /> Executive Summary
              </span>
              {meta && (
                <span className="font-label-sm text-label-sm px-2 py-0.5 rounded bg-surface-container-high text-on-surface-variant font-semibold">
                  {meta.mode}
                  {meta.partial ? ' · partial' : ''}
                </span>
              )}
            </div>
            <p className="font-body-md text-body-md text-on-surface leading-relaxed">
              {message.answer ?? message.content}
            </p>
          </div>
        </div>
      )}

      {/* Key numerical findings (code.html 143-174) */}
      {kpiViz && kpiViz.rows.length > 0 && (
        <div className="animate-[stagger-in_180ms_var(--ease-out-quart)_both]">
          <MetricGrid viz={kpiViz} findings={findings} />
        </div>
      )}

      {/* Supporting table (DataTable, sesuai kontrak) */}
      {message.supportingTable && message.supportingTable.rows.length > 0 && (
        <div className="animate-[stagger-in_180ms_var(--ease-out-quart)_both] [animation-delay:30ms] rounded-lg bg-surface-container-lowest p-space-md shadow-sm space-y-space-xs">
          <span className="font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant">
            Supporting Data
          </span>
          <DataTable
            columns={message.supportingTable.columns.map<DataTableColumn<Record<string, string | number | null>>>(
              (c) => ({
                key: c.key,
                label: c.label,
                align: c.align,
                format: (v) => fmtCell(v as string | number | null, c.format),
              }),
            )}
            rows={message.supportingTable.rows}
            emptyTitle="No supporting data"
          />
          {message.supportingTable.truncated && (
            <p className="font-body-sm text-body-sm text-on-surface-variant">
              Showing {formatNumber(message.supportingTable.rows.length)} of{' '}
              {formatNumber(message.supportingTable.totalRows)} rows.
            </p>
          )}
        </div>
      )}

      {/* Visualizations (code.html 176-255) */}
      {otherViz.length > 0 && (
        <div className="animate-[stagger-in_180ms_var(--ease-out-quart)_both] [animation-delay:60ms] space-y-space-md">
          {otherViz.map((viz, i) =>
            viz.type === 'bar' ? (
              <ChannelBars key={viz.id} viz={viz} periodLabel={periodLabel} />
            ) : (
              <div
                key={viz.id}
                className="rounded-lg bg-surface-container-lowest p-space-md shadow-sm space-y-space-md"
              >
                <div className="flex items-center gap-space-xs">
                  <Icon name={viz.type === 'line' ? 'show_chart' : 'pie_chart'} className="text-[18px] text-primary" />
                  <span className="font-headline-sm text-headline-sm text-on-surface font-bold">{viz.title}</span>
                </div>
                <VisualizationView viz={viz} />
              </div>
            ),
          )}
        </div>
      )}

      {/* SQL disclosure (code.html 257-288) */}
      {message.sql && (
        <div className="rounded-lg bg-surface-container-lowest overflow-hidden shadow-sm">
          <button
            type="button"
            onClick={() => setSqlOpen((o) => !o)}
            aria-expanded={sqlOpen}
            aria-controls={sqlPanelId}
            className="w-full px-space-md py-space-sm flex items-center justify-between bg-surface-container-low hover:bg-surface-container transition-colors text-left focus-ring"
          >
            <div className="flex items-center gap-2 flex-wrap">
              <Icon name="terminal" className="text-[16px] text-primary" />
              <span className="font-label-md text-label-md text-on-surface font-semibold">
                View Executed SQL Query
              </span>
              <span className="font-label-sm text-label-sm px-1.5 py-0.5 rounded bg-surface-container-highest text-on-surface-variant font-mono">
                SQLite engine · {formatNumber(message.sql.durationMs)}ms runtime
              </span>
            </div>
            <Icon
              name="expand_more"
              className={`text-[18px] text-on-surface-variant transition-transform duration-200 ${
                sqlOpen ? 'rotate-180' : ''
              }`}
            />
          </button>
          <div
            id={sqlPanelId}
            className={`grid transition-[grid-template-rows] duration-[160ms] ease-[var(--ease-out-quart)] ${
              sqlOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
            }`}
          >
            <div className="overflow-hidden">
              <div className="p-space-md bg-surface-container-highest space-y-2">
                <div className="flex items-center justify-between text-on-surface-variant font-label-sm text-label-sm gap-2">
                  <span className="truncate">
                    Target: <span className="font-mono">{meta?.dataset.name ?? 'dataset'}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => void copySql()}
                    tabIndex={sqlOpen ? 0 : -1}
                    className="text-primary hover:underline flex items-center gap-1 shrink-0 focus-ring"
                  >
                    <Icon name="copy_all" className="text-[14px]" /> {copied ? 'Copied' : 'Copy SQL'}
                  </button>
                </div>
                <pre className="overflow-x-auto p-space-sm rounded bg-inverse-surface text-inverse-on-surface font-mono text-[11px] leading-relaxed">
                  <code>{message.sql.query}</code>
                </pre>
                {message.sql.error && (
                  <p className="font-body-sm text-body-sm text-error">{message.sql.error}</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Dataset citations (dari sources kind=dataset) */}
      {datasetSources.length > 0 && (
        <div className="flex animate-[stagger-in_180ms_var(--ease-out-quart)_both] flex-wrap items-center gap-1.5 [animation-delay:90ms]">
          <span className="font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant">
            Dataset Evidence:
          </span>
          {datasetSources.map((s, i) => (
            <span
              key={`${s.sourceId}-${i}`}
              className="inline-flex max-w-full items-center gap-1 rounded-sm bg-surface-container-low px-1.5 py-0.5 font-mono text-label-sm text-primary"
              title={s.sql ?? s.period ?? s.table ?? s.sourceId}
            >
              <Icon name="table_chart" className="text-[12px] shrink-0" />
              <span className="truncate">
                {s.table ?? s.sourceId}
                {s.period ? ` · ${s.period}` : ''}
              </span>
            </span>
          ))}
        </div>
      )}

      {/* Document citations (code.html 289-332) */}
      {documents.length > 0 && (
        <div className="animate-[stagger-in_180ms_var(--ease-out-quart)_both] space-y-space-xs [animation-delay:120ms]">
          <span className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider flex items-center gap-1">
            <Icon name="verified" className="text-[14px]" /> Verified Citations &amp; Operational Evidence
          </span>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-space-sm">
            {documents.map((src, i) => (
              <SourceCard key={`${src.sourceId}-${i}`} src={src} onOpen={onOpenSource} />
            ))}
          </div>
        </div>
      )}

      {/* Meta (code.html 110-115 + kontrak meta) */}
      {meta && (
        <p className="font-body-sm text-body-sm text-on-surface-variant">
          {meta.period ? `${meta.period.label}${meta.partial ? ' · partial' : ''} · ` : ''}
          {formatNumber(meta.rowCount)} rows · {meta.mode} · {formatNumber(meta.latencyMs)} ms
          {meta.fallbackReason ? ' · deterministic answer' : ''}
        </p>
      )}

      {/* Follow-ups (code.html 333-350) */}
      {message.followUps && message.followUps.length > 0 && onFollowUp && (
        <div className="flex flex-col space-y-space-xs pt-1">
          <span className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider">
            Next Step Investigations
          </span>
          <div className="flex flex-wrap gap-2">
            {message.followUps.slice(0, 8).map((q, i) => {
              const icon = FOLLOWUP_ICONS[i % FOLLOWUP_ICONS.length];
              return (
                <button
                  key={q}
                  type="button"
                  disabled={disabled}
                  onClick={() => onFollowUp(q)}
                  className="px-space-sm py-1.5 rounded-full bg-surface-container-lowest hover:bg-surface-container text-on-surface font-label-md text-label-md flex items-center gap-1.5 shadow-sm transition-colors focus-ring disabled:opacity-45"
                >
                  <Icon name={icon.name} className={`text-[14px] ${icon.color}`} />
                  <span>{q}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
