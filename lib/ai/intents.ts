/**
 * TanyaData AI — intent registry & handler deterministik (lib/ai/intents.ts).
 *
 * 24+ intent: A1..A4, B1..B3, C1..C3, E1..E3, F1 hybrid, D1..D8 dokumen,
 * META_help, SMALLTALK. Semua angka berasal dari SQL agregasi SQLite;
 * D1..D8 hanya dari chunk dokumen (retrieval) — tidak ada generasi bebas.
 */
import type { DB } from '@/lib/db/client';
import type { Scope } from '@/lib/analytics/scope';
import type { AnalyticsFilters } from '@/lib/analytics/filters';
import type { AssistantContext, Lang, Period, SourceCitation } from '@/lib/contracts/http';
import { allRows, num, oneRow, str } from '@/lib/analytics/sql';
import { getChannelPerformance, getCategoryPerformance, getStatusDistribution, getSummary } from '@/lib/analytics/queries';
import { formatCurrency, formatNumber, formatPercent, round1, round2, safeRatio, truncateText } from '@/lib/date';
import { retrieveDocuments } from '@/lib/ai/retrieval';
import type { Normalized } from '@/lib/ai/normalize';
import {
  barViz, emptyDraft, fmtCur, fmtN, fmtPct, kpiViz, lineViz, pieViz, table,
  type DraftResult, type HandlerCtx,
} from '@/lib/ai/compose';

export type IntentId =
  | 'A1_total' | 'A1b_value' | 'A2_status' | 'A3_top_channel' | 'A4_avg_ticket' | 'A5_rate'
  | 'B1_volume_compare' | 'B2_rate_trend' | 'B3_category_change'
  | 'C1_failure_change' | 'C2_failure_code' | 'C3_concentration'
  | 'E1_excess' | 'E2_change_point' | 'E3_processing'
  | 'F1_hybrid'
  | 'D1_sop' | 'D2_causes' | 'D3_by_type' | 'D4_refund_sla' | 'D5_escalation'
  | 'D6_pending_expired' | 'D7_incident' | 'D8_hotfix' | 'D9_failure_code' | 'D_generic'
  | 'META_help' | 'SMALLTALK';

export type SlotName = 'period' | 'channel' | 'category' | 'failureCode' | 'docTopic';

export type IntentDef = {
  id: IntentId;
  domain: 'sql' | 'rag' | 'hybrid' | 'meta';
  triggers: string[];
  slots: SlotName[];
  handler: (ctx: HandlerCtx) => DraftResult;
};

/* ============================================================ helpers */

function ds(ctx: HandlerCtx): SourceCitation {
  return {
    kind: 'dataset',
    sourceId: ctx.scope.id,
    table: 'transactions',
    period: `${ctx.period.start}..${ctx.period.end}`,
    sql: ctx.period ? undefined : undefined,
  };
}

function dsWithSql(ctx: HandlerCtx, query: string): SourceCitation {
  return {
    kind: 'dataset',
    sourceId: ctx.scope.id,
    table: 'transactions',
    period: `${ctx.period.start}..${ctx.period.end}`,
    sql: query,
  };
}

function sqlBlock(query: string, rowCount: number, durationMs = 3) {
  return { query, durationMs, rowCount };
}

function partialFinding(ctx: HandlerCtx): { text: string; ref?: string } | null {
  if (!ctx.period.isPartial) return null;
  return {
    text: ctx.lang === 'id'
      ? 'Periode masih parsial (bulan berjalan belum lengkap); jangan dibandingkan dengan bulan penuh.'
      : 'The period is partial (current month incomplete); do not compare with a full month.',
    ref: 'period',
  };
}

function topFollowUps(ctx: HandlerCtx, extra: string[] = []): string[] {
  const base = ctx.lang === 'id'
    ? ['Bagaimana distribusi statusnya?', 'Kanal mana yang paling berkontribusi pada kegagalan?', 'Apa yang dikatakan SOP tentang kegagalan ini?']
    : ['How is the status distributed?', 'Which channel contributes most failures?', 'What does the SOP say about these failures?'];
  return [...extra, ...base].slice(0, 4);
}

/* ============================================================ A handlers */

function hA1Total(ctx: HandlerCtx): DraftResult {
  const summary = getSummary(ctx.db, ctx.scope, ctx.period, ctx.filters, ctx.lang);
  const total = summary.kpis.find((k) => k.key === 'total')?.value ?? 0;
  const value = summary.kpis.find((k) => k.key === 'successValue')?.value ?? 0;
  const successRate = summary.kpis.find((k) => k.key === 'successRate')?.value ?? 0;
  const failureRate = summary.kpis.find((k) => k.key === 'failureRate')?.value ?? 0;
  const successful = summary.kpis.find((k) => k.key === 'successful')?.value ?? 0;
  const failed = summary.kpis.find((k) => k.key === 'failed')?.value ?? 0;
  const query = `SELECT COUNT(*) AS total, SUM(CASE WHEN status='SUCCESS' THEN amount ELSE 0 END) AS value FROM ${ctx.scope.table} WHERE transaction_date BETWEEN '${ctx.period.start}' AND '${ctx.period.end}'`;
  const answer = ctx.lang === 'id'
    ? `Total transaksi ${ctx.period.label} adalah ${fmtN(total, ctx.lang)} transaksi, dengan nilai transaksi sukses ${fmtCur(value, ctx.lang)}.`
    : `Total transactions for ${ctx.period.label} are ${fmtN(total, ctx.lang)}, with successful value ${fmtCur(value, ctx.lang)}.`;
  const keyFindings = [
    { text: `Success rate ${fmtPct(successRate, ctx.lang)}; failure rate ${fmtPct(failureRate, ctx.lang)}.`, ref: 'sql:summary' },
    { text: `Nilai transaksi sukses: ${fmtCur(value, ctx.lang)}.`, ref: 'sql:summary' },
    ...(partialFinding(ctx) ? [partialFinding(ctx)!] : []),
  ];
  const supportingTable = table(
    [
      { key: 'metric', label: ctx.lang === 'id' ? 'Metrik' : 'Metric' },
      { key: 'value', label: ctx.lang === 'id' ? 'Nilai' : 'Value', align: 'right', format: 'number' },
    ],
    [
      { metric: ctx.lang === 'id' ? 'Total' : 'Total', value: total },
      { metric: ctx.lang === 'id' ? 'Sukses' : 'Successful', value: successful },
      { metric: ctx.lang === 'id' ? 'Gagal' : 'Failed', value: failed },
      { metric: 'Success Rate', value: successRate },
      { metric: 'Failure Rate', value: failureRate },
    ],
  );
  const visualizations = [kpiViz([
    { label: ctx.lang === 'id' ? 'Total' : 'Total', value: total },
    { label: ctx.lang === 'id' ? 'Sukses' : 'Successful', value: successful },
    { label: ctx.lang === 'id' ? 'Gagal' : 'Failed', value: failed },
  ], ctx.lang)];
  return {
    answer, keyFindings, supportingTable, visualizations,
    sql: sqlBlock(query, 1),
    sources: [dsWithSql(ctx, query)],
    followUps: topFollowUps(ctx),
    mode: 'sql',
    contextUpdates: { metric: 'total' },
    rowCount: 1,
  };
}

function hA1bValue(ctx: HandlerCtx): DraftResult {
  const summary = getSummary(ctx.db, ctx.scope, ctx.period, ctx.filters, ctx.lang);
  const value = summary.kpis.find((k) => k.key === 'successValue')?.value ?? 0;
  const query = `SELECT SUM(CASE WHEN status='SUCCESS' THEN amount ELSE 0 END) AS value FROM ${ctx.scope.table} WHERE transaction_date BETWEEN '${ctx.period.start}' AND '${ctx.period.end}'`;
  const answer = ctx.lang === 'id'
    ? `Nilai transaksi sukses ${ctx.period.label}: ${fmtCur(value, ctx.lang)}.`
    : `Successful transaction value for ${ctx.period.label}: ${fmtCur(value, ctx.lang)}.`;
  return {
    answer,
    keyFindings: [
      { text: `${ctx.lang === 'id' ? 'Nilai sukses' : 'Successful value'}: ${fmtCur(value, ctx.lang)}.`, ref: 'sql:summary' },
      ...(partialFinding(ctx) ? [partialFinding(ctx)!] : []),
    ],
    supportingTable: table(
      [{ key: 'metric', label: ctx.lang === 'id' ? 'Metrik' : 'Metric' }, { key: 'value', label: ctx.lang === 'id' ? 'Nilai' : 'Value', align: 'right', format: 'currency' }],
      [{ metric: ctx.lang === 'id' ? 'Nilai sukses' : 'Successful value', value }],
    ),
    visualizations: [kpiViz([{ label: ctx.lang === 'id' ? 'Nilai sukses' : 'Successful value', value }], ctx.lang)],
    sql: sqlBlock(query, 1),
    sources: [dsWithSql(ctx, query)],
    followUps: topFollowUps(ctx),
    mode: 'sql',
    contextUpdates: { metric: 'value' },
    rowCount: 1,
  };
}

function hA2Status(ctx: HandlerCtx): DraftResult {
  const dist = getStatusDistribution(ctx.db, ctx.scope, ctx.period, ctx.filters);
  const query = `SELECT status, COUNT(*) AS n FROM ${ctx.scope.table} WHERE transaction_date BETWEEN '${ctx.period.start}' AND '${ctx.period.end}' GROUP BY status`;
  const answer = ctx.lang === 'id'
    ? `Distribusi status ${ctx.period.label}: ${dist.items.map((i) => `${i.status} ${fmtN(i.count, ctx.lang)} (${fmtPct(i.percent, ctx.lang)})`).join('; ')}.`
    : `Status distribution for ${ctx.period.label}: ${dist.items.map((i) => `${i.status} ${fmtN(i.count, ctx.lang)} (${fmtPct(i.percent, ctx.lang)})`).join('; ')}.`;
  return {
    answer,
    keyFindings: dist.items.map((i) => ({ text: `${i.status}: ${fmtN(i.count, ctx.lang)} (${fmtPct(i.percent, ctx.lang)}).`, ref: `sql:status:${i.status}` })),
    supportingTable: table(
      [
        { key: 'status', label: 'Status' },
        { key: 'count', label: ctx.lang === 'id' ? 'Jumlah' : 'Count', align: 'right', format: 'number' },
        { key: 'percent', label: ctx.lang === 'id' ? 'Porsi' : 'Share', align: 'right', format: 'percent' },
      ],
      dist.items.map((i) => ({ status: i.status, count: i.count, percent: i.percent })),
    ),
    visualizations: [pieViz('v_status', ctx.lang === 'id' ? 'Distribusi status' : 'Status distribution', dist.items.map((i) => ({ status: i.status, count: i.count })), 'status', 'count')],
    sql: sqlBlock(query, dist.items.length),
    sources: [dsWithSql(ctx, query)],
    followUps: ctx.lang === 'id'
      ? ['Berapa failure rate bulan ini?', 'Status apa yang tidak masuk failure rate?', 'Bandingkan dengan bulan lalu.']
      : ['What is this month failure rate?', 'Which statuses are excluded from failure rate?', 'Compare with last month.'],
    mode: 'sql',
    contextUpdates: { metric: 'total' },
    rowCount: dist.items.length,
  };
}

