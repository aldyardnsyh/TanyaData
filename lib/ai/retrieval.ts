/**
 * TanyaData AI — retrieval dokumen (lib/ai/retrieval.ts).
 *
 * FTS5 `document_chunks_fts` + fallback LIKE. Query expansion sinonim
 * (via normalize.ts). Top 3–5 chunk. Sitasi wajib:
 * {kind:'document', sourceId, docTitle, sectionNo, section, page, quote, chunkId, score}.
 */
import type { DB } from '@/lib/db/client';
import type { Citation as CoreCitation } from '@/lib/core/contracts';
import { searchChunks } from '@/lib/core/store';
import type { Lang, SourceCitation } from '@/lib/contracts/http';
import { allRows, num, str } from '@/lib/analytics/sql';
import { normalizeText, stopwordTokens } from '@/lib/ai/normalize';
import { truncateText } from '@/lib/date';
import type {
  Chunk, Citation, DocType, RetrievalResult, RetrievalScore,
} from './types';

const MAX_TERMS = 12;

function ftsTerms(question: string): string[] {
  const q = normalizeText(question);
  return stopwordTokens(q).filter((t) => t.length >= 3).slice(0, MAX_TERMS);
}

function toCitation(row: Record<string, unknown>): SourceCitation {
  const rawScore = row.score;
  const score =
    typeof rawScore === 'number' && Number.isFinite(rawScore)
      ? Math.round((1 / (1 + Math.abs(rawScore))) * 1000) / 1000
      : undefined;
  return {
    kind: 'document',
    sourceId: str(row.source_id),
    docTitle: str(row.doc_title),
    sectionNo: row.section_no === null || row.section_no === undefined ? null : num(row.section_no),
    section: str(row.section) || null,
    page: row.page === null || row.page === undefined ? null : num(row.page),
    quote: truncateText(str(row.content).replace(/\s+/g, ' '), 240),
    chunkId: num(row.id),
    ...(score === undefined ? {} : { score }),
  };
}

function likeQuery(terms: string[], requireAll: boolean): string {
  const conds = terms.map(() => 'c.content LIKE ?');
  return `SELECT c.id, c.source_id, c.doc_title, c.section_no, c.section, c.page, c.content
            FROM document_chunks c
           WHERE ${conds.join(requireAll ? ' AND ' : ' OR ')}
           LIMIT 500`;
}

export function retrieveDocuments(db: DB, question: string, lang: Lang): SourceCitation[] {
  const terms = ftsTerms(question);
  if (!terms.length) return [];

  // 1) FTS5 MATCH dengan OR
  const match = terms.map((t) => `"${t}"`).join(' OR ');
  try {
    const rows = allRows(
      db,
      `SELECT c.id, c.source_id, c.doc_title, c.section_no, c.section, c.page, c.content, bm25(document_chunks_fts) AS score
         FROM document_chunks_fts f
         JOIN document_chunks c ON c.id = f.rowid
        WHERE document_chunks_fts MATCH ?
        ORDER BY score
        LIMIT 5`,
      [match],
    );
    if (rows.length) return rows.map(toCitation);
  } catch {
    // fallback ke LIKE
  }

  // 2) LIKE fallback: AND antar-term, lalu OR
  for (const requireAll of [true, false]) {
    try {
      const rows = allRows(db, likeQuery(terms, requireAll), terms.map((t) => `%${t}%`));
      if (rows.length) return rows.slice(0, 5).map(toCitation);
    } catch {
      // lanjut
    }
  }
  return [];
}

/* ========================================================================== */
/* GENERAL CORE (P3-CORE) — docs/CORE_AI_SPEC.md §5                            */
/* The block above is the legacy demo adapter and is intentionally untouched. */
/* ========================================================================== */

export interface FtsDb {
  prepare(sql: string): {
    all: (...args: unknown[]) => Record<string, unknown>[];
    run: (...args: unknown[]) => unknown;
  };
  exec(sql: string): unknown;
}

