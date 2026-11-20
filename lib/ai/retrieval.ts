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
  /**
   * When supplied, every evidence citation must resolve to a READY document
   * and a parseable, non-skipped chunk with a matching rev. Invalid citations
   * are dropped (fail-closed) and the status is downgraded. Absent = legacy
   * behaviour, so existing callers are unaffected.
   */
  citationRegistry?: CitationRegistry | null;
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

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Hitungan term dengan batas kata. Pencocokan substring membuat "pengadu"
 * ikut cocok dengan "pengaduan" — itu yang menggeser butir 7 dari definisi
 * "Pengadu" ke bawah. Dipakai oleh fallback leksikal dan eval harness.
 */
export function lexicalHits(text: string, terms: string[]): number {
  const hay = String(text ?? '').toLowerCase();
  let hits = 0;
  for (const term of terms ?? []) {
    const t = escapeRe(String(term).toLowerCase());
    if (!t) continue;
    if (new RegExp(`(^|[^a-z0-9])${t}([^a-z0-9]|$)`).test(hay)) hits += 1;
  }
  return hits;
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
  /** "Apa yang dimaksud X?" → X; dipakai untuk boost definisi "X adalah". */
  definitionTerm: string | null;
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
  const defMatch = q.match(/\bdimaksud\s+(?:dengan\s+)?([A-Za-zÀ-ÿ][\wÀ-ÿ\s-]*?)\s*\??\s*$/i);
  const definitionTerm = defMatch ? defMatch[1].trim().replace(/[?.]+$/, '').trim() : null;
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
    definitionTerm,
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
        .map((c) => ({ chunk: c, hits: lexicalHits(c.text, terms) }))
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
  let evidence: Citation[] = [];
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

  // FR-D.1: fail-closed deep-link validation before a citation is rendered.
  // A citation without a real chunk id, from a non-READY document, or with a
  // stale rev is dropped — never shown to the user as if it were grounded.
  let droppedCitations = 0;
  if (input.citationRegistry) {
    const kept: Citation[] = [];
    for (const c of evidence) {
      const rev = input.citationRegistry.documents[c.doc]?.rev ?? null;
      const link = rev ? buildCitationDeepLink({
        docId: c.doc,
        page: c.page ?? 1,
        section: c.section_path,
        chunk: c.chunk_id,
        rev,
      }) : null;
      const verdict = link
        ? validateCitationDeepLink(link, input.citationRegistry, c.quote)
        : { valid: false, reason: 'MISSING_CHUNK' };
      if (verdict.valid && link) {
        kept.push({ ...c, deep_link: link, deep_link_status: 'valid', rev });
      } else {
        droppedCitations += 1;
      }
    }
    evidence = kept;
  }

  const status: RetrievalResult['status'] = evidence.length === 0
    ? 'no_evidence'
    : (droppedCitations > 0 || (ranked[0]?.final ?? 0) < 0.25) ? 'evidence_limited' : 'ok';

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
      // Pertanyaan definisi: teks "X adalah ..." adalah bukti paling tepat.
      if (entities.definitionTerm) {
        const defRe = new RegExp(`\\b${escapeRe(entities.definitionTerm)}\\s+adalah\\b`, 'i');
        if (defRe.test(String(citation.quote ?? ''))) boost += 0.5;
      }
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

/* ========================================================================== */
/* CORE V2 — citation deep link + deterministic evidence helpers (FR-A/FR-D)   */
/* docs/CORE_V2_SPEC.md §5 · docs/RAG_ROBUSTNESS_RESEARCH.md §7               */
/* ========================================================================== */

export interface CitationDeepLinkParts {
  /** Immutable source_id, never a file name. */
  docId: string;
  /** 1-indexed page (PDF viewer compatible). */
  page: number;
  pageEnd?: number | null;
  /** URL-encoded section_path; '/' is the hierarchy separator. */
  section: string;
  /** CHILD chunk id — precision anchor. Absent ⇒ citation is rejected. */
  chunk: string;
  /** Prefix of the active content hash; prevents citing a stale revision. */
  rev: string;
}

export interface CitationRegistry {
  documents: Record<string, { status?: string; pageCount?: number; rev?: string }>;
  chunks: Record<string, {
    document_id: string;
    section_path: string;
    page: number | null;
    page_end?: number | null;
    text: string;
    parse_ok?: boolean;
    ocr_status?: string | null;
    rev?: string | null;
  }>;
}

export interface DeepLinkValidation {
  valid: boolean;
  reason: string | null;
  docId: string | null;
  chunkId: string | null;
  parts: Partial<CitationDeepLinkParts> | null;
}

/**
 * Build `docId#page=3&pageEnd=4&section=...&chunk=...&rev=...`.
 * Returns null when a required anchor is missing — a citation without a real
 * chunk id is never emitted (CORE_V2_SPEC AC-D.1.1 / task requirement).
 */
export function buildCitationDeepLink(parts: CitationDeepLinkParts): string | null {
  if (!parts?.docId || !parts.chunk || !parts.section || !parts.rev) return null;
  const page = Number(parts.page);
  if (!Number.isInteger(page) || page < 1) return null;
  const params = [`page=${page}`];
  const pageEnd = parts.pageEnd == null ? null : Number(parts.pageEnd);
  if (pageEnd !== null && Number.isInteger(pageEnd) && pageEnd >= page) {
    params.push(`pageEnd=${pageEnd}`);
  }
  params.push(`section=${encodeURIComponent(parts.section)}`);
  params.push(`chunk=${encodeURIComponent(parts.chunk)}`);
  params.push(`rev=${encodeURIComponent(parts.rev)}`);
  return `${parts.docId}#${params.join('&')}`;
}

/**
 * Fail-closed validation of a deep link against the registry. Every check is
 * deterministic and local — no network, no model, no extra memory. A single
 * failure drops the citation; the answer degrades to `evidence_limited`.
 */
export function validateCitationDeepLink(
  link: string,
  registry: CitationRegistry,
  quote?: string | null,
): DeepLinkValidation {
  const fail = (reason: string): DeepLinkValidation => ({
    valid: false, reason, docId: null, chunkId: null, parts: null,
  });
  if (!link || typeof link !== 'string') return fail('MISSING_LINK');
  if (/^(javascript|data|file):/i.test(link) || /^https?:\/\//i.test(link)) return fail('UNSAFE_SCHEME');
  const hash = link.indexOf('#');
  if (hash <= 0) return fail('MALFORMED_LINK');

  const docId = link.slice(0, hash);
  const params = new URLSearchParams(link.slice(hash + 1));
  const pageRaw = params.get('page');
  const sectionRaw = params.get('section');
  const chunkRaw = params.get('chunk');
  const revRaw = params.get('rev');

  // "Sitasi tanpa chunk asal ditolak" — this is the first hard gate.
  if (!chunkRaw) return fail('MISSING_CHUNK');
  if (!pageRaw || !sectionRaw || !revRaw) return fail('MISSING_REQUIRED_PARAM');

  const page = Number(pageRaw);
  if (!Number.isInteger(page) || page < 1) return fail('INVALID_PAGE');

  const doc = registry?.documents?.[docId];
  if (!doc) return fail('UNKNOWN_DOC');
  if (doc.status !== 'READY') return fail('DOC_NOT_READY');

  const chunk = registry?.chunks?.[chunkRaw];
  if (!chunk) return fail('UNKNOWN_CHUNK');
  if (chunk.document_id !== docId) return fail('CHUNK_DOC_MISMATCH');
  if (chunk.parse_ok === false) return fail('CHUNK_PARSE_FAILED');
  if (chunk.ocr_status === 'ocr_skipped' || chunk.ocr_status === 'unreadable') return fail('CHUNK_UNREADABLE');
  if (chunk.page !== page) return fail('PAGE_MISMATCH');

  const pageEnd = params.has('pageEnd') ? Number(params.get('pageEnd')) : null;
  if (pageEnd !== null && (!Number.isInteger(pageEnd) || pageEnd < page)) return fail('INVALID_PAGE_END');
  if (doc.pageCount && pageEnd !== null && pageEnd > doc.pageCount) return fail('PAGE_OUT_OF_RANGE');

  // URLSearchParams already decodes percent-escapes.
  if (sectionRaw !== chunk.section_path) return fail('SECTION_MISMATCH');

  const expectedRev = chunk.rev ?? doc.rev;
  if (!expectedRev || revRaw !== expectedRev) return fail('REV_MISMATCH');

  if (quote) {
    const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
    if (!norm(chunk.text).includes(norm(quote))) return fail('QUOTE_MISMATCH');
  }

  return {
    valid: true,
    reason: null,
    docId,
    chunkId: chunkRaw,
    parts: {
      docId, page, pageEnd, section: chunk.section_path, chunk: chunkRaw, rev: revRaw,
    },
  };
}

/* ------------------------------------------- deterministic ingest evidence */

export interface PageSignal {
  page: number;
  chars: number;
  imageCoverage?: number;
  gibberishRatio?: number;
  ocr_status?: string | null;
}

export interface OcrPlan {
  ocr_pages: number[];
  unreadable_pages: number[];
  text_pages: number[];
  ocrUsed: boolean;
}

/**
 * Per-page OCR routing from signals already present at extraction time
 * (RAG_ROBUSTNESS_RESEARCH §1–2). Pure: it never calls OCR and never mutates
 * text. A page that failed OCR is `unreadable`, not silently cited.
 */
export function planOcrPages(pages: PageSignal[]): OcrPlan {
  const ocr_pages: number[] = [];
  const unreadable_pages: number[] = [];
  const text_pages: number[] = [];
  for (const p of pages ?? []) {
    const needsOcr = p.chars < 40
      || (p.imageCoverage ?? 0) >= 0.60
      || (p.gibberishRatio ?? 0) > 0.15;
    if (!needsOcr) {
      text_pages.push(p.page);
      continue;
    }
    if (p.ocr_status === 'ocr_skipped' || p.ocr_status === 'unreadable' || p.ocr_status === 'timeout') {
      unreadable_pages.push(p.page);
    } else {
      ocr_pages.push(p.page);
    }
  }
  return { ocr_pages, unreadable_pages, text_pages, ocrUsed: ocr_pages.length > 0 };
}

/** Numeric checksum: cleaning must not change any number or unit token. */
export function numericChecksum(values: Array<string | number> | string): string {
  const text = Array.isArray(values) ? values.join(' ') : String(values ?? '');
  return (text.match(/\d+(?:[.,]\d+)*/g) ?? []).map((t) => t.replace(',', '.')).join('|');
}

/** FNV-1a over NFKD/lowercased/space-normalised text — dedup + `rev` prefix. */
export function contentHash(text: string): string {
  const s = String(text ?? '').toLowerCase().normalize('NFKD').replace(/\s+/g, ' ').trim();
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export interface StitchPage {
  page: number;
  text: string;
  section_path: string;
  ocr_status?: string | null;
}

export interface StitchedChunk {
  text: string;
  page_span: [number, number];
  section_path: string;
  stitched: boolean;
  ocr_status?: string | null;
}

/**
 * Join only when EVERY hard rule holds (RAG_ROBUSTNESS_RESEARCH §4): same
 * section, open sentence end, lowercase continuation, neither page unreadable.
 * One wrong join changes meaning; one missed join is merely ugly.
 */
export function stitchPageTexts(pages: StitchPage[]): StitchedChunk[] {
  const out: StitchedChunk[] = [];
  for (const p of pages ?? []) {
    const prev = out[out.length - 1];
    const openEnd = !!prev
      && !/[.!?]["')]?\s*$/.test(prev.text)
      && !/-\s*$/.test(prev.text);
    const openStart = /^[a-z]/.test(p.text)
      && !/^(pasal|ayat|bab|halaman|page)\b/i.test(p.text);
    const canJoin = !!prev && openEnd && openStart
      && prev.section_path === p.section_path
      && prev.ocr_status !== 'ocr_skipped' && p.ocr_status !== 'ocr_skipped';
    if (canJoin) {
      const hyphen = /-\s*$/.test(prev.text);
      prev.text = `${prev.text.replace(/-\s*$/, '')}${hyphen ? '' : ' '}${p.text}`;
      prev.page_span = [prev.page_span[0], p.page];
      prev.stitched = true;
    } else {
      out.push({
        text: p.text,
        page_span: [p.page, p.page],
        section_path: p.section_path,
        stitched: false,
        ocr_status: p.ocr_status ?? null,
      });
    }
  }
  return out;
}

/* ========================================================================== */
/* P3-TUNING — deterministic legal section expansion (FR-B.1 filter)            */
/*                                                                             */
/* "Pasal 1 berbunyi apa?" adalah operasi filter, bukan generasi bebas.         */
/* Fungsi ini mengembalikan parent + SELURUH child-nya dalam urutan dokumen,     */
/* tanpa small-to-big parent-dedup yang menyembunyikan butir/ayat. Tanpa model,  */
/* tanpa jaringan, tanpa memori tambahan yang residen.                          */
/* ========================================================================== */

export interface LegalSectionChunk {
  id: string;
  section_path: string;
  text: string;
  page: number | null;
  page_end?: number | null;
  parent_id?: string | null;
  chunk_type?: string | null;
}

export interface LegalSectionResult {
  pasal: number;
  parent: LegalSectionChunk | null;
  children: LegalSectionChunk[];
  evidence: Citation[];
  page_span: [number, number] | null;
  duplicate_count: number;
  tried_terms: string[];
}

function legalOrder(a: LegalSectionChunk, b: LegalSectionChunk): number {
  const rank = (c: LegalSectionChunk) => {
    const m = c.section_path.match(/(?:butir|ayat)\s*\(?(\d+)\)?/i);
    if (m) return Number(m[1]);
    if (/butir\s+pengantar/i.test(c.section_path)) return -1;
    return 0;
  };
  return rank(a) - rank(b);
}

/**
 * Kembalikan pasal + child-nya. Dedup memakai contentHash NFKD/lowercase;
 * page_span dihitung dari halaman semua potongan yang dipakai (lintas halaman
 * tidak menghasilkan dua chunk ganda).
 */
export function retrieveLegalSection(chunks: LegalSectionChunk[], pasal: number): LegalSectionResult {
  const re = new RegExp(`\\bPasal\\s+0*${pasal}\\b`, 'i');
  const parent = (chunks ?? []).find((c) => !c.parent_id && re.test(c.section_path)) ?? null;
  const children = parent
    ? (chunks ?? []).filter((c) => c.parent_id === parent.id).sort(legalOrder)
    : [];
  const all = parent ? [parent, ...children] : [];

  const seen = new Set<string>();
  const unique = all.filter((c) => {
    const h = contentHash(c.text);
    if (seen.has(h)) return false;
    seen.add(h);
    return true;
  });

  const pages = unique
    .map((c) => c.page)
    .filter((p): p is number => typeof p === 'number' && Number.isFinite(p));
  const ends = unique.map((c) => (typeof c.page_end === 'number' ? c.page_end : c.page));
  const validEnds = ends.filter((p): p is number => typeof p === 'number' && Number.isFinite(p));
  const pageSpan: [number, number] | null = pages.length
    ? [Math.min(...pages), Math.max(...validEnds, ...pages)]
    : null;

  const evidence: Citation[] = unique.map((c) => ({
    chunk_id: c.id,
    section_id: parent?.id ?? c.id,
    section_path: c.section_path,
    doc: 'perpres76',
    page: c.page ?? null,
    quote: c.text.replace(/\s+/g, ' ').slice(0, 400),
    score: 1,
  }));

  return {
    pasal,
    parent,
    children,
    evidence,
    page_span: pageSpan,
    duplicate_count: all.length - unique.length,
    tried_terms: [`Pasal ${pasal}`],
  };
}
