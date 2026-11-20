/**
 * UI-facing view model untuk GET /api/share/[id].
 * Sumber: CORE_V2_ARCHITECTURE §5 (ShareSnapshot) + SHARE_PAGE_SPEC §2–§5.
 *
 * Backend pemilik endpoint. Modul ini HANYA menormalkan bentuk wire menjadi
 * view model yang stabil. Tidak ada angka, nama file, atau identitas rekaan:
 * semua field berasal dari payload API, dengan fallback jujur bila kosong.
 */

export type ShareDocType = 'legal' | 'technical_report' | 'financial' | 'general' | 'unknown';

/** SHARE_PAGE_SPEC §4: label persis dari classifier, tanpa taksonomi tambahan. */
export const DOC_TYPE_LABEL: Record<ShareDocType, string> = {
  legal: 'Legal',
  technical_report: 'Technical report',
  financial: 'Financial',
  general: 'General',
  unknown: 'Belum terklasifikasi',
};

export type ShareIdentity = {
  docType: ShareDocType;
  fileName: string | null;
  page: number | null;
  documentIncluded: boolean;
  anchorId: string | null;
};

export type ShareCitation = {
  /** S1, S2, ... dinomori menurut kemunculan pertama di halaman. */
  id: string;
  chunkId: string | null;
  sectionPath: string;
  page: number | null;
  quote: string;
  documentIncluded: boolean;
  anchorId: string | null;
};

export type ShareOutputType =
  | 'kpi'
  | 'table'
  | 'line'
  | 'bar'
  | 'donut'
  | 'quote'
  | 'timeline'
  | 'parameter_report'
  | 'none';

export type ShareColumn = {
  key: string;
  label: string;
  align: 'left' | 'right';
  format: 'number' | 'percent' | 'currency' | 'text';
};

export type ShareParameter = {
  name: string;
  value: string | number | null;
  unit: string | null;
  status: 'normal' | 'alert';
  page: number | null;
  note: string | null;
};

export type ShareEvent = {
  date: string;
  label: string;
  evidence: string | null;
  citationId: string | null;
};

/**
 * Satu blok output adaptif. Semua angka dibaca dari `rows`/`value` yang
 * berasal dari result_json. `reason` dan `confidence` sengaja tidak masuk
 * view model (P-7: milik audit sheet, bukan pembaca).
 */
export type ShareOutput = {
  type: ShareOutputType;
  title: string | null;
  rows: Record<string, string | number | null>[];
  columns: ShareColumn[];
  xKey: string;
  series: { key: string; label: string }[];
  value: number | null;
  format: 'number' | 'percent' | 'currency';
  source: string | null;
  period: string | null;
  chapter: string | null;
  article: string | null;
  verses: string[];
  events: ShareEvent[];
  parameters: ShareParameter[];
  notes: string[];
  text: string | null;
  keywords: string[];
};

export type ShareMessage = {
  id: string;
  role: 'user' | 'assistant';
  createdAt: string;
  question: string | null;
  answer: string | null;
  outputs: ShareOutput[];
  citationIds: string[];
  guardrail: { type: string; explanation: string; keywords: string[] } | null;
  meta: { source: string | null; period: string | null; rowCount: number | null } | null;
};

export type ShareSnapshotView = {
  id: string;
  title: string | null;
  createdAt: string;
  includeCitations: boolean;
  includeIdentity: boolean;
  identity: ShareIdentity | null;
  summary: string | null;
  messages: ShareMessage[];
  citations: ShareCitation[];
};

/* ------------------------------------------------------------- normalizer */

