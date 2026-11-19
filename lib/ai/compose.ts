/**
 * TanyaData AI — komposisi jawaban (lib/ai/compose.ts).
 *
 * Menyusun AnswerQuestionResult dari DraftResult yang dihasilkan handler.
 * Helper tabel/visual dan format angka juga tinggal di sini agar seluruh
 * handler memakai satu sumber pembulatan.
 */
import type { DB } from '@/lib/db/client';
import type { Scope } from '@/lib/analytics/scope';
import type { AnalyticsFilters } from '@/lib/analytics/filters';
import type {
  AnswerQuestionResult,
  AssistantContext,
  ChatMode,
  Lang,
  Period,
  SourceCitation,
  SupportingTable,
  Visualization,
} from '@/lib/contracts/http';
import type { Normalized } from '@/lib/ai/normalize';
import { formatCurrency, formatNumber, formatPercent, nowJakartaIso } from '@/lib/date';

export type HandlerCtx = {
  db: DB;
  scope: Scope;
  lang: Lang;
  question: string;
  norm: Normalized;
  period: Period;
  filters: AnalyticsFilters;
  context: AssistantContext;
  contextApplied: ('period' | 'channel' | 'category' | 'failureCode')[];
  assumed: boolean;
};

export type DraftResult = {
  answer: string;
  keyFindings: { text: string; ref?: string }[];
  supportingTable: SupportingTable | null;
  visualizations: Visualization[];
  sql: { query: string; durationMs: number; rowCount: number; error?: string } | null;
  sources: SourceCitation[];
  followUps: string[];
  mode: ChatMode;
  contextUpdates: Partial<AssistantContext>;
  rowCount: number;
};

export function emptyDraft(mode: ChatMode = 'sql'): DraftResult {
  return {
    answer: '',
    keyFindings: [],
    supportingTable: null,
    visualizations: [],
    sql: null,
    sources: [],
    followUps: [],
    mode,
    contextUpdates: {},
    rowCount: 0,
  };
}

export function table(
  columns: SupportingTable['columns'],
  rows: SupportingTable['rows'],
): SupportingTable {
  return { columns, rows, totalRows: rows.length, truncated: false };
}

export function kpiViz(rows: SupportingTable['rows'], lang: Lang): Visualization {
  return {
    id: 'v_kpi',
    type: 'kpi',
    title: lang === 'id' ? 'Ringkasan' : 'Summary',
    dataKey: 'value',
    xKey: 'label',
    series: [],
    rows,
    format: 'number',
  };
}

export function barViz(
  id: string,
  title: string,
  rows: SupportingTable['rows'],
  xKey: string,
  dataKey: string,
  unit: '%' | 'IDR' | 'tx',
  format: 'number' | 'percent' | 'currency' = 'number',
): Visualization {
  return {
    id,
    type: 'bar',
    title,
    dataKey,
    xKey,
    series: [{ key: dataKey, label: dataKey, unit }],
    rows,
    orientation: 'horizontal',
    format,
  };
}

export function lineViz(
  id: string,
  title: string,
  rows: SupportingTable['rows'],
  xKey: string,
  series: Visualization['series'],
  format: 'number' | 'percent' | 'currency' = 'number',
): Visualization {
  return { id, type: 'line', title, dataKey: series[0]?.key ?? 'value', xKey, series, rows, format };
}

export function pieViz(
  id: string,
  title: string,
  rows: SupportingTable['rows'],
  xKey: string,
  dataKey: string,
): Visualization {
  return {
    id,
    type: 'pie',
    title,
    dataKey,
    xKey,
    series: [{ key: dataKey, label: dataKey, unit: 'tx' }],
    rows,
  };
}

/** Format angka untuk narasi (locale id/en). */
export const fmtN = (value: number, lang: Lang): string => formatNumber(value, lang);
export const fmtCur = (value: number, lang: Lang): string => formatCurrency(value, lang);
export const fmtPct = (value: number, lang: Lang, digits = 2): string => formatPercent(value, lang, digits);

export function composeResult(
  ctx: HandlerCtx,
  draft: DraftResult,
  context: AssistantContext,
  startedAt: number,
  fallbackReason?: AnswerQuestionResult['meta']['fallbackReason'],
): AnswerQuestionResult {
  const latencyMs = Math.round(performance.now() - startedAt);
  const content = draft.answer;
  return {
    content,
    answer: draft.answer,
    keyFindings: draft.keyFindings,
    supportingTable: draft.supportingTable,
    visualizations: draft.visualizations,
    sql: draft.sql,
    sources: draft.sources,
    followUps: draft.followUps,
    meta: {
      period: ctx.period,
      dataset: ctx.scope.ref,
      partial: ctx.period.isPartial,
      rowCount: draft.rowCount,
      mode: draft.mode,
      latencyMs,
      contextApplied: ctx.contextApplied,
      assumed: ctx.assumed || undefined,
      ...(fallbackReason ? { fallbackReason } : {}),
    },
    context,
    mode: draft.mode,
    latencyMs,
  };
}

/** Konteks awal bila tidak ada context dari request. */
export function freshContext(turn = 1): AssistantContext {
  return {
    period: null,
    metric: null,
    channel: null,
    category: null,
    failureCode: null,
    docRefs: [],
    lastIntentId: null,
    lastDomain: null,
    turn,
    updatedAt: nowJakartaIso(),
  };
}

export type { AssistantContext, SourceCitation, SupportingTable, Visualization };