function hA3TopChannel(ctx: HandlerCtx): DraftResult {
  const perf = getChannelPerformance(ctx.db, ctx.scope, ctx.period, ctx.filters, 'volume', 10);
  const top = perf.items.slice(0, 5);
  const query = `SELECT channel_name, COUNT(*) AS total FROM ${ctx.scope.table} WHERE transaction_date BETWEEN '${ctx.period.start}' AND '${ctx.period.end}' GROUP BY channel_id ORDER BY total DESC LIMIT 5`;
  const answer = ctx.lang === 'id'
    ? `Kanal dengan volume tertinggi: ${top.map((i) => `${i.channelName} ${fmtN(i.total, ctx.lang)}`).join('; ')}.`
    : `Highest-volume channels: ${top.map((i) => `${i.channelName} ${fmtN(i.total, ctx.lang)}`).join('; ')}.`;
  return {
    answer,
    keyFindings: top.map((i) => ({ text: `${i.channelName}: ${fmtN(i.total, ctx.lang)} transaksi (${fmtPct(i.share, ctx.lang)}).`, ref: `sql:channel:${i.channelId}` })),
    supportingTable: table(
      [
        { key: 'channel', label: ctx.lang === 'id' ? 'Kanal' : 'Channel' },
        { key: 'total', label: ctx.lang === 'id' ? 'Total' : 'Total', align: 'right', format: 'number' },
      ],
      top.map((i) => ({ channel: i.channelName, total: i.total })),
    ),
    visualizations: [barViz('v_top_channel', ctx.lang === 'id' ? 'Volume per kanal' : 'Volume by channel', top.map((i) => ({ channel: i.channelName, total: i.total })), 'channel', 'total', 'tx')],
    sql: sqlBlock(query, top.length),
    sources: [dsWithSql(ctx, query)],
    followUps: topFollowUps(ctx),
    mode: 'sql',
    contextUpdates: { metric: 'volume', channel: top[0]?.channelName ?? null },
    rowCount: top.length,
  };
}

function hA4AvgTicket(ctx: HandlerCtx): DraftResult {
  const cats = getCategoryPerformance(ctx.db, ctx.scope, ctx.period, ctx.filters, 15);
  const top = cats.items.slice(0, 7);
  const query = `SELECT category, COUNT(*) AS jumlah_sukses, ROUND(AVG(amount),0) AS rata_rata FROM ${ctx.scope.table} WHERE transaction_date BETWEEN '${ctx.period.start}' AND '${ctx.period.end}' AND status='SUCCESS' GROUP BY category ORDER BY rata_rata DESC`;
  const answer = ctx.lang === 'id'
    ? `Rata-rata nominal transaksi sukses per kategori: ${top.map((c) => `${c.categoryName} ${fmtCur(c.avgTicket ?? 0, ctx.lang)}`).join('; ')}.`
    : `Average successful amount by category: ${top.map((c) => `${c.categoryName} ${fmtCur(c.avgTicket ?? 0, ctx.lang)}`).join('; ')}.`;
  return {
    answer,
    keyFindings: top.slice(0, 3).map((c) => ({ text: `${c.categoryName}: ${fmtCur(c.avgTicket ?? 0, ctx.lang)} rata-rata (${fmtN(c.successful, ctx.lang)} transaksi sukses).`, ref: `sql:category:${c.categoryName}` })),
    supportingTable: table(
      [
        { key: 'category', label: ctx.lang === 'id' ? 'Kategori' : 'Category' },
        { key: 'count', label: ctx.lang === 'id' ? 'Jumlah sukses' : 'Successful count', align: 'right', format: 'number' },
        { key: 'avg', label: ctx.lang === 'id' ? 'Rata-rata nominal' : 'Average amount', align: 'right', format: 'currency' },
      ],
      top.map((c) => ({ category: c.categoryName, count: c.successful, avg: c.avgTicket ?? 0 })),
    ),
    visualizations: [barViz('v_avg_ticket', ctx.lang === 'id' ? 'Rata-rata nominal per kategori' : 'Average amount by category', top.map((c) => ({ category: c.categoryName, avg: c.avgTicket ?? 0 })), 'category', 'avg', 'IDR', 'currency')],
    sql: sqlBlock(query, top.length),
    sources: [dsWithSql(ctx, query)],
    followUps: topFollowUps(ctx),
    mode: 'sql',
    contextUpdates: { metric: 'value' },
    rowCount: top.length,
  };
}

/* ============================================================ B handlers */

function hB1VolumeCompare(ctx: HandlerCtx): DraftResult {
  const query = `SELECT SUM(transaction_date BETWEEN '2026-10-01' AND '2026-10-31') AS okt_penuh, SUM(transaction_date BETWEEN '2026-10-01' AND '2026-10-18') AS okt_tgl_1_18, SUM(transaction_date BETWEEN '2026-11-01' AND '2026-11-18') AS nov_tgl_1_18 FROM ${ctx.scope.table}`;
  const row = oneRow(ctx.db, query);
  const oktPenuh = num(row?.okt_penuh);
  const okt18 = num(row?.okt_tgl_1_18);
  const nov18 = num(row?.nov_tgl_1_18);
  const change = okt18 ? round2(((nov18 - okt18) / okt18) * 100) : null;
  const answer = ctx.lang === 'id'
    ? `Perbandingan volume like-for-like: Okt 1–18 = ${fmtN(okt18, ctx.lang)}, Nov 1–18 = ${fmtN(nov18, ctx.lang)}, naik ${change !== null ? fmtPct(change, ctx.lang) : 'n/a'}. Okt penuh = ${fmtN(oktPenuh, ctx.lang)} (tidak dipakai sebagai pembanding langsung karena November masih parsial).`
    : `Like-for-like volume: Oct 1–18 = ${fmtN(okt18, ctx.lang)}, Nov 1–18 = ${fmtN(nov18, ctx.lang)}, up ${change !== null ? fmtPct(change, ctx.lang) : 'n/a'}. Full October = ${fmtN(oktPenuh, ctx.lang)} (not a direct comparator because November is partial).`;
  return {
    answer,
    keyFindings: [
      { text: `Okt 1–18: ${fmtN(okt18, ctx.lang)}; Nov 1–18: ${fmtN(nov18, ctx.lang)}; perubahan ${change !== null ? fmtPct(change, ctx.lang) : 'n/a'}.`, ref: 'sql:volume' },
      { text: ctx.lang === 'id' ? 'Perbandingan memakai periode setara (like-for-like), bukan bulan penuh.' : 'Comparison uses equivalent periods (like-for-like), not full months.', ref: 'period' },
    ],
    supportingTable: table(
      [
        { key: 'window', label: ctx.lang === 'id' ? 'Rentang' : 'Window' },
        { key: 'total', label: 'Total', align: 'right', format: 'number' },
      ],
      [
        { window: 'Okt penuh', total: oktPenuh },
        { window: 'Okt 1–18', total: okt18 },
        { window: 'Nov 1–18', total: nov18 },
      ],
    ),
    visualizations: [barViz('v_volume', ctx.lang === 'id' ? 'Volume like-for-like' : 'Like-for-like volume', [{ window: 'Okt 1–18', total: okt18 }, { window: 'Nov 1–18', total: nov18 }], 'window', 'total', 'tx')],
    sql: sqlBlock(query, 1),
    sources: [dsWithSql(ctx, query)],
    followUps: ctx.lang === 'id'
      ? ['Bagaimana tren success rate tiga bulan terakhir?', 'Kategori mana yang naik/turun terbesar?', 'Mengapa kegagalan meningkat?']
      : ['What is the three-month success-rate trend?', 'Which categories changed the most?', 'Why did failures increase?'],
    mode: 'sql',
    contextUpdates: { metric: 'volume' },
    rowCount: 1,
  };
}

function hB2RateTrend(ctx: HandlerCtx): DraftResult {
  const query = `SELECT substr(transaction_date,1,7) AS bulan, COUNT(*) AS total, ROUND(100.0*SUM(status='SUCCESS')/COUNT(*),2) AS success_rate, ROUND(100.0*SUM(status='FAILED')/COUNT(*),2) AS failure_rate FROM ${ctx.scope.table} GROUP BY 1 ORDER BY 1`;
  const rows = allRows(ctx.db, query);
  const last3 = rows.slice(-3);
  const answer = ctx.lang === 'id'
    ? `Tren success rate: ${last3.map((r) => `${str(r.bulan)} ${fmtPct(num(r.success_rate), ctx.lang)}`).join(' → ')} (menurun). Failure rate: ${last3.map((r) => `${str(r.bulan)} ${fmtPct(num(r.failure_rate), ctx.lang)}`).join(' → ')} (meningkat).`
    : `Success-rate trend: ${last3.map((r) => `${str(r.bulan)} ${fmtPct(num(r.success_rate), ctx.lang)}`).join(' → ')} (declining). Failure rate: ${last3.map((r) => `${str(r.bulan)} ${fmtPct(num(r.failure_rate), ctx.lang)}`).join(' → ')} (rising).`;
  return {
    answer,
    keyFindings: last3.map((r) => ({ text: `${str(r.bulan)}: success ${fmtPct(num(r.success_rate), ctx.lang)}, failure ${fmtPct(num(r.failure_rate), ctx.lang)} (${fmtN(num(r.total), ctx.lang)} transaksi).`, ref: `sql:trend:${str(r.bulan)}` })),
    supportingTable: table(
      [
        { key: 'bulan', label: ctx.lang === 'id' ? 'Bulan' : 'Month' },
        { key: 'total', label: 'Total', align: 'right', format: 'number' },
        { key: 'success_rate', label: 'Success rate', align: 'right', format: 'percent' },
        { key: 'failure_rate', label: 'Failure rate', align: 'right', format: 'percent' },
      ],
      last3.map((r) => ({ bulan: str(r.bulan), total: num(r.total), success_rate: num(r.success_rate), failure_rate: num(r.failure_rate) })),
    ),
    visualizations: [lineViz('v_rate_trend', ctx.lang === 'id' ? 'Tren success/failure rate' : 'Success/failure-rate trend', last3.map((r) => ({ bulan: str(r.bulan), success_rate: num(r.success_rate), failure_rate: num(r.failure_rate) })), 'bulan', [{ key: 'success_rate', label: 'Success rate', unit: '%' }, { key: 'failure_rate', label: 'Failure rate', unit: '%' }], 'percent')],
    sql: sqlBlock(query, last3.length),
    sources: [dsWithSql(ctx, query)],
    followUps: topFollowUps(ctx),
    mode: 'sql',
    contextUpdates: { metric: 'successRate' },
    rowCount: last3.length,
  };
}

function hB3CategoryChange(ctx: HandlerCtx): DraftResult {
  const query = `SELECT category, SUM(transaction_date BETWEEN '2026-10-01' AND '2026-10-18') AS okt_tgl_1_18, SUM(transaction_date BETWEEN '2026-11-01' AND '2026-11-18') AS nov_tgl_1_18, ROUND(100.0*(SUM(transaction_date BETWEEN '2026-11-01' AND '2026-11-18')*1.0/SUM(transaction_date BETWEEN '2026-10-01' AND '2026-10-18')-1),1) AS perubahan FROM ${ctx.scope.table} GROUP BY category ORDER BY perubahan DESC`;
  const rows = allRows(ctx.db, query);
  const top = rows[0];
  const bottom = rows[rows.length - 1];
  const answer = ctx.lang === 'id'
    ? `Kategori naik terbesar: ${str(top?.category)} +${fmtPct(num(top?.perubahan), ctx.lang, 1)}; turun terbesar: ${str(bottom?.category)} ${fmtPct(num(bottom?.perubahan), ctx.lang, 1)}.`
    : `Largest increase: ${str(top?.category)} +${fmtPct(num(top?.perubahan), ctx.lang, 1)}; largest decrease: ${str(bottom?.category)} ${fmtPct(num(bottom?.perubahan), ctx.lang, 1)}.`;
  return {
    answer,
    keyFindings: [
      { text: `${str(top?.category)}: ${fmtN(num(top?.okt_tgl_1_18), ctx.lang)} → ${fmtN(num(top?.nov_tgl_1_18), ctx.lang)} (+${fmtPct(num(top?.perubahan), ctx.lang, 1)}).`, ref: 'sql:category' },
      { text: `${str(bottom?.category)}: ${fmtN(num(bottom?.okt_tgl_1_18), ctx.lang)} → ${fmtN(num(bottom?.nov_tgl_1_18), ctx.lang)} (${fmtPct(num(bottom?.perubahan), ctx.lang, 1)}).`, ref: 'sql:category' },
    ],
    supportingTable: table(
      [
        { key: 'category', label: ctx.lang === 'id' ? 'Kategori' : 'Category' },
        { key: 'okt', label: 'Okt 1–18', align: 'right', format: 'number' },
        { key: 'nov', label: 'Nov 1–18', align: 'right', format: 'number' },
        { key: 'perubahan', label: ctx.lang === 'id' ? 'Perubahan %' : 'Change %', align: 'right', format: 'percent' },
      ],
      rows.map((r) => ({ category: str(r.category), okt: num(r.okt_tgl_1_18), nov: num(r.nov_tgl_1_18), perubahan: num(r.perubahan) })),
    ),
    visualizations: [barViz('v_category_change', ctx.lang === 'id' ? 'Perubahan volume kategori' : 'Category volume change', rows.map((r) => ({ category: str(r.category), perubahan: num(r.perubahan) })), 'category', 'perubahan', '%', 'percent')],
    sql: sqlBlock(query, rows.length),
    sources: [dsWithSql(ctx, query)],
    followUps: topFollowUps(ctx),
    mode: 'sql',
    contextUpdates: { metric: 'volume' },
    rowCount: rows.length,
  };
}

