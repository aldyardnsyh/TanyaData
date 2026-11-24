/**
 * CORE store — query results, citations, evaluation, dan FTS5 retrieval.
 * Semua angka yang disimpan berasal dari eksekusi SQL, bukan narasi (P-5).
 */

import { randomUUID } from 'node:crypto';
import type { DB } from '@/lib/db/client';
import { nowJakartaIso } from '@/lib/date';
import { stemIndonesian } from '@/lib/core/stem';
import { expandSynonyms, correctQueryTypos } from '@/lib/ai/normalize';

export { normalizeForFts } from '@/lib/core/stem';
import type {
  Citation,
  EvaluationResult,
  Query,
  QueryMode,
  QueryResultJson,
  VizSpec,
} from '@/lib/core/contracts';

type QueryRow = {
  id: string;
  dataset_id: string;
  nl_question: string;
  lang: string;
  generated_sql: string | null;
  sql_explanation: string | null;
  result_json: string;
  viz_spec: string;
  guardrail: string | null;
  evaluation: string | null;
  mode: QueryMode;
  answer: string;
  duration_ms: number;
  created_at: string;
};

function parse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function rowToQuery(row: QueryRow): Query {
  return {
    id: row.id,
    dataset_id: row.dataset_id,
    nl_question: row.nl_question,
    lang: row.lang === 'en' ? 'en' : 'id',
    generated_sql: row.generated_sql,
    sql_explanation: row.sql_explanation,
    result_json: parse<QueryResultJson>(row.result_json, { columns: [], rows: [], rowCount: 0, truncated: false }),
    viz_spec: parse<VizSpec>(row.viz_spec, { type: 'none', reason: 'tidak tersedia', x_key: null, y_keys: [], data: [], confidence: 0 }),
    citations: [],
    guardrail: parse<Query['guardrail']>(row.guardrail, null),
    evaluation: parse<EvaluationResult | null>(row.evaluation, null),
    mode: row.mode,
    answer: row.answer,
    duration_ms: row.duration_ms,
    created_at: row.created_at,
  };
}

