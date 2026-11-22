import { randomUUID } from 'node:crypto';
import type { DB } from '@/lib/db/client';
import type {
  AnswerQuestionResult,
  ChatMessage,
  ReportCreateResponse,
  ReportDetail,
  ReportListItem,
  ReportListResponse,
  ReportMetric,
} from '@/lib/contracts/http';
import { notFound } from '@/lib/errors';
import { nowJakartaIso, truncateText } from '@/lib/date';
import { datasetName } from '@/lib/analytics/scope';

type ReportRow = {
  id: string;
  title: string;
  conversation_id: string | null;
  message_id: string | null;
  dataset_id: string;
  period_start: string | null;
  period_end: string | null;
  payload_json: string;
  created_at: string;
};

function metricsFrom(payload: AnswerQuestionResult | ChatMessage): ReportMetric[] {
  const table = payload.supportingTable;
  if (!table || !table.rows.length) return [];
  const keyCol =
    table.columns.find((c) => c.format === 'text' || c.align === 'left')?.key ?? table.columns[0]?.key ?? null;
  const valueCol =
    table.columns.find((c) => c.format === 'number' || c.format === 'currency' || c.format === 'percent')?.key ??
    table.columns.find((c) => c.key !== keyCol)?.key ??
    null;
  if (!keyCol || !valueCol) return [];

  const metrics: ReportMetric[] = [];
  for (const row of table.rows) {
    const value = row[valueCol];
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    const label = String(row[keyCol] ?? valueCol);
    const column = table.columns.find((c) => c.key === valueCol);
    metrics.push({
      key: label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || `m_${metrics.length + 1}`,
      label,
      value,
      format: column?.format === 'percent' ? 'percent' : column?.format === 'currency' ? 'currency' : 'number',
    });
  }
  return metrics.slice(0, 12);
}