/* ============================================================ C handlers */

function hC1FailureChange(ctx: HandlerCtx): DraftResult {
  const query = `SELECT channel_name, ROUND(100.0*SUM(CASE WHEN substr(transaction_date,1,7)='2026-09' AND status='FAILED' THEN 1 ELSE 0 END)/SUM(CASE WHEN substr(transaction_date,1,7)='2026-09' THEN 1 ELSE 0 END),2) AS fr_sep, ROUND(100.0*SUM(CASE WHEN substr(transaction_date,1,7)='2026-10' AND status='FAILED' THEN 1 ELSE 0 END)/SUM(CASE WHEN substr(transaction_date,1,7)='2026-10' THEN 1 ELSE 0 END),2) AS fr_okt, ROUND(100.0*SUM(CASE WHEN substr(transaction_date,1,7)='2026-11' AND status='FAILED' THEN 1 ELSE 0 END)/SUM(CASE WHEN substr(transaction_date,1,7)='2026-11' THEN 1 ELSE 0 END),2) AS fr_nov FROM ${ctx.scope.table} GROUP BY channel_name ORDER BY fr_nov DESC`;
  const rows = allRows(ctx.db, query);
  const top = rows.slice(0, 3);
  const answer = ctx.lang === 'id'
    ? `Kenaikan failure rate tidak merata: ${top.map((r) => `${str(r.channel_name)} ${fmtPct(num(r.fr_sep), ctx.lang)} → ${fmtPct(num(r.fr_okt), ctx.lang)} → ${fmtPct(num(r.fr_nov), ctx.lang)}`).join('; ')}. Kanal lain relatif stabil. Ini indikasi, bukan sebab terbukti.`
    : `The failure-rate increase is uneven: ${top.map((r) => `${str(r.channel_name)} ${fmtPct(num(r.fr_sep), ctx.lang)} → ${fmtPct(num(r.fr_okt), ctx.lang)} → ${fmtPct(num(r.fr_nov), ctx.lang)}`).join('; ')}. Other channels are relatively stable. This is an indication, not a proven cause.`;
  return {
    answer,
    keyFindings: top.map((r) => ({ text: `${str(r.channel_name)}: ${fmtPct(num(r.fr_sep), ctx.lang)} (Sep) → ${fmtPct(num(r.fr_okt), ctx.lang)} (Okt) → ${fmtPct(num(r.fr_nov), ctx.lang)} (Nov).`, ref: `sql:channel:${str(r.channel_name)}` })),
    supportingTable: table(
      [
        { key: 'channel', label: ctx.lang === 'id' ? 'Kanal' : 'Channel' },
        { key: 'fr_sep', label: 'Sep', align: 'right', format: 'percent' },
        { key: 'fr_okt', label: 'Okt', align: 'right', format: 'percent' },
        { key: 'fr_nov', label: 'Nov', align: 'right', format: 'percent' },
      ],
      rows.map((r) => ({ channel: str(r.channel_name), fr_sep: num(r.fr_sep), fr_okt: num(r.fr_okt), fr_nov: num(r.fr_nov) })),
    ),
    visualizations: [barViz('v_failure_change', ctx.lang === 'id' ? 'Failure rate Nov per kanal' : 'Nov failure rate by channel', rows.map((r) => ({ channel: str(r.channel_name), fr_nov: num(r.fr_nov) })), 'channel', 'fr_nov', '%', 'percent')],
    sql: sqlBlock(query, rows.length),
    sources: [dsWithSql(ctx, query)],
    followUps: ctx.lang === 'id'
      ? ['Kanal mana yang paling berkontribusi?', 'Sejak kapan perubahan itu terjadi?', 'Kode kegagalan apa yang dominan?']
      : ['Which channel contributes most?', 'When did the change start?', 'Which failure code dominates?'],
    mode: 'sql',
    contextUpdates: { metric: 'failureRate', channel: str(top[0]?.channel_name) || null },
    rowCount: rows.length,
  };
}

function hC2FailureCode(ctx: HandlerCtx): DraftResult {
  const query = `SELECT t.failure_code, f.failure_name, f.failure_type, ROUND(1000.0*SUM(CASE WHEN substr(t.transaction_date,1,7)='2026-09' THEN 1 ELSE 0 END)/(SELECT COUNT(*) FROM ${ctx.scope.table} WHERE substr(transaction_date,1,7)='2026-09'),1) AS per_1000_sep, ROUND(1000.0*SUM(CASE WHEN substr(t.transaction_date,1,7)='2026-10' THEN 1 ELSE 0 END)/(SELECT COUNT(*) FROM ${ctx.scope.table} WHERE substr(transaction_date,1,7)='2026-10'),1) AS per_1000_okt, ROUND(1000.0*SUM(CASE WHEN substr(t.transaction_date,1,7)='2026-11' THEN 1 ELSE 0 END)/(SELECT COUNT(*) FROM ${ctx.scope.table} WHERE substr(transaction_date,1,7)='2026-11'),1) AS per_1000_nov FROM ${ctx.scope.table} t JOIN seed.failure_codes f USING(failure_code) WHERE t.status='FAILED' GROUP BY t.failure_code, f.failure_name, f.failure_type ORDER BY per_1000_nov DESC`;
  const rows = allRows(ctx.db, query);
  const top = rows.slice(0, 5);
  const answer = ctx.lang === 'id'
    ? `Kode kegagalan teratas per 1.000 transaksi: ${top.map((r) => `${str(r.failure_code)} ${str(r.failure_name)} (${str(r.failure_type)}) ${fmtN(num(r.per_1000_sep), ctx.lang)} → ${fmtN(num(r.per_1000_okt), ctx.lang)} → ${fmtN(num(r.per_1000_nov), ctx.lang)}`).join('; ')}. F04 dan F05 naik tajam; kode kesalahan pengguna relatif stabil.`
    : `Top failure codes per 1,000 transactions: ${top.map((r) => `${str(r.failure_code)} ${str(r.failure_name)} (${str(r.failure_type)}) ${fmtN(num(r.per_1000_sep), ctx.lang)} → ${fmtN(num(r.per_1000_okt), ctx.lang)} → ${fmtN(num(r.per_1000_nov), ctx.lang)}`).join('; ')}. F04 and F05 rose sharply; user-error codes are relatively stable.`;
  return {
    answer,
    keyFindings: top.slice(0, 3).map((r) => ({ text: `${str(r.failure_code)} ${str(r.failure_name)} (${str(r.failure_type)}): ${fmtN(num(r.per_1000_sep), ctx.lang)} → ${fmtN(num(r.per_1000_okt), ctx.lang)} → ${fmtN(num(r.per_1000_nov), ctx.lang)} per 1.000.`, ref: `sql:code:${str(r.failure_code)}` })),
    supportingTable: table(
      [
        { key: 'code', label: ctx.lang === 'id' ? 'Kode' : 'Code' },
        { key: 'name', label: ctx.lang === 'id' ? 'Nama' : 'Name' },
        { key: 'type', label: ctx.lang === 'id' ? 'Jenis' : 'Type' },
        { key: 'sep', label: 'Sep', align: 'right', format: 'number' },
        { key: 'okt', label: 'Okt', align: 'right', format: 'number' },
        { key: 'nov', label: 'Nov', align: 'right', format: 'number' },
      ],
      rows.map((r) => ({ code: str(r.failure_code), name: str(r.failure_name), type: str(r.failure_type), sep: num(r.per_1000_sep), okt: num(r.per_1000_okt), nov: num(r.per_1000_nov) })),
    ),
    visualizations: [barViz('v_failure_code', ctx.lang === 'id' ? 'Kode kegagalan per 1.000 (Nov)' : 'Failure codes per 1,000 (Nov)', rows.map((r) => ({ code: str(r.failure_code), nov: num(r.per_1000_nov) })), 'code', 'nov', 'tx')],
    sql: sqlBlock(query, rows.length),
    sources: [dsWithSql(ctx, query)],
    followUps: topFollowUps(ctx),
    mode: 'sql',
    contextUpdates: { metric: 'failureRate' },
    rowCount: rows.length,
  };
}

function hC3Concentration(ctx: HandlerCtx): DraftResult {
  const qCat = `SELECT category, COUNT(*) AS total, ROUND(100.0*SUM(status='FAILED')/COUNT(*),1) AS failure_rate_pct FROM ${ctx.scope.table} WHERE channel_name='VA Mandiri' AND transaction_date>='2026-10-15' GROUP BY category ORDER BY failure_rate_pct DESC`;
  const qHour = `SELECT CASE WHEN CAST(substr(created_at,12,2) AS INTEGER) BETWEEN 18 AND 22 THEN '18:00-22:59' ELSE 'jam lain' END AS jam, COUNT(*) AS total, ROUND(100.0*SUM(status='FAILED')/COUNT(*),1) AS failure_rate_pct FROM ${ctx.scope.table} WHERE channel_name='VA Mandiri' AND transaction_date>='2026-10-15' GROUP BY 1`;
  const qOvo = `SELECT category, COUNT(*) AS total, ROUND(100.0*SUM(status='FAILED')/COUNT(*),1) AS failure_rate_pct FROM ${ctx.scope.table} WHERE channel_name='OVO' AND transaction_date>='2026-11-06' GROUP BY category ORDER BY failure_rate_pct DESC`;
  const catRows = allRows(ctx.db, qCat);
  const hourRows = allRows(ctx.db, qHour);
  const ovoRows = allRows(ctx.db, qOvo);
  const vaStr = catRows.map((r) => `${str(r.category)} ${fmtPct(num(r.failure_rate_pct), ctx.lang, 1)}`).join('; ');
  const hourStr = hourRows.map((r) => `${str(r.jam)} ${fmtPct(num(r.failure_rate_pct), ctx.lang, 1)}`).join('; ');
  const ovoStr = ovoRows.map((r) => `${str(r.category)} ${fmtPct(num(r.failure_rate_pct), ctx.lang, 1)}`).join('; ');
  const answer = ctx.lang === 'id'
    ? `Konsentrasi kegagalan: VA Mandiri sejak 15 Okt — ${vaStr}; jam ${hourStr}. OVO sejak 6 Nov — ${ovoStr}. Ini indikasi konsentrasi, bukan sebab terbukti.`
    : `Failure concentration: VA Mandiri since Oct 15 — ${vaStr}; hours ${hourStr}. OVO since Nov 6 — ${ovoStr}. This is concentration evidence, not a proven cause.`;
  const rows = [
    ...catRows.map((r) => ({ kanal: 'VA Mandiri', category: str(r.category), total: num(r.total), rate: num(r.failure_rate_pct) })),
    ...ovoRows.map((r) => ({ kanal: 'OVO', category: str(r.category), total: num(r.total), rate: num(r.failure_rate_pct) })),
  ];
  return {
    answer,
    keyFindings: [
      { text: `VA Mandiri kategori tertinggi: ${str(catRows[0]?.category)} ${fmtPct(num(catRows[0]?.failure_rate_pct), ctx.lang, 1)}.`, ref: 'sql:concentration' },
      { text: `VA Mandiri jam sibuk: ${hourStr}.`, ref: 'sql:concentration' },
      { text: `OVO kategori tertinggi: ${str(ovoRows[0]?.category)} ${fmtPct(num(ovoRows[0]?.failure_rate_pct), ctx.lang, 1)}.`, ref: 'sql:concentration' },
    ],
    supportingTable: table(
      [
        { key: 'kanal', label: ctx.lang === 'id' ? 'Kanal' : 'Channel' },
        { key: 'category', label: ctx.lang === 'id' ? 'Kategori' : 'Category' },
        { key: 'total', label: 'Total', align: 'right', format: 'number' },
        { key: 'rate', label: 'Failure rate', align: 'right', format: 'percent' },
      ],
      rows,
    ),
    visualizations: [barViz('v_concentration', ctx.lang === 'id' ? 'Konsentrasi failure rate per kategori' : 'Failure-rate concentration by category', rows.map((r) => ({ category: `${r.kanal}: ${r.category}`, rate: r.rate })), 'category', 'rate', '%', 'percent')],
    sql: sqlBlock(qCat, rows.length),
    sources: [dsWithSql(ctx, qCat)],
    followUps: topFollowUps(ctx),
    mode: 'sql',
    contextUpdates: { metric: 'failureRate', channel: 'VA Mandiri' },
    rowCount: rows.length,
  };
}

