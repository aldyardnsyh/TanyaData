/**
 * Deterministic answer layer — VizSpec adaptif, guardrail, dan evaluasi
 * grounding. LLM (aiml) opsional lewat AnswerComposerPort; tanpa LLM jalur
 * ini yang dipakai sehingga angka tetap berasal dari result_json (P-5, P-8).
 */

import type {
  Citation,
  Dataset,
  DocType,
  EvaluationResult,
  Guardrail,
  QueryContext,
  QueryResultJson,
  SchemaJson,
  VizSpec,
} from '@/lib/core/contracts';

const DESTRUCTIVE_RE = /\b(hapus|hancurkan|delete|drop|truncate|update|insert|ubah data|tulis data)\b/i;
const PII_RE = /\b(email|e-mail|telepon|no\.?\s*hp|nik|npwp|nama pelanggan|alamat lengkap)\b/i;

export function detectGuardrail(input: {
  question: string;
  dataset: Dataset;
  context: QueryContext | null;
}): Guardrail | null {
  const { question, dataset, context } = input;
  if (DESTRUCTIVE_RE.test(question)) {
    return {
      type: 'destructive',
      explanation:
        'Saya hanya memiliki akses baca pada dataset. Perintah mengubah atau menghapus data tidak dapat dijalankan.',
    };
  }
  if (PII_RE.test(question)) {
    return {
      type: 'pii',
      explanation: 'Dataset ini tidak menyediakan data pribadi yang dapat diidentifikasi. Saya tidak menebaknya.',
    };
  }
  const period = context?.period;
  if (period?.start && dataset.period_start && period.start < dataset.period_start) {
    return {
      type: 'out_of_range',
      explanation: `Rentang data yang tersedia mulai ${dataset.period_start}${dataset.period_end ? ` sampai ${dataset.period_end}` : ''}.`,
    };
  }
  if (period?.end && dataset.period_end && period.end > dataset.period_end) {
    return {
      type: 'out_of_range',
      explanation: `Rentang data yang tersedia berhenti pada ${dataset.period_end}.`,
    };
  }
  return null;
}

export function notInSourcesGuardrail(dataset: Dataset): Guardrail {
  const topics = dataset.schema_json.tables
    .flatMap((t) => t.columns.filter((c) => c.semantic_role === 'dimension').map((c) => c.sourceName))
    .slice(0, 5);
  return {
    type: 'not_in_sources',
    explanation: topics.length
      ? `Informasi itu tidak ditemukan pada sumber "${dataset.name}". Topik yang tersedia antara lain: ${topics.join(', ')}.`
      : `Informasi itu tidak ditemukan pada sumber "${dataset.name}".`,
  };
}

/* ------------------------------------------------------------------- vizspec */

function numericKeys(result: QueryResultJson): string[] {
  if (!result.rows.length) return [];
  return Object.keys(result.rows[0]).filter((key) => {
    const value = result.rows[0][key];
    return typeof value === 'number' && Number.isFinite(value);
  });
}

/** Aturan §6 CORE_ARCHITECTURE: jangan memaksa chart pada teks. */
export function buildVizSpec(input: {
  result: QueryResultJson;
  schema: SchemaJson;
  docType: DocType;
  citations: Citation[];
  question: string;
}): VizSpec {
  const { result, schema, docType, citations } = input;
  const data = result.rows.slice(0, 500) as Array<Record<string, string | number | boolean | null>>;
  const base = { x_key: null as string | null, y_keys: [] as string[], data };

  if (docType === 'legal' && citations.length) {
    return { type: 'quote', reason: 'teks hukum bukan metrik', ...base, confidence: 0.95 };
  }
  if (!result.rows.length) {
    return { type: 'none', reason: 'tidak ada baris hasil', ...base, confidence: 0.9 };
  }

  const columns = schema.tables.flatMap((t) => t.columns);
  const timeKey = columns.find((c) => c.semantic_role === 'time' && result.columns.includes(c.name))?.name ?? null;
  const measureKeys = columns
    .filter((c) => c.semantic_role === 'measure' && result.columns.includes(c.name))
    .map((c) => c.name);
  const dimKeys = columns
    .filter((c) => c.semantic_role === 'dimension' && result.columns.includes(c.name))
    .map((c) => c.name);
  const numbers = numericKeys(result);

  if (result.rowCount === 1 && numbers.length === 1) {
    return {
      type: 'kpi',
      reason: 'angka tunggal',
      x_key: result.columns[0] ?? null,
      y_keys: numbers,
      data,
      confidence: 0.9,
    };
  }
  if (timeKey && (measureKeys.length || numbers.length)) {
    return {
      type: 'line',
      reason: 'time + measure',
      x_key: timeKey,
      y_keys: measureKeys.length ? measureKeys : numbers,
      data,
      confidence: 0.85,
    };
  }
  if (dimKeys.length && (measureKeys.length || numbers.length)) {
    const type = result.rowCount <= 8 && /distribusi|komposisi|persen/i.test(input.question) ? 'donut' : 'bar';
    return {
      type,
      reason: type === 'donut' ? 'distribusi kategori' : 'kategori + measure',
      x_key: dimKeys[0],
      y_keys: measureKeys.length ? measureKeys : numbers,
      data,
      confidence: type === 'donut' ? 0.8 : 0.85,
    };
  }
  return { type: 'table', reason: 'tidak ada pasangan waktu/measure yang jelas', ...base, confidence: 0.7 };
}