export function createReportFromMessage(
  db: DB,
  conversationId: string,
  messageId: string,
  title?: string | null,
): ReportCreateResponse {
  const conversation = db
    .prepare('SELECT id, dataset_id FROM conversations WHERE id = ?')
    .get(conversationId) as { id: string; dataset_id: string } | undefined;
  if (!conversation) throw notFound('Percakapan tidak ditemukan');

  const row = db
    .prepare("SELECT * FROM messages WHERE id = ? AND conversation_id = ? AND role = 'assistant'")
    .get(messageId, conversationId) as
    | { id: string; seq: number; content: string; payload_json: string | null }
    | undefined;
  if (!row) throw notFound('Pesan assistant tidak ditemukan pada percakapan ini');
  if (!row.payload_json) throw notFound('Pesan tidak memiliki payload yang dapat dijadikan laporan');

  let payload: AnswerQuestionResult;
  try {
    payload = JSON.parse(row.payload_json) as AnswerQuestionResult;
  } catch {
    throw notFound('Payload pesan tidak dapat dibaca');
  }

  const questionRow = db
    .prepare(
      "SELECT content FROM messages WHERE conversation_id = ? AND seq < ? AND role = 'user' ORDER BY seq DESC LIMIT 1",
    )
    .get(conversationId, row.seq) as { content: string } | undefined;
  const question = questionRow?.content ?? '';

  const datasetId = payload.meta?.dataset?.id ?? conversation.dataset_id;
  const dataset = payload.meta?.dataset ?? {
    id: datasetId,
    name: datasetName(datasetId, db),
    kind: datasetId === 'seed' ? ('seed' as const) : ('upload' as const),
    rowCount: 0,
    minDate: payload.meta?.period?.start ?? '',
    maxDate: payload.meta?.period?.end ?? '',
  };
  const period = payload.meta?.period ?? null;

  const detail: ReportDetail = {
    id: randomUUID(),
    title: '',
    createdAt: nowJakartaIso(),
    dataset,
    period,
    question,
    summary: payload.answer ?? payload.content,
    keyFindings: payload.keyFindings ?? [],
    metrics: metricsFrom(payload),
    supportingTable: payload.supportingTable ?? null,
    visualizations: payload.visualizations ?? [],
    sources: payload.sources ?? [],
    sql: [
      ...(payload.sql?.query ? [{ query: payload.sql.query }] : []),
      ...((payload.sources ?? [])
        .filter((s) => s.kind === 'dataset' && s.sql && s.sql !== payload.sql?.query)
        .slice(0, 3)
        .map((s) => ({ query: String(s.sql) }))),
    ],
  };

  detail.title = (title?.trim() || truncateText(question || detail.summary, 120)).slice(0, 120);

  db.prepare(
    `INSERT INTO reports(id, title, conversation_id, message_id, dataset_id, period_start, period_end, payload_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    detail.id,
    detail.title,
    conversationId,
    messageId,
    datasetId,
    period?.start ?? null,
    period?.end ?? null,
    JSON.stringify(detail),
    detail.createdAt,
  );

  return {
    report: {
      id: detail.id,
      title: detail.title,
      messageId,
      conversationId,
      createdAt: detail.createdAt,
    },
  };
}

export function listReports(db: DB, limit: number, offset: number, query?: string): ReportListResponse {
  // Filter judul opsional untuk pagination server-side (q dari UI daftar).
  const q = query?.trim();
  const where = q ? "WHERE title LIKE ? ESCAPE '\\'" : '';
  const pattern = q ? `%${q.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%` : null;
  const rows = db
    .prepare(
      `SELECT id, title, dataset_id, period_start, period_end, created_at
         FROM reports ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    )
    .all(...(pattern ? [pattern] : []), limit, offset) as {
    id: string;
    title: string;
    dataset_id: string;
    period_start: string | null;
    period_end: string | null;
    created_at: string;
  }[];
  const total = db.prepare(`SELECT COUNT(*) AS n FROM reports ${where}`).get(...(pattern ? [pattern] : [])) as { n: number };

  const items: ReportListItem[] = rows.map((row) => ({
    id: row.id,
    title: row.title,
    period: row.period_start && row.period_end ? `${row.period_start}..${row.period_end}` : '',
    dataset: { id: row.dataset_id, name: datasetName(row.dataset_id, db) },
    createdAt: row.created_at,
  }));

  return { items, total: total.n, limit, offset };
}

export function getReport(db: DB, id: string): ReportDetail {
  const row = db.prepare('SELECT payload_json FROM reports WHERE id = ?').get(id) as
    | { payload_json: string }
    | undefined;
  if (!row) throw notFound('Laporan tidak ditemukan');
  try {
    return JSON.parse(row.payload_json) as ReportDetail;
  } catch {
    throw notFound('Laporan tidak dapat dibaca');
  }
}

/**
 * Hapus laporan tersimpan. Tindakan permanen — payload dokumen ikut hilang.
 */
export function deleteReport(db: DB, id: string): void {
  const res = db.prepare('DELETE FROM reports WHERE id = ?').run(id);
  if (res.changes === 0) throw notFound('Laporan tidak ditemukan');
}

/**
 * Ganti judul laporan (mis. disesuaikan dengan nama dokumen sumbernya).
 * Judul tersimpan dua tempat: kolom `reports.title` (daftar) dan
 * `payload_json.title` (dokumen pratinjau/ekspor) — keduanya disinkronkan.
 */
export function renameReport(db: DB, id: string, title: string): ReportListItem {
  const row = db
    .prepare('SELECT title, dataset_id, period_start, period_end, created_at, payload_json FROM reports WHERE id = ?')
    .get(id) as
    | { title: string; dataset_id: string; period_start: string | null; period_end: string | null; created_at: string; payload_json: string }
    | undefined;
  if (!row) throw notFound('Laporan tidak ditemukan');

  const clean = title.slice(0, 120);
  let payload = row.payload_json;
  try {
    const parsed = JSON.parse(row.payload_json) as { title?: string };
    parsed.title = clean;
    payload = JSON.stringify(parsed);
  } catch {
    // payload tidak terbaca: judul kolom tetap diperbarui
  }
  db.prepare('UPDATE reports SET title = ?, payload_json = ? WHERE id = ?').run(clean, payload, id);

  return {
    id,
    title: clean,
    period: row.period_start && row.period_end ? `${row.period_start}..${row.period_end}` : '',
    dataset: { id: row.dataset_id, name: datasetName(row.dataset_id, db) },
    createdAt: row.created_at,
  };
}