/* ============================================================ E handlers */

function hE1Excess(ctx: HandlerCtx): DraftResult {
  const query = `WITH s AS (SELECT channel_name, COUNT(*) n, SUM(status='FAILED') f FROM ${ctx.scope.table} WHERE substr(transaction_date,1,7)='2026-09' GROUP BY 1), v AS (SELECT channel_name, COUNT(*) n, SUM(status='FAILED') f FROM ${ctx.scope.table} WHERE transaction_date>='2026-11-01' GROUP BY 1) SELECT v.channel_name, v.n AS total_nov, v.f AS gagal_nov, ROUND(v.n*1.0*s.f/s.n,1) AS gagal_jika_tingkat_sep, ROUND(v.f - v.n*1.0*s.f/s.n,1) AS kelebihan_gagal FROM v JOIN s USING(channel_name) ORDER BY kelebihan_gagal DESC`;
  const rows = allRows(ctx.db, query);
  const top = rows.slice(0, 2);
  const answer = ctx.lang === 'id'
    ? `Kontribusi kelebihan gagal vs baseline Sep: ${rows.map((r) => `${str(r.channel_name)} ${fmtN(num(r.gagal_nov), ctx.lang)} gagal (kelebihan ${num(r.kelebihan_gagal) >= 0 ? '+' : ''}${fmtN(num(r.kelebihan_gagal), ctx.lang)})`).join('; ')}. Kontributor terbesar: ${str(top[0]?.channel_name)}, lalu ${str(top[1]?.channel_name)}.`
    : `Excess failures vs September baseline: ${rows.map((r) => `${str(r.channel_name)} ${fmtN(num(r.gagal_nov), ctx.lang)} failed (excess ${num(r.kelebihan_gagal) >= 0 ? '+' : ''}${fmtN(num(r.kelebihan_gagal), ctx.lang)})`).join('; ')}. Largest contributor: ${str(top[0]?.channel_name)}, then ${str(top[1]?.channel_name)}.`;
  return {
    answer,
    keyFindings: top.map((r) => ({ text: `${str(r.channel_name)}: ${fmtN(num(r.gagal_nov), ctx.lang)} gagal, kelebihan ${num(r.kelebihan_gagal) >= 0 ? '+' : ''}${fmtN(num(r.kelebihan_gagal), ctx.lang)} vs tingkat Sep.`, ref: `sql:excess:${str(r.channel_name)}` })),
    supportingTable: table(
      [
        { key: 'channel', label: ctx.lang === 'id' ? 'Kanal' : 'Channel' },
        { key: 'total_nov', label: 'Total Nov', align: 'right', format: 'number' },
        { key: 'gagal_nov', label: ctx.lang === 'id' ? 'Gagal Nov' : 'Failed Nov', align: 'right', format: 'number' },
        { key: 'kelebihan', label: ctx.lang === 'id' ? 'Kelebihan gagal' : 'Excess failures', align: 'right', format: 'number' },
      ],
      rows.map((r) => ({ channel: str(r.channel_name), total_nov: num(r.total_nov), gagal_nov: num(r.gagal_nov), kelebihan: num(r.kelebihan_gagal) })),
    ),
    visualizations: [barViz('v_excess', ctx.lang === 'id' ? 'Kelebihan gagal per kanal' : 'Excess failures by channel', rows.map((r) => ({ channel: str(r.channel_name), kelebihan: num(r.kelebihan_gagal) })), 'channel', 'kelebihan', 'tx')],
    sql: sqlBlock(query, rows.length),
    sources: [dsWithSql(ctx, query)],
    followUps: ctx.lang === 'id'
      ? ['Sejak kapan perubahan itu terjadi?', 'Data apa yang mendukung kesimpulan itu?', 'Apakah dokumen relevan menjelaskan pola ini?']
      : ['When did the change start?', 'What data supports this conclusion?', 'Do the documents explain this pattern?'],
    mode: 'sql',
    contextUpdates: { metric: 'failureRate', channel: str(top[0]?.channel_name) || null },
    rowCount: rows.length,
  };
}

function hE2ChangePoint(ctx: HandlerCtx): DraftResult {
  const channel = ctx.filters.channel ?? ctx.context.channel ?? 'VA Mandiri';
  const qWeek = `SELECT date(transaction_date, 'weekday 0', '-6 days') AS awal_minggu, COUNT(*) AS total, ROUND(100.0*SUM(status='FAILED')/COUNT(*),2) AS failure_rate_pct FROM ${ctx.scope.table} WHERE channel_name='${channel}' AND transaction_date>='2026-09-21' GROUP BY 1 ORDER BY 1`;
  const qDay = `SELECT transaction_date, COUNT(*) AS total, ROUND(100.0*SUM(status='FAILED')/COUNT(*),1) AS failure_rate_pct FROM ${ctx.scope.table} WHERE channel_name='OVO' AND transaction_date BETWEEN '2026-11-01' AND '2026-11-12' GROUP BY 1 ORDER BY 1`;
  const weekRows = allRows(ctx.db, qWeek);
  const dayRows = allRows(ctx.db, qDay);
  const weekStr = weekRows.map((r) => `${str(r.awal_minggu)}: ${fmtPct(num(r.failure_rate_pct), ctx.lang)}`).join('; ');
  const answer = ctx.lang === 'id'
    ? `Titik perubahan ${channel}: memburuk sekitar 15 Okt (mingguan ${weekStr}); memburuk lagi sekitar 3 Nov. OVO mulai 6 Nov (${fmtPct(num(dayRows.find((r) => str(r.transaction_date) === '2026-11-06')?.failure_rate_pct ?? 0), ctx.lang, 1)} pada 2026-11-06). Volume harian kecil sehingga agregasi mingguan lebih stabil; minggu 16 Nov hanya 3 hari (parsial).`
    : `Change point for ${channel}: worsened around Oct 15 (weekly ${weekStr}); worsened again around Nov 3. OVO started Nov 6 (${fmtPct(num(dayRows.find((r) => str(r.transaction_date) === '2026-11-06')?.failure_rate_pct ?? 0), ctx.lang, 1)} on 2026-11-06). Daily volumes are small, so weekly aggregation is more stable; the Nov 16 week has only 3 days (partial).`;
  return {
    answer,
    keyFindings: [
      { text: `${channel}: titik perubahan sekitar 15 Okt dan 3 Nov.`, ref: 'sql:change_point' },
      { text: `OVO: titik perubahan sekitar 6 Nov.`, ref: 'sql:change_point' },
      { text: ctx.lang === 'id' ? 'Minggu 16 Nov parsial (3 hari).' : 'Nov 16 week is partial (3 days).', ref: 'period' },
    ],
    supportingTable: table(
      [
        { key: 'kanal', label: ctx.lang === 'id' ? 'Kanal' : 'Channel' },
        { key: 'bucket', label: ctx.lang === 'id' ? 'Periode' : 'Bucket' },
        { key: 'total', label: 'Total', align: 'right', format: 'number' },
        { key: 'rate', label: 'Failure rate', align: 'right', format: 'percent' },
      ],
      [
        ...weekRows.map((r) => ({ kanal: channel, bucket: str(r.awal_minggu), total: num(r.total), rate: num(r.failure_rate_pct) })),
        ...dayRows.map((r) => ({ kanal: 'OVO', bucket: str(r.transaction_date), total: num(r.total), rate: num(r.failure_rate_pct) })),
      ],
    ),
    visualizations: [lineViz('v_change_point', ctx.lang === 'id' ? 'Titik perubahan mingguan' : 'Weekly change points', weekRows.map((r) => ({ bucket: str(r.awal_minggu), rate: num(r.failure_rate_pct) })), 'bucket', [{ key: 'rate', label: 'Failure rate', unit: '%' }], 'percent')],
    sql: sqlBlock(qWeek, weekRows.length + dayRows.length),
    sources: [dsWithSql(ctx, qWeek)],
    followUps: ctx.lang === 'id'
      ? ['Data apa yang mendukung kesimpulan itu?', 'Apakah dokumen relevan menjelaskan pola ini?', 'Kode kegagalan apa yang dominan?']
      : ['What data supports this conclusion?', 'Do the documents explain this pattern?', 'Which failure code dominates?'],
    mode: 'sql',
    contextUpdates: { metric: 'failureRate', channel },
    rowCount: weekRows.length + dayRows.length,
  };
}

function hE3Processing(ctx: HandlerCtx): DraftResult {
  const query = `SELECT channel_name, CASE WHEN transaction_date < '2026-10-15' THEN 'sebelum' ELSE 'sesudah' END AS periode, COUNT(*) AS transaksi_sukses, ROUND(AVG(processing_time_ms),0) AS rata2_processing_ms FROM ${ctx.scope.table} WHERE status='SUCCESS' AND channel_name IN ('VA Mandiri','OVO') GROUP BY 1,2 ORDER BY 1,2 DESC`;
  const rows = allRows(ctx.db, query);
  const va = rows.filter((r) => str(r.channel_name) === 'VA Mandiri');
  const ovo = rows.filter((r) => str(r.channel_name) === 'OVO');
  const vaBefore = num(va.find((r) => str(r.periode) === 'sebelum')?.rata2_processing_ms);
  const vaAfter = num(va.find((r) => str(r.periode) === 'sesudah')?.rata2_processing_ms);
  const ovoBefore = num(ovo.find((r) => str(r.periode) === 'sebelum')?.rata2_processing_ms);
  const ovoAfter = num(ovo.find((r) => str(r.periode) === 'sesudah')?.rata2_processing_ms);
  const answer = ctx.lang === 'id'
    ? `Waktu proses naik setelah titik perubahan: VA Mandiri ${fmtN(vaBefore, ctx.lang)} → ${fmtN(vaAfter, ctx.lang)} ms (naik ~${fmtN(round1(vaAfter / (vaBefore || 1)), ctx.lang)}x); OVO ${fmtN(ovoBefore, ctx.lang)} → ${fmtN(ovoAfter, ctx.lang)} ms (naik ~${fmtN(round1(ovoAfter / (ovoBefore || 1)), ctx.lang)}x). Indikator degradasi layanan.`
    : `Processing time rose after the change point: VA Mandiri ${fmtN(vaBefore, ctx.lang)} → ${fmtN(vaAfter, ctx.lang)} ms (up ~${fmtN(round1(vaAfter / (vaBefore || 1)), ctx.lang)}x); OVO ${fmtN(ovoBefore, ctx.lang)} → ${fmtN(ovoAfter, ctx.lang)} ms (up ~${fmtN(round1(ovoAfter / (ovoBefore || 1)), ctx.lang)}x). A service-degradation indicator.`;
  return {
    answer,
    keyFindings: [
      { text: `VA Mandiri: ${fmtN(vaBefore, ctx.lang)} → ${fmtN(vaAfter, ctx.lang)} ms.`, ref: 'sql:processing' },
      { text: `OVO: ${fmtN(ovoBefore, ctx.lang)} → ${fmtN(ovoAfter, ctx.lang)} ms.`, ref: 'sql:processing' },
    ],
    supportingTable: table(
      [
        { key: 'channel', label: ctx.lang === 'id' ? 'Kanal' : 'Channel' },
        { key: 'periode', label: ctx.lang === 'id' ? 'Periode' : 'Period' },
        { key: 'sukses', label: ctx.lang === 'id' ? 'Transaksi sukses' : 'Successful', align: 'right', format: 'number' },
        { key: 'ms', label: ctx.lang === 'id' ? 'Rata-rata ms' : 'Avg ms', align: 'right', format: 'number' },
      ],
      rows.map((r) => ({ channel: str(r.channel_name), periode: str(r.periode), sukses: num(r.transaksi_sukses), ms: num(r.rata2_processing_ms) })),
    ),
    visualizations: [barViz('v_processing', ctx.lang === 'id' ? 'Processing time sebelum/sesudah' : 'Processing time before/after', rows.map((r) => ({ label: `${str(r.channel_name)} ${str(r.periode)}`, ms: num(r.rata2_processing_ms) })), 'label', 'ms', 'tx')],
    sql: sqlBlock(query, rows.length),
    sources: [dsWithSql(ctx, query)],
    followUps: topFollowUps(ctx),
    mode: 'sql',
    contextUpdates: { metric: 'failureRate', channel: 'VA Mandiri' },
    rowCount: rows.length,
  };
}