export function saveQuery(db: DB, query: Query): Query {
  db.transaction(() => {
    db.prepare(
      `INSERT INTO core_queries
         (id, dataset_id, nl_question, lang, generated_sql, sql_explanation, result_json,
          viz_spec, guardrail, evaluation, mode, answer, duration_ms, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      query.id,
      query.dataset_id,
      query.nl_question,
      query.lang,
      query.generated_sql,
      query.sql_explanation,
      JSON.stringify(query.result_json),
      JSON.stringify(query.viz_spec),
      query.guardrail ? JSON.stringify(query.guardrail) : null,
      query.evaluation ? JSON.stringify(query.evaluation) : null,
      query.mode,
      query.answer,
      query.duration_ms,
      query.created_at,
    );
    const insertCitation = db.prepare(
      `INSERT INTO core_citations(query_id, chunk_id, document_id, section_path, page, quote, score, rev, deep_link, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const citation of query.citations) {
      insertCitation.run(
        query.id,
        citation.chunk_id,
        citation.document_id,
        citation.section_path,
        citation.page,
        citation.quote,
        citation.score,
        citation.rev ?? null,
        citation.deep_link ?? null,
        citation.deep_link_status ?? 'valid',
      );
    }
  })();
  return query;
}

export function getQuery(db: DB, id: string): Query | null {
  const row = db.prepare('SELECT * FROM core_queries WHERE id = ?').get(id) as QueryRow | undefined;
  if (!row) return null;
  const query = rowToQuery(row);
  query.citations = db
    .prepare('SELECT * FROM core_citations WHERE query_id = ? ORDER BY id')
    .all(id) as Citation[];
  return query;
}

export function listQueries(
  db: DB,
  options: { datasetId?: string; limit?: number; offset?: number } = {},
): { items: Query[]; total: number } {
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
  const offset = Math.max(options.offset ?? 0, 0);
  const where = options.datasetId ? 'WHERE dataset_id = ?' : '';
  const params = options.datasetId ? [options.datasetId] : [];
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM core_queries ${where}`).get(...params) as { n: number }).n;
  const rows = db
    .prepare(`SELECT * FROM core_queries ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as QueryRow[];
  return { items: rows.map(rowToQuery), total };
}

export function saveEvaluation(
  db: DB,
  input: { queryId: string | null; datasetId: string; evaluation: EvaluationResult },
): EvaluationResult {
  const id = `ev_${randomUUID()}`;
  db.prepare(
    `INSERT INTO core_evaluations(id, query_id, dataset_id, passed, failed_checks, metrics, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.queryId,
    input.datasetId,
    input.evaluation.passed ? 1 : 0,
    JSON.stringify(input.evaluation.failed_checks),
    JSON.stringify(input.evaluation.metrics),
    nowJakartaIso(),
  );
  if (input.queryId) {
    db.prepare('UPDATE core_queries SET evaluation = ? WHERE id = ?').run(
      JSON.stringify(input.evaluation),
      input.queryId,
    );
  }
  return input.evaluation;
}

export function getEvaluation(db: DB, queryId: string): EvaluationResult | null {
  const row = db
    .prepare('SELECT * FROM core_evaluations WHERE query_id = ? ORDER BY created_at DESC LIMIT 1')
    .get(queryId) as
    | { passed: number; failed_checks: string; metrics: string }
    | undefined;
  if (!row) return null;
  return {
    passed: row.passed === 1,
    failed_checks: parse<string[]>(row.failed_checks, []),
    metrics: parse<EvaluationResult['metrics']>(row.metrics, {
      numeric_grounding: 0,
      citation_valid: 0,
      output_type_ok: false,
      row_count: 0,
      latency_ms: 0,
    }),
  };
}

/* ------------------------------------------------------------ FTS retrieval */

const STOPWORDS = new Set([
  'yang', 'di', 'ke', 'dari', 'dan', 'atau', 'untuk', 'pada', 'dengan', 'adalah', 'apa', 'bagaimana',
  'berapa', 'boleh', 'ini', 'itu', 'the', 'a', 'an', 'of', 'in', 'on', 'for', 'is', 'are', 'what',
  'how', 'many', 'per', 'total', 'data', 'tentang', 'mengenai', 'saya', 'aku', 'kamu', 'nya',
]);

/**
 * Kueri FTS memakai DUA bentuk per kata: asli + stem.
 * - Bentuk asli menjaga kompatibilitas dengan teks FTS mentah (trigger bawaan
 *   core-schema.sql mengindeks teks apa adanya, termasuk di eval ground truth).
 * - Bentuk stem menangkap variasi kata Indonesia (mengatur/atur, pendidikan/didik)
 *   tanpa mengubah skema atau menambah dependency berat.
 */
export function searchTerms(question: string): string[] {
  const lowered = correctQueryTypos(question)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s]/g, ' ');
  // Sinonim domain (threshold→ambang, sop→prosedur, omzet→nilai, ...)
  // ditambahkan sebagai TERM TAMBAHAN, bukan pengganti: kata asli tetap
  // dicari supaya chunk yang memakai istilah asli tidak kehilangan match.
  const expanded = expandSynonyms(lowered);
  const raw = [...new Set(
    [...lowered.split(/\s+/), ...expanded.split(/\s+/)]
      .filter((word) => word.length >= 3 && !STOPWORDS.has(word)),
  )];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const word of raw) {
    for (const term of [word, stemIndonesian(word)]) {
      if (term.length < 3 || STOPWORDS.has(term) || seen.has(term)) continue;
      seen.add(term);
      out.push(term);
      if (out.length >= 12) return out;
    }
  }
  return out;
}

export type SearchChunksOptions = {
  /** Satu dataset, beberapa dataset (kelompok), atau '*' = seluruh dokumen. */
  datasetId: string | string[];
  question: string;
  limit?: number;
  /** Opsi reranker opsional untuk aiml; tanpa keduanya perilaku default tidak berubah. */
  boostSection?: string | null;
  boostPage?: number | null;
  boostWeight?: number;
};

function metadataBoost(citation: Citation, options: SearchChunksOptions): number {
  const weight = options.boostWeight ?? 0.25;
  let boost = 0;
  if (options.boostSection) {
    const needle = options.boostSection.toLowerCase();
    if (citation.section_path.toLowerCase().includes(needle)) boost += weight;
  }
  if (options.boostPage != null && citation.page === options.boostPage) {
    boost += weight * 0.6;
  }
  return boost;
}

/** FTS5 BM25 wajib; fallback LIKE bila FTS tidak tersedia. */
export function searchChunks(db: DB, options: SearchChunksOptions): Citation[] {
  const limit = Math.min(Math.max(options.limit ?? 5, 1), 20);
  const terms = searchTerms(options.question);
  for (const number of options.boostSection?.match(/\d+/g) ?? []) {
    if (!terms.includes(number)) terms.push(number);
  }
  if (!terms.length) return [];
  const match = terms.map((term) => `"${term.replace(/"/g, '""')}"`).join(' OR ');
  const useBoost = Boolean(options.boostSection) || options.boostPage != null;
  const fetchLimit = useBoost ? Math.min(limit * 4, 50) : limit;
  // datasetId '*' = cari di seluruh dokumen terindeks (chip "Semua dokumen");
  // array = kelompok dokumen percakapan (konsep NotebookLM: jawaban hanya
  // dari dokumen yang dijadikan basis pengetahuan sesi itu).
  const ids = (Array.isArray(options.datasetId) ? options.datasetId : [options.datasetId]).filter(Boolean);
  const allDocs = ids.includes('*');
  const datasetFilter = allDocs ? '' : `AND c.dataset_id IN (${ids.map(() => '?').join(',')})`;
  const datasetArgs = allDocs ? [] : ids;
  const pasalBoost = /^Pasal\s+(\d+[a-z]?)$/i.exec(options.boostSection ?? '');
  const sectionLabel = pasalBoost ? `Pasal ${pasalBoost[1]}` : null;
  const sectionFilter = sectionLabel
    ? ' AND (c.section_path = ? OR c.section_path LIKE ? OR c.section_path LIKE ?)'
    : '';
  const sectionArgs = sectionLabel
    ? [sectionLabel, `${sectionLabel}/%`, `${sectionLabel} >%`]
    : [];

  let results: Citation[];
  try {
    const rows = db
      .prepare(
        `SELECT c.id AS chunk_id, c.document_id, c.section_path, c.page,
                c.text AS quote, bm25(core_chunks_fts) AS raw_score
         FROM core_chunks_fts f
         JOIN core_chunks c ON c.id = f.rowid
          WHERE core_chunks_fts MATCH ? ${datasetFilter} AND c.level = 'child' ${sectionFilter}
          ORDER BY raw_score ASC LIMIT ?`,
      )
      .all(match, ...datasetArgs, ...sectionArgs, fetchLimit) as Array<{
      chunk_id: number;
      document_id: string;
      section_path: string;
      page: number | null;
      quote: string;
      raw_score: number;
    }>;
    results = rows.map((row) => ({
      chunk_id: row.chunk_id,
      document_id: row.document_id,
      section_path: row.section_path,
      page: row.page,
      quote: row.quote,
      score: Number(Math.max(0, -row.raw_score).toFixed(4)),
    }));
  } catch {
    const like = terms.map(() => 'c.text LIKE ?').join(' OR ');
    const rows = db
      .prepare(
        `SELECT c.id AS chunk_id, c.document_id, c.section_path, c.page,
                c.text AS quote
         FROM core_chunks c
          WHERE ${allDocs ? '' : 'c.dataset_id = ? AND '}c.level = 'child' ${sectionFilter} AND (${like})
          LIMIT ?`,
      )
      .all(...datasetArgs, ...sectionArgs, ...terms.map((t) => `%${t}%`), fetchLimit) as Array<{
      chunk_id: number;
      document_id: string;
      section_path: string;
      page: number | null;
      quote: string;
    }>;
    results = rows.map((row) => ({ ...row, score: 0.5 }));
  }

  if (!results.length && !allDocs && ids.length) {
    const placeholders = ids.map(() => '?').join(',');
    const rows = db
      .prepare(
        `SELECT c.id AS chunk_id, c.document_id, c.section_path, c.page,
                c.text AS quote
         FROM core_chunks c
         WHERE c.dataset_id IN (${placeholders}) AND c.level = 'child'
         ORDER BY c.id LIMIT ?`,
      )
      .all(...ids, fetchLimit) as Array<{
      chunk_id: number;
      document_id: string;
      section_path: string;
      page: number | null;
      quote: string;
    }>;
    results = rows.map((row) => ({ ...row, score: 0.01 }));
  }

  if (!useBoost) return results.slice(0, limit);
  return results
    .map((citation) => ({ citation, rank: (citation.score ?? 0) + metadataBoost(citation, options) }))
    .sort((a, b) => b.rank - a.rank)
    .slice(0, limit)
    .map((entry) => entry.citation);
}

/** Ambil teks induk (parent section) dari child chunk untuk context bundle. */
export function parentContext(db: DB, chunkId: number): string | null {
  const row = db
    .prepare(
      `SELECT p.text FROM core_chunks c
       JOIN core_chunks p ON p.id = c.parent_id
       WHERE c.id = ?`,
    )
    .get(chunkId) as { text: string } | undefined;
  return row?.text ?? null;
}