export interface HybridRetrieveInput {
  question: string;
  chunks: Chunk[];
  /** Connection with FTS5 available. When absent, a lexical fallback is used. */
  db?: FtsDb | null;
  docType?: DocType | null;
  topK?: number;
  budgetTokens?: number;
  /** Optional embedding scores keyed by chunk id; skipped when absent. */
  embeddingScores?: Record<string, number> | null;
  schemaText?: string;
  sqlText?: string;
  instructionText?: string;
}

const GENERAL_STOPWORDS = new Set([
  'yang', 'di', 'pada', 'untuk', 'dari', 'ini', 'itu', 'dan', 'atau', 'dengan',
  'oleh', 'ke', 'the', 'of', 'for', 'in', 'is', 'are', 'apa', 'siapa', 'kapan',
  'mana', 'bagaimana', 'mengapa', 'kenapa', 'sejak', 'berapa', 'banyak', 'tentang',
  'menurut', 'berbunyi', 'bunyi', 'apa', 'saja', 'ada', 'dalam',
]);

export function queryTerms(question: string, maxTerms = 12): string[] {
  const normalized = String(question ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized.split(' ')
    .filter((t) => t.length >= 3 && !GENERAL_STOPWORDS.has(t))
    .slice(0, maxTerms);
}

/* ------------------------------------------------------------ entity signals */

export interface RetrievalEntities {
  pasal: string[];
  ayat: number[];
  failureCodes: string[];
  channels: string[];
  /** section_path substring for store.searchChunks({ boostSection }). */
  boostSection: string | null;
  /** Explicit page hint ("halaman 10") when the question carries one. */
  boostPage: number | null;
  /** Canonical phrases offered to the user on `limited` / `refused`. */
  keywords: string[];
}

/**
 * Deterministic entity extraction for the model-free reranker. No embedding
 * and no local ML model: reads pasal/ayat numbers, failure codes (Fnn) and
 * known channel names straight from the question. `knownChannels` is supplied
 * by callers that have a seed/schema; it is optional so the AI lane stays
 * dataset-agnostic.
 */
export function extractRetrievalEntities(question: string, knownChannels: string[] = []): RetrievalEntities {
  const q = String(question ?? '');
  const pasal = [...q.matchAll(/pasal\s*(\d+)/gi)].map((m) => m[1]);
  const ayat = [...q.matchAll(/ayat\s*\(?(\d+)\)?/gi)].map((m) => Number(m[1]));
  const range = q.match(/ayat\s*(\d+)\s*(?:-|–|s\.?d\.?|to)\s*(\d+)/i);
  if (range) {
    const from = Number(range[1]);
    const to = Number(range[2]);
    for (let n = from; n <= to && n - from < 20; n += 1) ayat.push(n);
  }
  const failureCodes = [...new Set([...q.matchAll(/\bf\d{2}\b/gi)].map((m) => m[0].toUpperCase()))];
  const lower = q.toLowerCase();
  const channels = knownChannels.filter((name) => {
    const n = String(name ?? '').toLowerCase();
    return n.length >= 2 && lower.includes(n);
  });
  const pageMatch = q.match(/(?:halaman|hlm\.?|page)\s*(\d+)/i);
  const boostPage = pageMatch ? Number(pageMatch[1]) : null;
  const boostSection = pasal.length
    ? `Pasal ${pasal[0]}`
    : failureCodes.length
      ? failureCodes[0]
      : channels.length
        ? channels[0]
        : null;
  const keywords = [
    ...pasal.map((p) => `Pasal ${p}`),
    ...[...new Set(ayat)].map((n) => `Ayat (${n})`),
    ...failureCodes,
    ...channels,
  ];
  return {
    pasal: [...new Set(pasal)],
    ayat: [...new Set(ayat)],
    failureCodes,
    channels,
    boostSection,
    boostPage,
    keywords: [...new Set(keywords)],
  };
}

/** Idempotently (re)build the FTS5 index from the supplied chunks. */
export function ensureFtsIndex(db: FtsDb, chunks: Chunk[]): void {
  db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS core_chunks_fts USING fts5(
    text, doc UNINDEXED, section_path UNINDEXED, page UNINDEXED,
    doc_type UNINDEXED, parse_ok UNINDEXED, parent_id UNINDEXED
  )`);
  db.exec('DELETE FROM core_chunks_fts');
  const insert = db.prepare(
    'INSERT INTO core_chunks_fts(rowid, text, doc, section_path, page, doc_type, parse_ok, parent_id) VALUES (?,?,?,?,?,?,?,?)',
  );
  chunks.forEach((c, i) => {
    insert.run(
      i + 1, c.text, c.doc, c.section_path, c.page ?? null,
      c.doc_type ?? '', c.parse_ok === false ? '0' : '1', c.parent_id ?? '',
    );
  });
}

interface FtsRow {
  rowid: number;
  text: string;
  doc: string;
  section_path: string;
  page: number | null;
  doc_type: string;
  parse_ok: string;
  parent_id: string;
  score: number;
}

function ftsSearch(db: FtsDb, terms: string[], topK: number): FtsRow[] {
  const safe = terms.map((t) => t.replace(/[^a-z0-9]/g, '')).filter(Boolean);
  if (!safe.length) return [];
  const match = safe.map((t) => `"${t}"`).join(' OR ');
  try {
    return db.prepare(
      `SELECT rowid, text, doc, section_path, page, doc_type, parse_ok, parent_id,
              bm25(core_chunks_fts) AS score
         FROM core_chunks_fts
        WHERE core_chunks_fts MATCH ? AND parse_ok = '1'
        ORDER BY score LIMIT ?`,
    ).all(match, topK) as unknown as FtsRow[];
  } catch {
    return [];
  }
}

function likeSearch(db: FtsDb, terms: string[], topK: number): FtsRow[] {
  for (const requireAll of [true, false]) {
    const cond = terms.map(() => 'text LIKE ?').join(requireAll ? ' AND ' : ' OR ');
    try {
      const rows = db.prepare(
        `SELECT rowid, text, doc, section_path, page, doc_type, parse_ok, parent_id, 0 AS score
           FROM core_chunks_fts WHERE parse_ok = '1' AND (${cond}) LIMIT ?`,
      ).all(...terms.map((t) => `%${t}%`), topK) as unknown as FtsRow[];
      if (rows.length) return rows;
    } catch {
      // next strategy
    }
  }
  return [];
}

function metadataBoost(row: FtsRow, docType: DocType | null | undefined): number {
  let boost = 0;
  if (docType && row.doc_type === docType) boost += 0.4;
  if (row.page && row.page > 0) boost += 0.3;
  const depth = row.section_path.split('/').length;
  boost += Math.min(0.3, depth * 0.1);
  return Math.min(1, boost);
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

/**
 * Hybrid retrieval: FTS5 BM25 (mandatory) → optional embedding → simple
 * reranker → small-to-big parent expansion → context budget. Zero evidence is
 * reported honestly; the model is never allowed to fill the gap.
 */
export function retrieveHybrid(input: HybridRetrieveInput): RetrievalResult {
  const terms = queryTerms(input.question);
  const topK = input.topK ?? 5;
  const budget = input.budgetTokens ?? 6000;
  const chunks = input.chunks ?? [];
  const byId = new Map(chunks.map((c, i) => [String(c.id), c]));
  const byRowid = new Map(chunks.map((c, i) => [i + 1, c]));

  let rows: FtsRow[] = [];
  let usedFts = false;
  if (input.db) {
    ensureFtsIndex(input.db, chunks);
    rows = ftsSearch(input.db, terms, topK);
    usedFts = rows.length > 0;
    if (!rows.length) rows = likeSearch(input.db, terms, topK);
  } else {
    // Deterministic lexical fallback when no FTS connection is supplied.
    const scored = chunks
      .filter((c) => c.parse_ok !== false)
      .map((c) => {
        const hay = c.text.toLowerCase();
        const hits = terms.filter((t) => hay.includes(t)).length;
        return { chunk: c, hits };
      })
      .filter((x) => x.hits > 0)
      .sort((a, b) => b.hits - a.hits)
      .slice(0, topK);
    rows = scored.map((x, i) => {
      const c = x.chunk;
      const idx = chunks.indexOf(c) + 1;
      return {
        rowid: idx, text: c.text, doc: c.doc, section_path: c.section_path,
        page: c.page ?? null, doc_type: c.doc_type ?? '', parse_ok: '1',
        parent_id: c.parent_id ?? '', score: -x.hits - i * 0.01,
      };
    });
  }

  const maxAbs = Math.max(1e-6, ...rows.map((r) => Math.abs(r.score)));
  const scores: RetrievalScore[] = [];
  const ranked = rows.map((r) => {
    const bm25Norm = usedFts ? 1 / (1 + Math.abs(r.score) / maxAbs) : 1 / (1 + Math.abs(r.score));
    const embedNorm = input.embeddingScores?.[String(byRowid.get(r.rowid)?.id ?? '')] ?? null;
    const meta = metadataBoost(r, input.docType);
    const final = embedNorm === null
      ? 0.90 * bm25Norm + 0.10 * meta
      : 0.60 * bm25Norm + 0.30 * embedNorm + 0.10 * meta;
    const chunk = byRowid.get(r.rowid);
    if (chunk) scores.push({ chunk_id: String(chunk.id), bm25: bm25Norm, ...(embedNorm === null ? {} : { embed: embedNorm }), metadata: meta, final });
    return { row: r, final };
  }).sort((a, b) => b.final - a.final);

  // small-to-big: expand child → parent, deduplicate by parent id
  const seenParents = new Set<string>();
  const evidence: Citation[] = [];
  for (const { row, final } of ranked) {
    const child = byRowid.get(row.rowid);
    if (!child) continue;
    const parentKey = child.parent_id || String(child.id);
    if (seenParents.has(parentKey)) continue;
    seenParents.add(parentKey);
    const parent = child.parent_id ? byId.get(child.parent_id) : undefined;
    const contextText = parent?.text ?? child.text;
    evidence.push({
      chunk_id: String(child.id),
      section_id: parentKey,
      section_path: child.section_path,
      doc: child.doc,
      page: child.page ?? null,
      quote: contextText.replace(/\s+/g, ' ').slice(0, 400),
      score: Math.round(final * 1000) / 1000,
    });
  }

  const status: RetrievalResult['status'] = evidence.length === 0
    ? 'no_evidence'
    : (ranked[0]?.final ?? 0) < 0.25 ? 'evidence_limited' : 'ok';

  const contextBundle = buildContextBundle({
    evidence,
    schemaText: input.schemaText ?? '',
    sqlText: input.sqlText ?? '',
    instructionText: input.instructionText ?? '',
    budgetTokens: budget,
  });

  return {
    evidence,
    context_bundle: contextBundle,
    scores,
    status,
    tried_terms: terms,
    budget_tokens: budget,
    used_tokens: estimateTokens(contextBundle),
    message: status === 'no_evidence'
      ? `Informasi ini tidak ditemukan pada sumber yang tersedia. Kata kunci yang dicoba: ${terms.join(', ') || '(kosong)'}.`
      : status === 'evidence_limited'
        ? 'Bukti ditemukan tetapi skornya rendah; jawaban harus diberi label evidence_limited.'
        : undefined,
  };
}

/** 50% citations · 25% schema · 15% SQL · 10% instructions (spec §5.3). */
export function buildContextBundle(parts: {
  evidence: Citation[];
  schemaText?: string;
  sqlText?: string;
  instructionText?: string;
  budgetTokens: number;
}): string {
  const budget = parts.budgetTokens;
  const caps = {
    evidence: Math.floor(budget * 0.5),
    schema: Math.floor(budget * 0.25),
    sql: Math.floor(budget * 0.15),
    instruction: Math.floor(budget * 0.10),
  };
  const take = (text: string, cap: number) => {
    const maxChars = cap * 4;
    return text.length <= maxChars ? text : `${text.slice(0, maxChars)}…`;
  };
  const cite = parts.evidence
    .map((c, i) => `[${i + 1}] ${c.doc} · ${c.section_path}${c.page ? ` · hlm ${c.page}` : ''}\n${c.quote}`)
    .join('\n\n');
  const blocks = [
    `SITASI:\n${take(cite, caps.evidence)}`,
    `SKEMA:\n${take(parts.schemaText ?? '', caps.schema)}`,
    `HASIL SQL:\n${take(parts.sqlText ?? '', caps.sql)}`,
    `INSTRUKSI:\n${take(parts.instructionText ?? '', caps.instruction)}`,
  ];
  return blocks.join('\n\n---\n\n');
}

/* --------------------------------------------------------------- reranker */

export interface RerankableCitation {
  section_path: string;
  quote?: string | null;
  score?: number | null;
}

/**
 * Lightweight, model-free reranker for an already-retrieved candidate list.
 *
 * FTS5 OR-matching makes every child chunk of a legal document match the term
 * "pasal" through its section_path, so BM25 alone cannot tell which pasal (or
 * which ayat) the question actually asked for. This reranker reads the
 * requested pasal/ayat numbers from the question and boosts matching sections.
 * It never invents a citation: it only reorders candidates that FTS5 returned.
 *
 * Callers should retrieve a WIDER candidate set (e.g. limit 20) and then take
 * the top-k after reranking — reordering five items cannot surface an ayat
 * that was never in the candidate list.
 */
export function rerankCitations<T extends RerankableCitation>(question: string, citations: T[]): T[] {
  const entities = extractRetrievalEntities(question);

  return citations
    .map((citation, index) => {
      const section = String(citation.section_path ?? '');
      const hay = section.toLowerCase();
      let boost = 0;
      if (entities.pasal.length && entities.pasal.some((p) =>
        new RegExp(`pasal\\s*0*${p}\\b`, 'i').test(section))) {
        boost += 0.6;
      }
      for (const n of entities.ayat) {
        if (section.includes(`Ayat (${n})`) || section.includes(`ayat ${n}`)) boost += 0.25;
      }
      if (entities.failureCodes.some((c) => hay.includes(c.toLowerCase()))) boost += 0.4;
      if (entities.channels.some((c) => hay.includes(c.toLowerCase()))) boost += 0.3;
      const base = typeof citation.score === 'number' && Number.isFinite(citation.score)
        ? citation.score
        : 0;
      return { citation, index, rank: base + Math.min(1, boost) };
    })
    .sort((a, b) => b.rank - a.rank || a.index - b.index)
    .map((x) => x.citation);
}

/**
 * Model-free reranker entry point for the core FTS5 store. Entities parsed
 * from the question become `boostSection` / `boostPage` on `searchChunks`, so
 * the store widens its candidate pool and lifts matching section paths BEFORE
 * top-k is cut. No embedding, no local model, no extra memory footprint —
 * only deterministic metadata scoring on chunks FTS5 already returned.
 */
export function retrieveWithEntityBoost(
  db: DB,
  datasetId: string,
  question: string,
  limit = 5,
  knownChannels: string[] = [],
): CoreCitation[] {
  const entities = extractRetrievalEntities(question, knownChannels);
  return searchChunks(db, {
    datasetId,
    question,
    limit,
    boostSection: entities.boostSection,
    boostPage: entities.boostPage,
  });
}