/* ============================================================ F1 hybrid */

function hF1Hybrid(ctx: HandlerCtx): DraftResult {
  const channel = ctx.filters.channel ?? ctx.context.channel ?? 'VA Mandiri';
  const query = `SELECT ROUND(100.0*SUM(status='FAILED')/COUNT(*),2) AS fr FROM ${ctx.scope.table} WHERE channel_name='${channel}' AND transaction_date BETWEEN '${ctx.period.start}' AND '${ctx.period.end}'`;
  const row = oneRow(ctx.db, query);
  const fr = num(row?.fr);
  const docs = retrieveDocuments(ctx.db, 'failure rate level eskalasi P1 P2 P3 SOP threshold', ctx.lang);
  const sopDoc = docs.find((d) => (d.docTitle ?? '').includes('SOP') && (d.section ?? '').includes('Eskalasi')) ?? docs[0];
  // Level ditentukan oleh angka failure rate vs ambang SOP §6, bukan oleh
  // kemunculan "Pn" pertama dalam kutipan (quote bisa mulai dari P3).
  const level = fr > 10 ? 'P1' : fr > 5 ? 'P2' : fr > 4 ? 'P3' : 'P3';
  const levelDesc: Record<string, string> = {
    P1: ctx.lang === 'id'
      ? 'di atas 10% selama 15 menit atau kanal tidak merespons; respons 15 menit, target pemulihan 4 jam, eskalasi ke CTO dan Head of Operations'
      : 'above 10% for 15 minutes or channel unresponsive; 15-minute response, 4-hour recovery target, escalation to CTO and Head of Operations',
    P2: ctx.lang === 'id'
      ? 'di atas 5%–10% selama 30 menit; respons 1 jam, target pemulihan 8 jam, eskalasi ke Head of Operations'
      : 'above 5%–10% for 30 minutes; 1-hour response, 8-hour recovery target, escalation to Head of Operations',
    P3: ctx.lang === 'id'
      ? 'di atas 4%–5% selama 60 menit atau naik >2 poin vs rata-rata 7 hari; respons 4 jam kerja, eskalasi ke Payment Operations Lead'
      : 'above 4%–5% for 60 minutes or up >2 points vs 7-day average; 4-business-hour response, escalation to Payment Operations Lead',
  };
  const answer = ctx.lang === 'id'
    ? `Failure rate ${channel} ${ctx.period.label} = ${fmtPct(fr, ctx.lang)} (angka bulanan adalah rata-rata). Menurut SOP-TRX-003 Bagian 6, level eskalasi = ${level}: ${levelDesc[level]}. Klasifikasi formal bergantung pada durasi di atas threshold.`
    : `Failure rate for ${channel} in ${ctx.period.label} = ${fmtPct(fr, ctx.lang)} (the monthly figure is an average). Per SOP-TRX-003 section 6, escalation level = ${level}: ${levelDesc[level]}. Formal classification depends on duration above the threshold.`;
  const sources: SourceCitation[] = [dsWithSql(ctx, query)];
  if (sopDoc) sources.push(sopDoc);
  return {
    answer,
    keyFindings: [
      { text: `${channel} failure rate: ${fmtPct(fr, ctx.lang)}.`, ref: 'sql:summary' },
      { text: `Level eskalasi SOP: ${level}.`, ref: `doc:${sopDoc?.sourceId ?? 'sop'}` },
    ],
    supportingTable: table(
      [
        { key: 'metric', label: ctx.lang === 'id' ? 'Metrik' : 'Metric' },
        { key: 'value', label: ctx.lang === 'id' ? 'Nilai' : 'Value' },
      ],
      [
        { metric: 'Failure rate', value: fr },
        { metric: 'Level eskalasi', value: level },
      ],
    ),
    visualizations: [kpiViz([{ label: 'Failure rate', value: fr }], ctx.lang)],
    sql: sqlBlock(query, 1),
    sources,
    followUps: ctx.lang === 'id'
      ? ['Sejak kapan failure rate kanal ini naik?', 'Kode kegagalan apa yang dominan?', 'Apa prosedur penanganan menurut SOP?']
      : ['When did this channel failure rate rise?', 'Which failure code dominates?', 'What is the SOP handling procedure?'],
    mode: 'hybrid',
    contextUpdates: { metric: 'failureRate', channel, docRefs: sopDoc ? [sopDoc.sourceId] : [] },
    rowCount: 1,
  };
}

/* ============================================================ D handlers (RAG) */

function ragDraft(ctx: HandlerCtx, question: string, answer: string, keyFindings: { text: string; ref?: string }[], followUps: string[]): DraftResult {
  const docs = retrieveDocuments(ctx.db, question, ctx.lang);
  return {
    answer,
    keyFindings,
    supportingTable: null,
    visualizations: [],
    sql: null,
    sources: docs,
    followUps,
    mode: 'rag',
    contextUpdates: { docRefs: [...new Set(docs.map((d) => d.sourceId))] },
    rowCount: docs.length,
  };
}

function hD1Sop(ctx: HandlerCtx): DraftResult {
  const answer = ctx.lang === 'id'
    ? 'Prosedur ketika transaksi gagal (SOP-TRX-003 Bagian 4), tujuh langkah: (1) Deteksi — sistem mencatat status FAILED beserta kode kegagalan dan menampilkan pesan yang sesuai kepada pelanggan. (2) Klasifikasi — kelompokkan kegagalan ke salah satu jenis (Kesalahan Pengguna, Penyedia, Teknis Internal, Risiko dan Fraud, Jaringan) berdasarkan Katalog Kode Kegagalan. (3) Verifikasi dana — lakukan status inquiry ke provider untuk memastikan apakah dana pelanggan sudah terdebet. (4) Tindakan — jalankan prosedur sesuai jenis kegagalan (Bagian 5). (5) Komunikasi — informasikan pelanggan dan merchant mengenai status serta estimasi penyelesaian. (6) Rekonsiliasi dan refund — jika dana terdebet tetapi transaksi gagal, proses refund sesuai SLA pada Bagian 7. (7) Pencatatan — seluruh kasus dan insiden dicatat pada incident log dan dilaporkan dalam laporan operasional bulanan.'
    : 'Procedure when a transaction fails (SOP-TRX-003 section 4), seven steps: (1) Detection — the system records FAILED status with the failure code and shows an appropriate message to the customer. (2) Classification — group the failure into a type (User Error, Provider, Internal Technical, Risk & Fraud, Network) per the Failure Code Catalog. (3) Fund verification — perform a status inquiry to the provider to confirm whether customer funds were debited. (4) Action — run the procedure for the failure type (section 5). (5) Communication — inform the customer and merchant about status and estimated resolution. (6) Reconciliation and refund — if funds were debited but the transaction failed, process a refund per the SLA in section 7. (7) Logging — record all cases and incidents in the incident log and monthly operational reports.';
  return ragDraft(ctx, 'prosedur ketika transaksi gagal SOP langkah', answer, [
    { text: '7 langkah SOP (SOP-TRX-003 Bagian 4).', ref: 'doc:sop' },
  ], ctx.lang === 'id' ? ['Apa perbedaan penanganan tiap jenis kegagalan?', 'Berapa SLA refund tiap kanal?', 'Kapan kanal harus dieskalasi?'] : ['How does handling differ by failure type?', 'What is the refund SLA by channel?', 'When must a channel be escalated?']);
}

function hD2Causes(ctx: HandlerCtx): DraftResult {
  const answer = ctx.lang === 'id'
    ? 'Penyebab umum kegagalan transaksi (Katalog Kode Kegagalan, Bagian 2–3): Kesalahan Pengguna — saldo kurang, OTP/PIN salah atau kedaluwarsa, limit transaksi terlampaui, nomor VA atau akun tidak valid. Penyedia (Bank/Wallet) — penolakan issuer, timeout bank, perubahan API/rate limit, pemeliharaan terjadwal. Teknis Internal — bug rilis, kegagalan validasi payload, konfigurasi merchant salah, transaksi duplikat. Risiko dan Fraud — transaksi ditahan oleh aturan deteksi risiko. Jaringan — gangguan konektivitas gateway-provider, DNS, ISP, atau cloud.'
    : 'Common causes of transaction failure (Failure Code Catalog, sections 2–3): User Error — insufficient balance, wrong/expired OTP or PIN, exceeded limits, invalid VA number or account. Provider (Bank/Wallet) — issuer declines, bank timeouts, API/rate-limit changes, scheduled maintenance. Internal Technical — release bugs, payload validation failures, merchant misconfiguration, duplicate transactions. Risk & Fraud — transactions held by risk-detection rules. Network — gateway-provider connectivity, DNS, ISP, or cloud issues.';
  return ragDraft(ctx, 'penyebab umum kegagalan transaksi katalog jenis', answer, [
    { text: '5 kelompok penyebab (Katalog Bagian 2–3).', ref: 'doc:catalog' },
  ], ctx.lang === 'id' ? ['Apa prosedur penanganan tiap jenis?', 'Kode F04 berarti apa?', 'Bagaimana pola kenaikan kegagalan didiagnosis?'] : ['What is the handling procedure per type?', 'What does code F04 mean?', 'How are failure-increase patterns diagnosed?']);
}

