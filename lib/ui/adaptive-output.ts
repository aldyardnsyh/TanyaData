/**
 * Normalisasi payload chat (http.ts) menjadi blok output kanonik ShareOutput.
 * Satu-satunya sumber angka adalah `rows` / `value` dari result_json yang
 * sudah dibawa backend di `visualizations` dan `supportingTable`.
 * Dilarang mengambil angka dari `answer`, `reason`, atau `confidence`.
 */
import type { ChatMessage, SupportingTable, Visualization } from '@/lib/contracts/http';
import type { ShareColumn, ShareOutput } from './share-contract';

function rec(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function columnsFrom(rows: Record<string, string | number | null>[], table?: SupportingTable | null): ShareColumn[] {
  if (table?.columns?.length) {
    return table.columns.map((col) => ({
      key: col.key,
      label: col.label,
      align: col.align === 'right' ? 'right' : 'left',
      format: (['number', 'percent', 'currency', 'text'].includes(col.format ?? '') ? col.format! : 'text') as ShareColumn['format'],
    }));
  }
  const keys = rows.length > 0 ? Object.keys(rows[0]) : [];
  return keys.map((key) => ({ key, label: key, align: 'left', format: 'text' }));
}

function baseOutput(message: ChatMessage): Pick<ShareOutput, 'source' | 'period' | 'notes' | 'text' | 'keywords'> {
  return {
    source: message.sql ? 'SQL' : message.meta?.dataset?.name ?? null,
    period: message.meta?.period?.label ?? null,
    notes: message.keyFindings?.map((f) => f.text) ?? [],
    text: null,
    keywords: [],
  };
}

function fromVisualization(viz: Visualization, message: ChatMessage): ShareOutput {
  const rows = (viz.rows ?? []).map((row) => rec(row) as Record<string, string | number | null>);
  const rawType = str(viz.type).toLowerCase();
  const type = (['kpi', 'table', 'line', 'bar', 'donut', 'quote', 'timeline', 'parameter_report'].includes(rawType)
    ? rawType
    : rawType === 'pie' ? 'donut' : 'none') as ShareOutput['type'];

  const first = rows[0] ?? {};
  const value = num(first[viz.dataKey]) ?? num(first.value) ?? num(first.total) ?? null;

  return {
    id: viz.id,
    type,
    title: viz.title || null,
    rows,
    columns: columnsFrom(rows),
    xKey: viz.xKey || Object.keys(first)[0] || '',
    series: (viz.series ?? []).map((s) => ({ key: s.key, label: s.label })),
    value,
    format: (['number', 'percent', 'currency'].includes(viz.format ?? '') ? viz.format! : 'number') as ShareOutput['format'],
    ...baseOutput(message),
    chapter: str(first.chapter) || null,
    article: str(first.article ?? first.pasal) || null,
    verses: rows.map((r) => str(r.verse ?? r.ayat ?? r.text)).filter(Boolean),
    events: rows.map((r, i) => ({
      date: str(r.date ?? r.tanggal ?? r.bucket),
      label: str(r.label ?? r.event ?? r.title, `Kejadian ${i + 1}`),
      evidence: str(r.evidence ?? r.bukti) || null,
      citationId: str(r.citationId ?? r.ref) || null,
    })).filter((e) => e.date.length > 0),
    parameters: rows.map((r) => ({
      name: str(r.name ?? r.parameter ?? r.label, 'Parameter'),
      value: (r.value ?? r.nilai ?? null) as string | number | null,
      unit: str(r.unit ?? r.satuan) || null,
      status: str(r.status).toLowerCase() === 'alert' ? 'alert' as const : 'normal' as const,
      page: num(r.page ?? r.halaman),
      note: str(r.note ?? r.catatan) || null,
    })),
  };
}

function fromTable(table: SupportingTable, message: ChatMessage): ShareOutput {
  const rows = (table.rows ?? []).map((row) => rec(row) as Record<string, string | number | null>);
  return {
    id: 'supporting-table',
    type: 'table',
    title: 'Data pendukung',
    rows,
    columns: columnsFrom(rows, table),
    xKey: rows.length > 0 ? Object.keys(rows[0])[0] ?? '' : '',
    series: [],
    value: null,
    format: 'number',
    ...baseOutput(message),
    chapter: null,
    article: null,
    verses: [],
    events: [],
    parameters: [],
  };
}

/** Satu tipe utama + maksimal satu pendamping (ADAPTIVE_OUTPUT_SPEC P-4). */
export function normalizeChatOutputs(message: ChatMessage): ShareOutput[] {
  const visualizations = message.visualizations ?? [];
  const blocks: ShareOutput[] = visualizations.map((viz) => fromVisualization(viz, message));

  if (blocks.length === 0 && message.supportingTable) {
    blocks.push(fromTable(message.supportingTable, message));
  }

  if (blocks.length === 0) {
    blocks.push({
      id: 'text-answer',
      type: 'none',
      title: null,
      rows: [],
      columns: [],
      xKey: '',
      series: [],
      value: null,
      format: 'number',
      ...baseOutput(message),
      text: message.answer || message.content || null,
      keywords: message.meta?.alternativeKeywords ?? [],
      chapter: null,
      article: null,
      verses: [],
      events: [],
      parameters: [],
    });
  }

  return blocks.slice(0, 2);
}