/* ------------------------------------------------------------------- compose */

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return 'n/a';
  if (typeof value === 'number') return new Intl.NumberFormat('id-ID').format(value);
  return String(value);
}

export function composeDeterministicAnswer(input: {
  question: string;
  lang: 'id' | 'en';
  result: QueryResultJson;
  viz: VizSpec;
  citations: Citation[];
  sqlExplanation: string | null;
  mode: 'sql' | 'document' | 'hybrid';
}): string {
  const { result, viz, citations, lang, sqlExplanation } = input;
  if (viz.type === 'quote' && citations.length) {
    const quote = citations[0].quote ?? '';
    const ref = citations[0].section_path;
    return lang === 'id'
      ? `Berikut kutipan dari ${ref}: "${quote}". Sumber: ${citations.map((c) => c.section_path).join(', ')}.`
      : `Excerpt from ${ref}: "${quote}". Sources: ${citations.map((c) => c.section_path).join(', ')}.`;
  }
  if (!result.rows.length) {
    return lang === 'id'
      ? 'Tidak ada baris yang memenuhi pertanyaan ini pada sumber yang tersedia.'
      : 'No rows matched this question in the available sources.';
  }
  if (viz.type === 'kpi') {
    const key = viz.y_keys[0] ?? result.columns[0];
    const value = formatValue(result.rows[0][key]);
    return lang === 'id'
      ? `Hasil: ${value} (${key}). Angka ini berasal dari eksekusi SQL pada sumber data.`
      : `Result: ${value} (${key}). This figure comes from SQL execution on the data source.`;
  }
  const prefix = lang === 'id'
    ? `Ditemukan ${result.rowCount} baris.`
    : `Found ${result.rowCount} rows.`;
  const detail = sqlExplanation ? ` ${sqlExplanation}` : '';
  const source = citations.length
    ? lang === 'id'
      ? ` Sitasi: ${citations.map((c) => c.section_path).join(', ')}.`
      : ` Citations: ${citations.map((c) => c.section_path).join(', ')}.`
    : '';
  return `${prefix}${detail}${source}`;
}

/* ---------------------------------------------------------------- evaluation */

export function evaluateGrounding(input: {
  answer: string;
  result: QueryResultJson;
  citations: Citation[];
  viz: VizSpec;
  latencyMs: number;
}): EvaluationResult {
  const failed: string[] = [];
  const evidence = JSON.stringify(input.result.rows) + JSON.stringify(input.citations.map((c) => c.quote));
  const numbers = input.answer.match(/\d[\d.,]*/g) ?? [];
  const grounded = numbers.filter((token) => evidence.includes(token.replace(/\./g, '')) || evidence.includes(token));
  const numericGrounding = numbers.length ? grounded.length / numbers.length : 1;
  if (numericGrounding < 1) failed.push('numeric_grounding');

  const validCitations = input.citations.filter((c) => c.chunk_id !== null || c.section_path).length;
  const citationValid = input.citations.length ? validCitations / input.citations.length : 1;
  if (citationValid < 1) failed.push('citation_valid');

  const outputTypeOk = Boolean(input.viz.reason) && input.viz.confidence >= 0.6;
  if (!outputTypeOk) failed.push('output_type');

  return {
    passed: failed.length === 0,
    failed_checks: failed,
    metrics: {
      numeric_grounding: Number(numericGrounding.toFixed(4)),
      citation_valid: Number(citationValid.toFixed(4)),
      output_type_ok: outputTypeOk,
      row_count: input.result.rowCount,
      latency_ms: input.latencyMs,
    },
  };
}