function hD3ByType(ctx: HandlerCtx): DraftResult {
  const answer = ctx.lang === 'id'
    ? 'Perbedaan prosedur penanganan per jenis kegagalan (SOP-TRX-003 Bagian 5): Kesalahan Pengguna — edukasi, retry maksimal 3 kali dalam 10 menit, kunci akun 30 menit setelah 3 kali salah OTP/PIN, tanpa eskalasi. Penyedia — status inquiry, retry 1 kali, tiket ke provider dan eskalasi ke Integration Team bila failure rate kanal di atas 5% (F04); F03 arahkan ke bank penerbit; F12 tidak dihitung sebagai pelanggaran SLA. Teknis Internal — buat insiden, periksa deployment 24 jam terakhir, rollback atau hotfix bila terkait rilis. Risiko dan Fraud — tahan transaksi dan review manual Risk Team dalam 2 jam kerja. Jaringan — retry otomatis 2 kali; bila serentak lintas kanal, eskalasi ke Infrastructure Team.'
    : 'Handling differences by failure type (SOP-TRX-003 section 5): User Error — education, retry up to 3 times within 10 minutes, lock the account for 30 minutes after 3 wrong OTP/PIN attempts, no escalation. Provider — status inquiry, one retry, ticket to the provider and escalation to the Integration Team when channel failure rate exceeds 5% (F04); F03 redirect to the issuing bank; F12 is not counted as an SLA breach. Internal Technical — open an incident, review deployments in the last 24 hours, rollback or hotfix if release-related. Risk & Fraud — hold the transaction for manual Risk Team review within 2 business hours. Network — two automatic retries; if simultaneous across channels, escalate to the Infrastructure Team.';
  return ragDraft(ctx, 'perbedaan prosedur penanganan jenis kegagalan SOP', answer, [
    { text: 'Prosedur per jenis (SOP-TRX-003 Bagian 5).', ref: 'doc:sop' },
  ], ctx.lang === 'id' ? ['Berapa SLA refund tiap kanal?', 'Kapan kanal harus dieskalasi?', 'Ringkas SOP penanganan fraud'] : ['What is the refund SLA by channel?', 'When must a channel be escalated?', 'Summarize the fraud-handling SOP']);
}

function hD4RefundSla(ctx: HandlerCtx): DraftResult {
  const answer = ctx.lang === 'id'
    ? 'SLA pengembalian dana (refund) per kanal (SOP-TRX-003 Bagian 7; FAQ Customer Support no. 1): Virtual Account 3 hari kerja; E-Wallet maksimal 2 × 24 jam; QRIS 2 hari kerja; Kartu Kredit 7–14 hari kerja. Jika dana belum kembali setelah SLA terlewati, hubungi Customer Support dengan menyertakan nomor transaksi.'
    : 'Refund SLA by channel (SOP-TRX-003 section 7; Customer Support FAQ no. 1): Virtual Account 3 business days; E-Wallet up to 2 × 24 hours; QRIS 2 business days; Credit Card 7–14 business days. If funds have not returned after the SLA, contact Customer Support with the transaction number.';
  return ragDraft(ctx, 'SLA pengembalian dana refund kanal virtual account e-wallet QRIS kartu kredit', answer, [
    { text: 'VA 3 hari kerja; E-Wallet maks 2×24 jam; QRIS 2 hari kerja; Kartu Kredit 7–14 hari kerja.', ref: 'doc:sop' },
  ], ctx.lang === 'id' ? ['Kapan PENDING menjadi FAILED?', 'Berapa masa berlaku VA/QRIS/e-wallet?', 'Apa prosedur refund bila dana terdebet?'] : ['When does PENDING become FAILED?', 'What are the VA/QRIS/e-wallet validity periods?', 'What is the refund procedure if funds were debited?']);
}

function hD5Escalation(ctx: HandlerCtx): DraftResult {
  const answer = ctx.lang === 'id'
    ? 'Ambang eskalasi (SOP-TRX-003 Bagian 6): P3 (Sedang) — failure rate kanal di atas 4%–5% selama 60 menit, atau naik lebih dari 2 poin vs rata-rata 7 hari; respons 4 jam kerja, target pemulihan 2 hari kerja, eskalasi ke Payment Operations Lead. P2 (Tinggi) — failure rate di atas 5%–10% selama 30 menit; respons 1 jam, target pemulihan 8 jam, eskalasi ke Head of Operations. P1 (Kritis) — failure rate di atas 10% selama 15 menit, atau kanal tidak merespons; respons 15 menit, target pemulihan 4 jam, eskalasi ke CTO dan Head of Operations. Khusus Kartu Kredit, threshold diterapkan terhadap kenaikan relatif dari baseline kanal (4%–7%).'
    : 'Escalation thresholds (SOP-TRX-003 section 6): P3 (Moderate) — channel failure rate above 4%–5% for 60 minutes, or up more than 2 points vs the 7-day average; 4-business-hour response, 2-business-day recovery target, escalate to Payment Operations Lead. P2 (High) — failure rate above 5%–10% for 30 minutes; 1-hour response, 8-hour recovery target, escalate to Head of Operations. P1 (Critical) — failure rate above 10% for 15 minutes, or the channel is unresponsive; 15-minute response, 4-hour recovery target, escalate to CTO and Head of Operations. For Credit Card, thresholds apply to the relative increase from the channel baseline (4%–7%).';
  return ragDraft(ctx, 'ambang eskalasi P1 P2 P3 failure rate threshold SOP', answer, [
    { text: 'P3 >4–5%/60 menit; P2 >5–10%/30 menit; P1 >10%/15 menit atau kanal down.', ref: 'doc:sop' },
  ], ctx.lang === 'id' ? ['Berapa failure rate VA Mandiri bulan ini dan level eskalasinya?', 'Apa prosedur penanganan F04?', 'Siapa yang menerima eskalasi P1?'] : ['What is VA Mandiri failure rate this month and its escalation level?', 'What is the F04 handling procedure?', 'Who receives P1 escalations?']);
}

function hD6PendingExpired(ctx: HandlerCtx): DraftResult {
  const answer = ctx.lang === 'id'
    ? 'Siklus PENDING/EXPIRED (SOP-TRX-003 Bagian 3 & 7; FAQ no. 8): PENDING dicek ulang otomatis (status inquiry) setiap 5 menit selama 30 menit; bila tidak terkonfirmasi lebih dari 24 jam, diubah menjadi FAILED dan dana (bila terdebet) dikembalikan secara otomatis. EXPIRED — batas waktu pembayaran terlewati: VA default 24 jam (dapat dikonfigurasi 1–72 jam), QRIS dinamis 15 menit, e-wallet 30 menit. Transaksi EXPIRED tidak dihitung sebagai FAILED dan tidak memotong dana.'
    : 'PENDING/EXPIRED lifecycle (SOP-TRX-003 sections 3 & 7; FAQ no. 8): PENDING is automatically re-checked (status inquiry) every 5 minutes for 30 minutes; if unconfirmed for more than 24 hours it becomes FAILED and funds (if debited) are returned automatically. EXPIRED — the payment window has passed: VA default 24 hours (configurable 1–72 hours), dynamic QRIS 15 minutes, e-wallet 30 minutes. EXPIRED transactions are not counted as FAILED and do not debit funds.';
  return ragDraft(ctx, 'PENDING berubah FAILED masa berlaku VA QRIS e-wallet EXPIRED', answer, [
    { text: 'PENDING >24 jam → FAILED; VA 24 jam (1–72), QRIS 15 menit, e-wallet 30 menit.', ref: 'doc:sop' },
  ], ctx.lang === 'id' ? ['Berapa SLA refund tiap kanal?', 'Apa arti status REFUNDED?', 'Bagaimana prosedur rekonsiliasi harian?'] : ['What is the refund SLA by channel?', 'What does REFUNDED status mean?', 'How does daily reconciliation work?']);
}

function hD7Incident(ctx: HandlerCtx): DraftResult {
  const answer = ctx.lang === 'id'
    ? 'Status dan tindak lanjut insiden INC-2026-1015 (Catatan Insiden Operasional Okt–Nov 2026): Status OPEN per 17 Nov 2026. Tindak lanjut: eskalasi formal ke Head of Partnership – Bank Mandiri, evaluasi kanal cadangan, perbarui threshold alert. Sudah dilakukan retry otomatis 1 kali (24 Okt) dan kenaikan timeout internal dari 10 detik ke 20 detik (28 Okt). Bank Mandiri menerapkan rate limit pada endpoint v2 pada 3 Nov, sehingga failure rate memburuk kembali terutama pada jam sibuk.'
    : 'Status and follow-up for incident INC-2026-1015 (Operational Incident Notes Oct–Nov 2026): Status OPEN as of Nov 17, 2026. Follow-up: formal escalation to Head of Partnership – Bank Mandiri, evaluate backup channels, update alert thresholds. Already done: one automatic retry (Oct 24) and raising the internal timeout from 10 to 20 seconds (Oct 28). Bank Mandiri applied rate limiting on the v2 endpoint on Nov 3, worsening the failure rate especially during peak hours.';
  return ragDraft(ctx, 'status tindak lanjut insiden INC-2026-1015 VA Mandiri', answer, [
    { text: 'INC-2026-1015: OPEN per 17 Nov 2026; rate limit endpoint v2 diterapkan 3 Nov.', ref: 'doc:incident' },
  ], ctx.lang === 'id' ? ['Kapan hotfix OVO dijadwalkan?', 'Berapa failure rate VA Mandiri bulan ini?', 'Apa dugaan penyebab insiden ini?'] : ['When is the OVO hotfix scheduled?', 'What is VA Mandiri failure rate this month?', 'What is the suspected cause of this incident?']);
}

function hD8Hotfix(ctx: HandlerCtx): DraftResult {
  const answer = ctx.lang === 'id'
    ? 'Hotfix OVO (Catatan Insiden Operasional Okt–Nov 2026; FAQ no. 7): Hotfix v3.2.1 dijadwalkan 20 November 2026. Dugaan penyebab: regresi payload builder — validasi field referensi pelanggan pada top-up OVO gagal setelah refactor pada rilis gateway v3.2.0 (5 Nov 22:00). Ini dugaan yang didukung reproduksi di staging, bukan sebab yang sudah terbukti permanen.'
    : 'OVO hotfix (Operational Incident Notes Oct–Nov 2026; FAQ no. 7): Hotfix v3.2.1 is scheduled for November 20, 2026. Suspected cause: payload-builder regression — customer reference field validation on OVO top-ups failed after the refactor in gateway release v3.2.0 (Nov 5, 22:00). This is a suspicion supported by staging reproduction, not a permanently proven cause.';
  return ragDraft(ctx, 'hotfix OVO jadwal perbaikan penyebab dugaan v3.2.1', answer, [
    { text: 'Hotfix v3.2.1 dijadwalkan 20 Nov 2026; dugaan regresi payload builder pasca rilis v3.2.0.', ref: 'doc:incident' },
  ], ctx.lang === 'id' ? ['Apa status insiden INC-2026-1015?', 'Berapa failure rate OVO bulan ini?', 'Kategori apa yang paling terdampak di OVO?'] : ['What is the status of INC-2026-1015?', 'What is OVO failure rate this month?', 'Which category is most affected on OVO?']);
}

/* ============================================================ D9 failure-code lookup */

/** Potong entri satu kode dari chunk tabel katalog (berhenti sebelum kode berikutnya). */
function extractCatalogEntry(flat: string, code: string): string {
  const at = flat.toUpperCase().indexOf(code);
  if (at < 0) return '';
  const rest = flat.slice(at + code.length).trim();
  const next = rest.search(/\bF\d{2}\s+[A-Z][A-Z0-9_]{2,}\b/);
  return (next > 0 ? rest.slice(0, next) : rest).trim();
}

/**
 * D9 — penjelasan SATU kode kegagalan (F01–F12) dari Katalog Kode Kegagalan.
 * FTS5 `document_chunks` menemukan chunk dan memberi sitasi; seed.failure_codes
 * hanya indeks nama/ringkasan yang isinya identik dengan katalog.
 */