function rec(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function nullableStr(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function pick(source: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

const OUTPUT_TYPES: ShareOutputType[] = [
  'kpi', 'table', 'line', 'bar', 'donut', 'quote', 'timeline', 'parameter_report', 'none',
];

function normalizeOutput(raw: unknown): ShareOutput | null {
  const source = rec(raw);
  const rawType = str(pick(source, 'type', 'outputType', 'output_type')).toLowerCase();
  const type: ShareOutputType = OUTPUT_TYPES.includes(rawType as ShareOutputType)
    ? (rawType as ShareOutputType)
    : 'none';

  // result_json adalah satu-satunya sumber angka. Terima beberapa alias kunci
  // tanpa pernah mengambil angka dari narasi `answer`.
  const data = rec(pick(source, 'data', 'result_json', 'resultJson', 'result'));
  const rows = arr(pick(data, 'rows', 'data'))
    .map((row) => rec(row) as Record<string, string | number | null>);
  const columns = arr(pick(data, 'columns', 'fields')).map((column, index) => {
    const col = rec(column);
    return {
      key: str(pick(col, 'key', 'name', 'field'), `col_${index}`),
      label: str(pick(col, 'label', 'title'), str(pick(col, 'key', 'name'), `Kolom ${index + 1}`)),
      align: str(pick(col, 'align')) === 'right' ? 'right' as const : 'left' as const,
      format: (['number', 'percent', 'currency', 'text'].includes(str(pick(col, 'format')))
        ? str(pick(col, 'format'))
        : 'text') as ShareColumn['format'],
    };
  });
  const series = arr(pick(data, 'series', 'y_keys', 'yKeys')).map((item, index) => {
    const s = rec(item);
    return {
      key: str(pick(s, 'key', 'name'), `seri_${index}`),
      label: str(pick(s, 'label', 'title'), `Seri ${index + 1}`),
    };
  });
  const parameters = arr(pick(source, 'parameters', 'params', 'rows')).map((item) => {
    const p = rec(item);
    const status = str(pick(p, 'status')).toLowerCase();
    return {
      name: str(pick(p, 'name', 'parameter', 'label'), 'Parameter'),
      value: (pick(p, 'value', 'nilai') as string | number | null) ?? null,
      unit: nullableStr(pick(p, 'unit', 'satuan')),
      status: status === 'alert' || status === 'warning' ? 'alert' as const : 'normal' as const,
      page: num(pick(p, 'page', 'halaman')),
      note: nullableStr(pick(p, 'note', 'catatan')),
    };
  });
  const events = arr(pick(source, 'events', 'timeline')).map((item) => {
    const e = rec(item);
    return {
      date: str(pick(e, 'date', 'datetime', 'tanggal')),
      label: str(pick(e, 'label', 'title', 'event'), 'Kejadian'),
      evidence: nullableStr(pick(e, 'evidence', 'bukti', 'text')),
      citationId: nullableStr(pick(e, 'citationId', 'citation_id', 'ref')),
    };
  });

  return {
    type,
    title: nullableStr(pick(source, 'title', 'question', 'judul')),
    rows,
    columns,
    xKey: str(pick(data, 'x_key', 'xKey'), str(pick(data, 'x', 'category'), '')),
    series,
    value: num(pick(data, 'value', 'total', 'metric')),
    format: (['number', 'percent', 'currency'].includes(str(pick(data, 'format')))
      ? str(pick(data, 'format'))
      : 'number') as ShareOutput['format'],
    source: nullableStr(pick(data, 'source', 'sumber')),
    period: nullableStr(pick(data, 'period', 'periode')),
    chapter: nullableStr(pick(source, 'chapter', 'bab')),
    article: nullableStr(pick(source, 'article', 'pasal')),
    verses: arr(pick(source, 'verses', 'ayat', 'quotes')).map((v) => str(v)).filter(Boolean),
    events,
    parameters,
    notes: arr(pick(source, 'notes', 'catatan')).map((n) => str(n)).filter(Boolean),
    text: nullableStr(pick(source, 'text', 'content')),
    keywords: arr(pick(source, 'keywords', 'kata_kunci')).map((k) => str(k)).filter(Boolean),
  };
}

function normalizeOutputs(raw: unknown): ShareOutput[] {
  const direct = arr(raw).map(normalizeOutput).filter((o): o is ShareOutput => o !== null);
  if (direct.length > 0) return direct;
  // Alias: satu result_json atau visualizations gaya workspace lama.
  const single = normalizeOutput(raw);
  return single ? [single] : [];
}

function normalizeIdentity(raw: unknown): ShareIdentity | null {
  if (raw === undefined || raw === null) return null;
  const source = rec(raw);
  const rawType = str(pick(source, 'docType', 'doc_type', 'type')).toLowerCase();
  const docType: ShareDocType = (['legal', 'technical_report', 'financial', 'general', 'unknown'].includes(rawType)
    ? rawType
    : 'unknown') as ShareDocType;
  return {
    docType,
    fileName: nullableStr(pick(source, 'fileName', 'file_name', 'name', 'datasetName')),
    page: num(pick(source, 'page', 'halaman')),
    documentIncluded: bool(pick(source, 'documentIncluded', 'document_included'), false),
    anchorId: nullableStr(pick(source, 'anchorId', 'anchor_id', 'deep_link')),
  };
}

/**
 * Normalkan payload API menjadi view model halaman share.
 * Sitasi diberi nomor S1..Sn menurut urutan kemunculan pertama (SHARE_PAGE_SPEC §5),
 * bukan memakai chunk_id mentah.
 */
export function normalizeShareSnapshot(raw: unknown): ShareSnapshotView {
  const root = rec(raw);
  const payload = rec(pick(root, 'payload', 'payload_json', 'payloadJson', 'snapshot') ?? root);
  const options = rec(pick(root, 'options', 'share_options', 'shareOptions'));
  const includeCitations = bool(pick(options, 'includeCitations', 'include_citations'), true);
  const includeIdentity = bool(pick(options, 'includeIdentity', 'include_identity'), true);

  const citations: ShareCitation[] = [];
  const messages: ShareMessage[] = arr(pick(payload, 'messages', 'conversation', 'transcript'))
    .map((item, index) => {
      const source = rec(item);
      const roleRaw = str(pick(source, 'role')).toLowerCase();
      const role: 'user' | 'assistant' = roleRaw === 'assistant' ? 'assistant' : 'user';
      const citationIds: string[] = [];
      for (const rawCitation of arr(pick(source, 'citations', 'sources', 'sitasi'))) {
        const c = rec(rawCitation);
        const id = `S${citations.length + 1}`;
        citations.push({
          id,
          chunkId: nullableStr(pick(c, 'chunkId', 'chunk_id')) ?? (num(pick(c, 'chunkId', 'chunk_id')) !== null ? String(num(pick(c, 'chunkId', 'chunk_id'))) : null),
          sectionPath: str(pick(c, 'sectionPath', 'section_path', 'section', 'path'), 'Bagian tidak tersedia'),
          page: num(pick(c, 'page', 'halaman')),
          quote: str(pick(c, 'quote', 'text', 'kutipan'), 'Potongan tidak tersedia'),
          documentIncluded: bool(pick(c, 'documentIncluded', 'document_included'), false),
          anchorId: nullableStr(pick(c, 'anchorId', 'anchor_id', 'deep_link')),
        });
        citationIds.push(id);
      }
      const guardrailRaw = pick(source, 'guardrail');
      const guardrail = guardrailRaw ? (() => {
        const g = rec(guardrailRaw);
        return {
          type: str(pick(g, 'type')),
          explanation: str(pick(g, 'explanation', 'penjelasan')),
          keywords: arr(pick(g, 'keywords', 'kata_kunci')).map((k) => str(k)).filter(Boolean),
        };
      })() : null;
      const metaRaw = pick(source, 'meta');
      const meta = metaRaw ? (() => {
        const m = rec(metaRaw);
        return {
          source: nullableStr(pick(m, 'source', 'sumber')),
          period: nullableStr(pick(m, 'period', 'periode')),
          rowCount: num(pick(m, 'rowCount', 'row_count')),
        };
      })() : null;

      return {
        id: str(pick(source, 'id'), `msg-${index}`),
        role,
        createdAt: str(pick(source, 'createdAt', 'created_at')),
        question: role === 'user'
          ? nullableStr(pick(source, 'question', 'content', 'text'))
          : nullableStr(pick(source, 'question')),
        answer: role === 'assistant'
          ? nullableStr(pick(source, 'answer', 'content', 'text'))
          : null,
        outputs: role === 'assistant'
          ? normalizeOutputs(pick(source, 'outputs', 'result_json', 'resultJson', 'visualizations'))
          : [],
        citationIds,
        guardrail,
        meta,
      };
    });

  const summary = nullableStr(pick(payload, 'summary', 'ringkasan'))
    ?? messages.find((m) => m.role === 'assistant' && !m.guardrail && m.answer)?.answer
    ?? null;

  return {
    id: str(pick(root, 'id', 'shareId', 'share_id')),
    title: nullableStr(pick(payload, 'title', 'judul') ?? pick(root, 'title'))
      ?? messages.find((m) => m.role === 'user' && m.question)?.question
      ?? null,
    createdAt: str(pick(root, 'createdAt', 'created_at') ?? pick(payload, 'createdAt', 'created_at')),
    includeCitations,
    includeIdentity,
    identity: includeIdentity ? normalizeIdentity(pick(payload, 'identity', 'document', 'dokumen')) : null,
    summary,
    messages,
    citations: includeCitations ? citations : [],
  };
}

/** `20 Nov 2026 · 14.05 WIB` (id-ID, Asia/Jakarta). Tanpa ISO/UTC (U-07). */
export function formatShareTimestamp(iso: string): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const day = new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', year: 'numeric',
  }).format(date);
  const time = new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date).replace(':', '.');
  return `${day} · ${time} WIB`;
}