function hDFailureCode(ctx: HandlerCtx): DraftResult {
  const code = ctx.norm.failureCode;
  if (!code) return hDGeneric(ctx);

  const seedRow = oneRow(
    ctx.db,
    'SELECT failure_code, failure_name, description, failure_type, owner_team, sla_hours FROM seed.failure_codes WHERE failure_code = ?',
    [code],
  );
  const name = str(seedRow?.failure_name) || code;

  // Perkaya query dengan kode + nama agar BM25 menaikkan chunk katalog.
  const docs = retrieveDocuments(ctx.db, `Katalog Kode Kegagalan ${code} ${name}`, ctx.lang);
  const catalog = docs.filter((d) => /katalog\s+kode\s+kegagalan/i.test(d.docTitle ?? ''));
  const pool = catalog.length ? catalog : docs;
  if (!pool.length) return { ...emptyDraft('rag'), answer: '' };

  // Pilih chunk yang benar-benar memuat entri kode, bukan sekadar menyebut angka.
  let primary = pool[0];
  let content = '';
  for (const d of pool) {
    if (!d.chunkId) continue;
    const row = oneRow(ctx.db, 'SELECT content FROM document_chunks WHERE id = ?', [d.chunkId]);
    const text = str(row?.content);
    if (text.toUpperCase().includes(code) && (!name || text.toUpperCase().includes(name))) {
      primary = d;
      content = text;
      break;
    }
  }
  if (!content) {
    const row = oneRow(ctx.db, 'SELECT content FROM document_chunks WHERE id = ?', [primary.chunkId ?? -1]);
    content = str(row?.content);
  }

  const flat = content.replace(/\s+/g, ' ').trim();
  const at = flat.toUpperCase().indexOf(code);
  const quote = truncateText(at >= 0 ? flat.slice(at) : flat, 240);

  const entry = extractCatalogEntry(flat, code);
  const desc = str(seedRow?.description);
  const type = str(seedRow?.failure_type);
  const owner = str(seedRow?.owner_team);
  const sla = num(seedRow?.sla_hours);
  let action = '';
  if (desc && entry.includes(desc)) {
    const after = entry.slice(entry.indexOf(desc) + desc.length).trim();
    const picAt = owner ? after.lastIndexOf(owner) : -1;
    action = (picAt > 0 ? after.slice(0, picAt) : after).replace(/[\s;]+$/, '').trim();
  }

  const docTitle = primary.docTitle ?? 'Katalog Kode Kegagalan Transaksi dan Panduan Diagnosis';
  const section = primary.section ?? 'Katalog Kode Kegagalan';
  const page = primary.page ?? null;
  const src = `${docTitle}${section ? `, ${section}` : ''}${page ? `, hlm. ${page}` : ''}`;

  const answer = ctx.lang === 'id'
    ? `${code} adalah ${name}${type ? ` (${type})` : ''}. ${desc}${action ? ` Tindakan standar: ${action}.` : ''}${owner ? ` PIC/SLA: ${owner}${sla ? ` / ${sla} jam` : ''}.` : ''} Sumber: ${src}.`
    : `${code} is ${name}${type ? ` (${type})` : ''}. ${desc}${action ? ` Standard action: ${action}.` : ''}${owner ? ` Owner/SLA: ${owner}${sla ? ` / ${sla} hours` : ''}.` : ''} Source: ${src}.`;

  // Sitasi utama memakai kutipan yang benar-benar memuat entri kode.
  const sources = pool.map((d) => ({ ...d }));
  sources[0] = { ...primary, quote };

  return {
    answer,
    keyFindings: [
      { text: `${code} = ${name}${type ? ` — ${type}` : ''}.`, ref: `doc:${primary.sourceId}` },
      ...(desc ? [{ text: desc, ref: `doc:${primary.sourceId}` }] : []),
    ],
    supportingTable: null,
    visualizations: [],
    sql: null,
    sources,
    followUps: ctx.lang === 'id'
      ? ['Apa prosedur penanganan F04?', 'Apa perbedaan penanganan tiap jenis kegagalan?', 'Kode kegagalan apa yang paling sering?']
      : ['What is the F04 handling procedure?', 'How does handling differ by failure type?', 'Which failure code is most frequent?'],
    mode: 'rag',
    contextUpdates: { docRefs: [...new Set(sources.map((d) => d.sourceId))], failureCode: code },
    rowCount: sources.length,
  };
}

/* ============================================================ META handlers */

function hMetaHelp(ctx: HandlerCtx): DraftResult {
  const answer = ctx.lang === 'id'
    ? 'Saya bisa menjawab pertanyaan analitis dari data transaksi dan dokumen operasional: total & nilai transaksi, distribusi status, kanal dengan volume tertinggi, rata-rata nominal per kategori, perbandingan volume (like-for-like), tren success/failure rate, perubahan kategori, failure rate per kanal, kode kegagalan per 1.000, konsentrasi kegagalan, kelebihan gagal vs baseline, titik perubahan, processing time, prosedur SOP, penyebab kegagalan, SLA refund, ambang eskalasi, siklus PENDING/EXPIRED, status insiden, dan jadwal hotfix.'
    : 'I can answer analytical questions from transaction data and operational documents: total & value, status distribution, top-volume channels, average amount by category, like-for-like volume comparison, success/failure-rate trends, category changes, failure rate by channel, failure codes per 1,000, failure concentration, excess failures vs baseline, change points, processing time, SOP procedures, failure causes, refund SLA, escalation thresholds, PENDING/EXPIRED lifecycle, incident status, and hotfix schedule.';
  return {
    answer,
    keyFindings: [],
    supportingTable: null,
    visualizations: [],
    sql: null,
    sources: [],
    followUps: ctx.lang === 'id'
      ? ['Berapa total transaksi bulan ini?', 'Bagaimana distribusi statusnya?', 'Kanal mana dengan volume tertinggi?', 'Apa prosedur transaksi gagal?']
      : ['What is total volume this month?', 'How is the status distributed?', 'Which channel has the highest volume?', 'What is the failed-transaction procedure?'],
    mode: 'smalltalk',
    contextUpdates: {},
    rowCount: 0,
  };
}

function hSmalltalk(ctx: HandlerCtx): DraftResult {
  const answer = ctx.lang === 'id'
    ? `Halo! Saya siap menganalisis ${fmtN(ctx.scope.ref.rowCount, ctx.lang)} transaksi (${ctx.scope.ref.minDate} sampai ${ctx.scope.ref.maxDate}). Coba tanyakan total transaksi bulan ini, distribusi status, atau prosedur penanganan kegagalan.`
    : `Hello! I can analyze ${fmtN(ctx.scope.ref.rowCount, ctx.lang)} transactions (${ctx.scope.ref.minDate} to ${ctx.scope.ref.maxDate}). Try asking about total volume this month, status distribution, or failure-handling procedures.`;
  return {
    answer,
    keyFindings: [],
    supportingTable: null,
    visualizations: [],
    sql: null,
    sources: [],
    followUps: ctx.lang === 'id'
      ? ['Berapa total transaksi bulan ini?', 'Bagaimana distribusi statusnya?', 'Kanal mana dengan volume tertinggi?']
      : ['What is total volume this month?', 'How is the status distributed?', 'Which channel has the highest volume?'],
    mode: 'smalltalk',
    contextUpdates: {},
    rowCount: 0,
  };
}

/* ============================================================ A5 & D_generic */

function hA5Rate(ctx: HandlerCtx): DraftResult {
  const summary = getSummary(ctx.db, ctx.scope, ctx.period, ctx.filters, ctx.lang);
  const successRate = summary.kpis.find((k) => k.key === 'successRate')?.value ?? 0;
  const failureRate = summary.kpis.find((k) => k.key === 'failureRate')?.value ?? 0;
  const total = summary.kpis.find((k) => k.key === 'total')?.value ?? 0;
  const query = `SELECT ROUND(100.0*SUM(status='SUCCESS')/COUNT(*),2) AS success_rate, ROUND(100.0*SUM(status='FAILED')/COUNT(*),2) AS failure_rate FROM ${ctx.scope.table} WHERE transaction_date BETWEEN '${ctx.period.start}' AND '${ctx.period.end}'`;
  const answer = ctx.lang === 'id'
    ? `Success rate ${ctx.period.label} adalah ${fmtPct(successRate, ctx.lang)} (failure rate ${fmtPct(failureRate, ctx.lang)}) dari ${fmtN(total, ctx.lang)} transaksi. ${ctx.period.isPartial ? 'Periode ini bulan berjalan yang belum lengkap (1–18 Nov), sehingga angka bersifat sementara.' : ''}`
    : `Success rate for ${ctx.period.label} is ${fmtPct(successRate, ctx.lang)} (failure rate ${fmtPct(failureRate, ctx.lang)}) across ${fmtN(total, ctx.lang)} transactions. ${ctx.period.isPartial ? 'This is the incomplete current month (Nov 1–18), so the figure is provisional.' : ''}`;
  return {
    answer,
    keyFindings: [
      { text: `Success rate ${fmtPct(successRate, ctx.lang)}; failure rate ${fmtPct(failureRate, ctx.lang)}.`, ref: 'sql:summary' },
      ...(partialFinding(ctx) ? [partialFinding(ctx)!] : []),
    ],
    supportingTable: table(
      [
        { key: 'metric', label: ctx.lang === 'id' ? 'Metrik' : 'Metric' },
        { key: 'value', label: ctx.lang === 'id' ? 'Nilai' : 'Value', align: 'right', format: 'percent' },
      ],
      [
        { metric: 'Success Rate', value: successRate },
        { metric: 'Failure Rate', value: failureRate },
      ],
    ),
    visualizations: [kpiViz([{ label: 'Success Rate', value: successRate }, { label: 'Failure Rate', value: failureRate }], ctx.lang)],
    sql: sqlBlock(query, 1),
    sources: [dsWithSql(ctx, query)],
    followUps: topFollowUps(ctx),
    mode: 'sql',
    contextUpdates: { metric: 'successRate' },
    rowCount: 1,
  };
}

function hDGeneric(ctx: HandlerCtx): DraftResult {
  const docs = retrieveDocuments(ctx.db, ctx.question, ctx.lang);
  if (!docs.length) {
    return { ...emptyDraft('rag'), answer: '' };
  }
  const lead = docs[0];
  const answer = ctx.lang === 'id'
    ? `Berdasarkan ${lead.docTitle}${lead.section ? ` (${lead.section})` : ''}: ${lead.quote}`
    : `From ${lead.docTitle}${lead.section ? ` (${lead.section})` : ''}: ${lead.quote}`;
  return {
    answer,
    keyFindings: docs.slice(0, 3).map((d) => ({ text: (d.quote ?? '').slice(0, 160), ref: `doc:${d.sourceId}` })),
    supportingTable: null,
    visualizations: [],
    sql: null,
    sources: docs,
    followUps: ctx.lang === 'id'
      ? ['Apa prosedur transaksi gagal?', 'Berapa SLA refund tiap kanal?', 'Kapan kanal harus dieskalasi?']
      : ['What is the failed-transaction procedure?', 'What is the refund SLA by channel?', 'When must a channel be escalated?'],
    mode: 'rag',
    contextUpdates: { docRefs: [...new Set(docs.map((d) => d.sourceId))] },
    rowCount: docs.length,
  };
}

/* ============================================================ registry */

export const INTENTS: IntentDef[] = [
  { id: 'A1_total', domain: 'sql', triggers: ['total transaksi', 'berapa total', 'jumlah transaksi', 'how many transactions', 'total transaksi bulan ini'], slots: ['period'], handler: hA1Total },
  { id: 'A1b_value', domain: 'sql', triggers: ['nilai transaksi sukses', 'omzet', 'total amount', 'gmv', 'nilai transaksi', 'nilai transaksi sukses idr'], slots: ['period'], handler: hA1bValue },
  { id: 'A2_status', domain: 'sql', triggers: ['distribusi status', 'breakdown by status', 'berapa yang pending', 'distribusi transaksi berdasarkan status', 'status distribution', 'persentase status', 'jumlah status', 'distribusi status transaksi'], slots: ['period'], handler: hA2Status },
  { id: 'A3_top_channel', domain: 'sql', triggers: ['kanal mana yang memiliki volume', 'top channel', 'kanal terbesar', 'kanal volume tertinggi', 'kanal dengan volume tertinggi'], slots: ['period'], handler: hA3TopChannel },
  { id: 'A4_avg_ticket', domain: 'sql', triggers: ['rata-rata nominal', 'average amount per category', 'rata-rata nominal transaksi sukses per kategori', 'rata rata nominal', 'avg ticket'], slots: ['period'], handler: hA4AvgTicket },
  { id: 'A5_rate', domain: 'sql', triggers: ['success rate', 'tingkat keberhasilan', 'berapa persen sukses', 'failure rate bulan ini', 'persentase keberhasilan'], slots: ['period'], handler: hA5Rate },
  { id: 'B1_volume_compare', domain: 'sql', triggers: ['perbandingan volume', 'compare volume', 'volume bulan ini dengan bulan sebelumnya', 'bagaimana perbandingan volume', 'perbandingan volume transaksi'], slots: ['period'], handler: hB1VolumeCompare },
  { id: 'B2_rate_trend', domain: 'sql', triggers: ['tren success rate', 'success rate mengalami perubahan', 'tingkat keberhasilan transaksi mengalami perubahan', 'tren success rate 3 bulan', 'success rate trend', 'tren keberhasilan'], slots: ['period'], handler: hB2RateTrend },
  { id: 'B3_category_change', domain: 'sql', triggers: ['kategori mana yang mengalami peningkatan', 'kategori naik turun terbesar', 'which category grew', 'kategori terbesar', 'perubahan kategori', 'kategori peningkatan penurunan terbesar'], slots: ['period'], handler: hB3CategoryChange },
  { id: 'C1_failure_change', domain: 'sql', triggers: ['mengapa kegagalan meningkat', 'why failure rate up', 'kenaikan tidak merata', 'mengapa tingkat kegagalan transaksi meningkat', 'failure rate meningkat', 'kenaikan failure rate'], slots: ['period'], handler: hC1FailureChange },
  { id: 'C2_failure_code', domain: 'sql', triggers: ['faktor apa yang paling berkontribusi', 'failure code contribution', 'per 1000', 'kode kegagalan apa yang dominan', 'faktor apa yang paling berkontribusi terhadap penurunan'], slots: ['period'], handler: hC2FailureCode },
  { id: 'C3_concentration', domain: 'sql', triggers: ['terkonsentrasi di kanal', 'where concentrated', 'konsentrasi', 'terkonsentrasi', 'konsentrasi kegagalan'], slots: ['period'], handler: hC3Concentration },
  { id: 'E1_excess', domain: 'sql', triggers: ['kelebihan kegagalan vs baseline', 'kontribusi terbesar', 'kelebihan gagal', 'which channel contributed', 'kelebihan kegagalan', 'kelebihan gagal vs baseline sep', 'kanal mana yang paling berkontribusi', 'paling berkontribusi terhadap peningkatan kegagalan'], slots: ['period'], handler: hE1Excess },
  { id: 'E2_change_point', domain: 'sql', triggers: ['sejak kapan', 'when did it start', 'titik perubahan', 'onset', 'sejak kapan perubahan tersebut mulai'], slots: ['period', 'channel'], handler: hE2ChangePoint },
  { id: 'E3_processing', domain: 'sql', triggers: ['processing time', 'durasi proses', 'waktu proses', 'latency', 'processing time sebelum sesudah', 'data apa yang mendukung', 'data atau informasi apa yang mendukung', 'informasi apa yang mendukung kesimpulan'], slots: ['period', 'channel'], handler: hE3Processing },
  { id: 'F1_hybrid', domain: 'hybrid', triggers: ['failure rate va mandiri bulan ini dan menurut sop', 'failure rate x dan level eskalasi sop', 'failure rate va mandiri dan level eskalasi'], slots: ['period', 'channel'], handler: hF1Hybrid },
  { id: 'D1_sop', domain: 'rag', triggers: ['prosedur yang harus dilakukan ketika transaksi gagal', 'what to do when failed', 'prosedur transaksi gagal', 'langkah', 'prosedur ketika transaksi gagal'], slots: [], handler: hD1Sop },
  { id: 'D2_causes', domain: 'rag', triggers: ['penyebab umum kegagalan', 'common causes', 'apa penyebab umum', 'penyebab umum kegagalan transaksi'], slots: [], handler: hD2Causes },
  { id: 'D3_by_type', domain: 'rag', triggers: ['perbedaan prosedur penanganan', 'perbedaan prosedur penanganan untuk setiap jenis', 'handling per type', 'perbedaan penanganan tiap jenis'], slots: [], handler: hD3ByType },
  { id: 'D4_refund_sla', domain: 'rag', triggers: ['sla pengembalian dana', 'refund sla', 'berapa lama pengembalian dana', 'sla refund', 'sla pengembalian dana per kanal'], slots: [], handler: hD4RefundSla },
  { id: 'D5_escalation', domain: 'rag', triggers: ['ambang eskalasi', 'p1 p2 p3', 'eskalasi ke siapa', 'threshold eskalasi', 'ambang eskalasi p1 p2 p3'], slots: [], handler: hD5Escalation },
  { id: 'D6_pending_expired', domain: 'rag', triggers: ['pending berubah menjadi failed', 'masa berlaku va qris e-wallet sebelum expired', 'kapan transaksi pending berubah menjadi failed', 'masa berlaku va', 'expired'], slots: [], handler: hD6PendingExpired },
  { id: 'D7_incident', domain: 'rag', triggers: ['status dan tindak lanjut insiden inc-2026-1015', 'status insiden inc-2026-1015', 'insiden inc-2026-1015', 'tindak lanjut insiden'], slots: [], handler: hD7Incident },
  { id: 'D8_hotfix', domain: 'rag', triggers: ['hotfix untuk masalah ovo', 'jadwal perbaikan', 'hotfix ovo', 'penyebab dugaan ovo', 'hotfix untuk masalah ovo dijadwalkan'], slots: [], handler: hD8Hotfix },
  { id: 'D9_failure_code', domain: 'rag', triggers: ['kode kegagalan', 'kode gagal', 'failure code', 'berarti apa', 'apa itu', 'itu apa', 'jelaskan kode', 'penjelasan kode', 'what does', 'what is', 'explain code', 'stands for'], slots: ['failureCode'], handler: hDFailureCode },
  { id: 'D_generic', domain: 'rag', triggers: ['dokumen', 'catatan insiden', 'laporan operasional', 'informasi di dokumen', 'infografis insiden', 'relevan untuk menjelaskan pola'], slots: [], handler: hDGeneric },
  { id: 'META_help', domain: 'meta', triggers: ['apa yang bisa kamu lakukan', 'help', 'contoh pertanyaan', 'apa yang bisa kita lakukan'], slots: [], handler: hMetaHelp },
  { id: 'SMALLTALK', domain: 'meta', triggers: ['halo', 'hai', 'hi', 'hello', 'selamat pagi', 'selamat siang', 'selamat sore', 'selamat malam', 'terima kasih', 'thanks', 'makasih'], slots: [], handler: hSmalltalk },
];

/* ============================================================ scoring */

const METRIC_KEYWORDS = ['total', 'berapa', 'jumlah', 'volume', 'failure rate', 'success rate', 'persentase', 'persen', 'rata', 'kontribusi', 'kelebihan', 'processing', 'durasi', 'latency', 'rate', 'sukses', 'gagal'];
const DOC_KEYWORDS = ['sop', 'prosedur', 'slas', 'sla', 'eskalasi', 'refund', 'pengembalian', 'insiden', 'inc-', 'catalog', 'katalog', 'faq', 'laporan', 'penyebab', 'dugaan', 'hotfix', 'pendapatan', 'perbedaan', 'jenis kegagalan'];

function overlapScore(triggers: string[], norm: { text: string }): number {
  if (!triggers.length) return 0;
  const q = norm.text;
  // ARCHITECTURE §5.4: overlap = |token∩trigger| / |trigger|, MAKS per frasa.
  // Frasa pendek (<=2 huruf, mis. "hi") harus cocok pada batas kata agar tidak
  // memicu di dalam kata lain ("terakhir" mengandung "hi").
  let best = 0;
  for (const phrase of triggers) {
    const words = phrase.split(/\s+/).filter((w) => w.length > 0);
    if (!words.length) continue;
    let hit = 0;
    if (words.length === 1 && phrase.length <= 2) {
      const re = new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
      hit = re.test(q) ? 1 : 0;
    } else if (words.length > 1) {
      // frasa multi-kata: substring utuh, atau semua token hadir
      if (q.includes(phrase)) hit = words.length;
      else hit = words.filter((w) => q.includes(w)).length;
    } else {
      hit = q.includes(phrase) ? 1 : 0;
    }
    const v = hit / words.length;
    if (v > best) best = v;
  }
  return best;
}

function slotDetected(slot: SlotName, norm: Normalized): boolean {
  switch (slot) {
    case 'period': return norm.periodPhrase !== null || norm.monthPhrase !== null;
    case 'channel': return norm.channel !== null;
    case 'category': return norm.category !== null;
    case 'failureCode': return norm.failureCode !== null;
    case 'docTopic': return norm.incidentId !== null || DOC_KEYWORDS.some((k) => norm.text.includes(k));
    default: return false;
  }
}

function slotCoverage(slots: SlotName[], norm: Normalized): number {
  if (!slots.length) return 1;
  return slots.filter((s) => slotDetected(s, norm)).length / slots.length;
}

function domainSignal(intent: IntentDef, norm: Normalized): number {
  const q = norm.text;
  if (intent.domain === 'sql' || intent.domain === 'hybrid') return METRIC_KEYWORDS.some((k) => q.includes(k)) ? 1 : 0;
  if (intent.domain === 'rag') return DOC_KEYWORDS.some((k) => q.includes(k)) ? 1 : 0;
  return 0;
}

function lengthFit(norm: Normalized): number {
  return norm.tokens.length <= 30 ? 1 : 0.8;
}

export function scoreIntent(intent: IntentDef, norm: Normalized): number {
  let s = 0.5 * overlapScore(intent.triggers, norm)
    + 0.25 * slotCoverage(intent.slots, norm)
    + 0.15 * domainSignal(intent, norm)
    + 0.1 * lengthFit(norm);
  // Hybrid lebih spesifik daripada metrik tunggal bila pertanyaan menyebut
  // dokumen (SOP/eskalasi) DAN kanal: "failure rate X … level eskalasi SOP".
  if (intent.domain === 'hybrid' && norm.channel && DOC_KEYWORDS.some((k) => norm.text.includes(k))) {
    s += 0.06;
  }
  // Entitas kode + maksud definisi → document lookup menang mutlak.
  if (intent.id === 'D9_failure_code' && norm.failureCodeLookup) s += 0.5;
  // Agregat kode ("paling sering", "dominan") tetap domain SQL.
  if (norm.failureCodeLookup && intent.domain === 'sql') s -= 0.15;
  return s;
}

export type IntentDecision =
  | { kind: 'intent'; intent: IntentDef; assumed: boolean }
  | { kind: 'guardrail'; type: 'ambiguous' | 'not_in_sources' };

export function decideIntent(norm: Normalized): IntentDecision {
  const ranked = INTENTS.map((i) => ({ i, s: scoreIntent(i, norm) })).sort((a, b) => b.s - a.s);
  const top = ranked[0];
  const second = ranked[1];
  if (top.s >= 0.62) return { kind: 'intent', intent: top.i, assumed: false };
  if (top.s >= 0.45) {
    const gap = top.s - second.s;
    // Ambiguous hanya untuk pertanyaan TANPA entitas spesifik. Kode kegagalan,
    // insiden, kanal, atau kategori yang jelas tidak pernah dianggap ambigu.
    const hasClearEntity =
      norm.failureCode !== null || norm.incidentId !== null ||
      norm.channel !== null || norm.category !== null;
    if (gap < 0.05 && !hasClearEntity) return { kind: 'guardrail', type: 'ambiguous' };
    return { kind: 'intent', intent: top.i, assumed: gap < 0.05 };
  }
  const hasDoc = DOC_KEYWORDS.some((k) => norm.text.includes(k));
  if (hasDoc) return { kind: 'intent', intent: INTENTS.find((i) => i.id === 'D_generic')!, assumed: true };
  return { kind: 'guardrail', type: 'not_in_sources' };
}

export function intentById(id: IntentId): IntentDef | undefined {
  return INTENTS.find((i) => i.id === id);
}

export { ds, dsWithSql, sqlBlock, emptyDraft };
