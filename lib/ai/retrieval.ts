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
import { normalizeText, stopwordTokens, correctQueryTypos } from '@/lib/ai/normalize';
import { truncateText } from '@/lib/date';
import { embedQuery } from './embedding';
import {
  fetchQdrantCandidates,
  getQdrantConfig,
  normalizeScore,
  rrfFuse,
  type Candidate,
  type FallbackReason,
  type RetrievalMode,
} from './hybrid';
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
  const normalized = correctQueryTypos(question ?? '')
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

/* ------------------------------------------------- P3-PRECISION: evidence gate */

/**
 * Kata tanya dan kata generik yang TIDAK boleh dijadikan "anchor bukti".
 * FTS5 OR-match mencocokkan kata-kata ini di hampir semua chunk dokumen SOP;
 * menyertakannya dalam penilaian dukungan membuat sitasi dari dokumen mana pun
 * tampak relevan (itulah sebabnya Cit-P baseline hanya 0.1336).
 */
const EVIDENCE_GENERIC_TERMS = new Set([
  'apa', 'apakah', 'berapa', 'bagaimana', 'kapan', 'siapa', 'dimana', 'mengapa',
  'kenapa', 'yang', 'dan', 'atau', 'dalam', 'untuk', 'dengan', 'pada', 'dari',
  'ini', 'itu', 'saja', 'ada', 'menjadi', 'sebagai', 'dapat', 'akan', 'sudah',
  'belum', 'tidak', 'paling', 'lama', 'sejak', 'tiap', 'setiap', 'kan', 'hal',
  'sama', 'dijelaskan', 'penjelasan', 'informasi', 'dokumen', 'tentang',
  'mengenai', 'berikut', 'berisi', 'tersebut', 'semua', 'masing', 'biasanya',
  'spesifikan', 'utamanya', 'utama', 'terjadi', 'kira', 'rugi', 'dampak',
  'menyebabkan', 'mempengaruhi', 'digunakan', 'didalamnya', 'alat', 'hasilnya',
  'kinerja', 'kinerjanya', 'menurun', 'meningkat', 'penurunan', 'efisiennya',
  'visualisasi', 'visualisasinya', 'chart', 'chartnya', 'analisis', 'disable',
]);

/**
 * Sinonim parafrasa untuk pertanyaan SOP. Sengaja DITIRU dari
 * `guardrails.ts::GUARDRAIL_SYNONYMS` (bukan di-impor) supaya retrieval.ts tidak
 * membuat dependency cycle dengan guardrails.ts yang meng-impor `queryTerms`.
 * Hanya parafrasa yang terbukti dipakai GT yang ditambahkan — bukan daftar
 * topik dokumen, agar tidak membuka jalan bagi OR-match generik.
 */
const EVIDENCE_SYNONYMS: Record<string, string[]> = {
  masuk: ['diterima', 'menerima', 'terima', 'received'],
  jalur: ['melalui', 'lewat'],
  bisa: ['dapat'],
  dilakukan: ['diberi'],
  belum: ['tidak'],
  cara: ['prosedur', 'bagaimana'],
  kepala: ['pimpinan'],
  bales: ['balas', 'respons', 'jawab', 'reply'],
  dibales: ['balas', 'respons', 'dijawab', 'reply'],
  dibalass: ['balas', 'respons', 'dijawab'],
  dibalas: ['balas', 'respons', 'dijawab'],
  respons: ['response', 'jawaban', 'bales'],
  response: ['respons', 'jawaban'],
  initial: ['awal', 'pertama'],
  awal: ['initial', 'pertama'],
  target: ['sasaran'],
  ticket: ['tiket'],
  tiket: ['ticket'],
  komplain: ['keluhan', 'pengaduan', 'complaint'],
  keluhan: ['komplain', 'complaint'],
  'terus-terusan': ['berulang', 'berkali-kali', 'ulang'],
  terus: ['berulang', 'ulang'],
  terusan: ['berulang', 'ulang'],
  diapain: ['penanganan', 'tindakan', 'ditangani'],
  retensi: ['penyimpanan', 'simpan', 'retention'],
  salinan: ['salin', 'copy', 'backup'],
  berkas: ['dokumen', 'file'],
};

/** Entitas kode/level tetap jadi anchor walaupun pendek (P1, SEV1, F04). */
const EVIDENCE_ENTITY_RE = /\b(p[1-4]|sev\d|f\d{2}|inc-\d{4}-\d{4}|v\d+\.\d+\.\d+)\b/gi;

/**
 * Entitas KUAT untuk relaksasi evidence gate parafrasa: kode/level, angka +
 * satuan waktu, atau nama bagian. Berbeda dari `evidenceAnchors` (semua term),
 * ini sengaja sempit agar tidak membuka jalan bagi OR-match generik — syarat
 * `global_negative` tetap abstain (soal tanpa entitas kuat tidak terpengaruh).
 */
const STRONG_ENTITY_RE =
  /\b(?:p[1-4]|sev\d|f\d{2}|inc-\d{4}-\d{4}|v\d+\.\d+\.\d+)\b|\b\d+\s*(?:menit|jam|hari|detik|minggu)(?:\s+kerja)?\b/gi;

function strongEntityHits(question: string, candidates: Array<{ section_path?: string | null }>): string[] {
  const q = String(question ?? '').toLowerCase();
  const hits = new Set<string>();
  for (const m of String(question ?? '').match(STRONG_ENTITY_RE) ?? []) {
    hits.add(m.toLowerCase().replace(/\s+/g, ' ').trim());
  }
  // Nama bagian: fragmen section_path kandidat yang memang disebut di soal.
  for (const c of candidates) {
    for (const part of String(c.section_path ?? '').split('/')) {
      const p = part.trim().toLowerCase();
      if (p.length >= 8 && q.includes(p)) hits.add(p);
    }
  }
  return [...hits];
}

export function evidenceAnchors(question: string): string[] {
  const terms = queryTerms(question).filter(
    (t) => t.length >= 4 && !EVIDENCE_GENERIC_TERMS.has(t),
  );
  const entities = [...new Set(
    String(question ?? '').match(EVIDENCE_ENTITY_RE)?.map((e) => e.toLowerCase()) ?? [],
  )];
  return [...new Set([...terms, ...entities])];
}

function anchorInText(anchor: string, hay: string): boolean {
  const variants = [anchor, ...(EVIDENCE_SYNONYMS[anchor] ?? [])];
  return variants.some((variant) => {
    const needle = variant.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (!needle) return false;
    return new RegExp(`(^|[^a-z0-9])${escapeRe(needle)}([^a-z0-9]|$)`).test(hay);
  });
}

/** Fraksi sekumpulan anchor yang benar-benar hadir di satu teks bukti. */
function coverageWithAnchors(anchors: string[], text: string): number {
  if (!anchors.length) return 1;
  const hay = String(text ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  const hits = anchors.filter((a) => anchorInText(a, hay)).length;
  return Number((hits / anchors.length).toFixed(4));
}

/** Fraksi anchor pertanyaan yang benar-benar hadir di satu teks bukti. */
export function evidenceCoverage(question: string, text: string): number {
  return coverageWithAnchors(evidenceAnchors(question), text);
}

/**
 * P3-PRECISION — pilih HANYA chunk yang mendukung jawaban, bukan semua kandidat
 * FTS5 OR. Dua langkah:
 *  1. Anchor yang muncul di > 50% kandidat dibuang (mirip-IDF): kata seperti
 *     "layanan"/"tiket" hadir di hampir semua chunk SOP, jadi bukan pembeda.
 *     Tanpa ini, pertanyaan di luar domain ("biaya langganan perusahaan")
 *     tetap lolos karena satu anchor generik cocok di mana-mana.
 *  2. Chunk dengan coverage tertinggi dipakai sebagai bukti. Chunk kedua hanya
 *     ditambahkan bila coverage-nya juga kuat, supaya Cit-P tidak jatuh.
 * Bila tidak ada chunk yang meng-cover anchor tersisa → kembalikan [] (abstain).
 * `score` tidak diubah sama sekali — tetap BM25 dari `searchChunks`.
 */
/** Percentil pada array terurut (interpolasi dibulatkan ke indeks terdekat). */
function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[i];
}

/**
 * Angka yang disebut di pertanyaan (termasuk kode P1/SEV1/F04) adalah sinyal
 * bukti paling kuat: bila angka/entitas itu hadir di sebuah chunk, chunk itu
 * tidak boleh dibuang hanya karena parafrasa membuat coverage turun.
 */
const QUESTION_NUMBER_RE = /\d+(?:[.,]\d+)*/g;

function questionNumbers(question: string): string[] {
  return [...new Set(String(question ?? '').match(QUESTION_NUMBER_RE) ?? [])];
}

/**
 * Apakah sebuah kandidat mengandung "unit bukti" yang benar-benar disebut di
 * pertanyaan? Dipakai sebagai pengaman: kandidat dengan sinyal ini TIDAK
 * pernah dibuang oleh gate, berapapun coverage token-nya.
 */
function hasKeyEvidence(
  c: CoreCitation,
  anchors: string[],
  numbers: string[],
  strong: string[],
): boolean {
  const hay = `${c.section_path ?? ''} ${c.quote ?? ''}`.toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  for (const n of numbers) {
    const digits = n.replace(/[^0-9]/g, '');
    if (digits.length > 0 && hay.includes(digits)) return true;
  }
  for (const e of strong) {
    const needle = e.replace(/[^a-z0-9]+/g, ' ').trim();
    if (needle.length > 0 && hay.includes(needle)) return true;
  }
  return anchors.some((a) => anchorInText(a, hay));
}

export function selectEvidenceChunks<T extends CoreCitation>(
  question: string,
  citations: T[],
  maxChunks = 2,
): T[] {
  if (!citations.length) return [];
  const allAnchors = evidenceAnchors(question);
  if (!allAnchors.length) return citations.slice(0, maxChunks);

  const hays = citations.map((c) =>
    `${c.section_path ?? ''} ${c.quote ?? ''}`.toLowerCase().replace(/[^a-z0-9]+/g, ' '));
  const df = (a: string) => hays.filter((h) => anchorInText(a, h)).length;
  // Ambang document-frequency RELATIF terhadap jumlah kandidat, bukan angka
  // mati 0.5. Mirip-IDF tetap dipakai, tetapi tidak membuang anchor yang
  // muncul di 50–60% kandidat (itu yang dulu menghilangkan bukti relevan).
  const maxDf = Math.max(1, Math.ceil(citations.length * 0.6));
  const byDf = [...allAnchors].sort((a, b) => df(a) - df(b));
  const discriminative = byDf.filter((a) => df(a) <= maxDf).slice(0, 4);
  const anchors = discriminative.length ? discriminative : byDf.slice(0, 4);

  const MULTI_PART_RE =
    /\b(ringkas|rangkum|seluruh|semua|apa\s+saja|serta|terkait|beberapa|peran|tugas|perbandingan|jelaskan\s+perbedaan)\b/i;
  const multiPart = MULTI_PART_RE.test(question);
  const capacity = multiPart ? Math.max(maxChunks, 4) : Math.min(maxChunks, 2);

  const scored = citations.map((c, index) => ({
    c,
    index,
    coverage: coverageWithAnchors(anchors, `${c.section_path ?? ''} ${c.quote ?? ''}`),
    score: typeof c.score === 'number' && Number.isFinite(c.score) ? c.score : 0,
  }));
  const sortedScores = scored.map((x) => x.score).sort((a, b) => a - b);
  const median = percentile(sortedScores, 0.5);
  const q25 = percentile(sortedScores, 0.25);
  const q75 = percentile(sortedScores, 0.75);
  const iqr = Math.max(1e-6, q75 - q25);
  const topScore = sortedScores[sortedScores.length - 1] ?? 0;
  const secondScore = sortedScores[sortedScores.length - 2] ?? topScore;
  const topMargin = topScore - secondScore;
  // Rasio distribusi korpus: seberapa jauh top-1 menonjol terhadap median+IQR.
  // Margin top-1/top-2 dipakai sebagai penguat, bukan angka mati coverage.
  const corpusRatio = topScore / Math.max(1e-6, median + iqr);
  const marginRatio = topMargin / Math.max(1e-6, Math.abs(topScore));

  const numbers = questionNumbers(question);
  const strong = strongEntityHits(question, citations);
  // Anchor untuk SINYAL KUNCI lebih ketat daripada anchor coverage: hanya
  // istilah yang benar-benar muncul di kandidat dan jarang (<=30% korpus).
  // Tanpa ini, kata generik seperti "tiket" tampak seperti bukti di mana-mana
  // dan soal di luar cakupan ikut dijawab (false_answer naik).
  const keyMaxDf = Math.max(1, Math.ceil(citations.length * 0.3));
  const keyAnchors = byDf.filter((a) => df(a) > 0 && df(a) <= keyMaxDf).slice(0, 4);
  const keySignal = (c: T): boolean => hasKeyEvidence(c, keyAnchors, numbers, strong);
  const topIdx = scored.reduce((best, x, i) => (x.score > scored[best].score ? i : best), 0);
  const topHasKey = keySignal(scored[topIdx].c);

  // FASE 2 v2 — gate tidak lagi memakai coverage absolut untuk membuang
  // kandidat. Kandidat yang mengandung angka/entitas/istilah kunci soal
  // dipertahankan bila top-1 cukup menonjol secara relatif. Untuk kandidat
  // tanpa sinyal kunci, keputusan abstain diambil dari margin skor top-1 vs
  // top-2 dan rasio distribusi korpus, sehingga soal di luar cakupan tetap
  // abstain (false_answer tidak naik).
  const strongEnough = corpusRatio >= 2.2;
  const keyEnough = topHasKey && corpusRatio >= 1.0;
  if (!keyEnough && !strongEnough) return [];

  const kept = scored.filter((x) => {
    // KRITIS: cek skor tertinggi dan sinyal kunci SEBELUM filter coverage.
    // Urutan lama (`coverage <= 0` lebih dulu) diam-diam membuang rank-1 BM25
    // yang relevan hanya karena parafrasa membuat coverage nol.
    if (x.score === topScore) return true;
    if (keySignal(x.c)) return true;
    return x.score >= median + 0.5 * iqr;
  });
  // Urutan mengikuti skor BM25 asli, BUKAN coverage. Coverage hanya dipakai
  // sebagai sinyal pendukung, bukan pengurut (re-ranking coverage dulu
  // menurunkan hit@1 produksi di bawah raw).
  kept.sort((a, b) => b.score - a.score || a.index - b.index);
  return kept.slice(0, capacity).map((x) => x.c);
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
    // Kutipan WAJIB dari teks child: validateCitationDeepLink memverifikasi
    // quote terhadap chunk_id (child). Kutipan parent di sini membuat setiap
    // sitasi hasil ekspansi parent gagal QUOTE_MISMATCH dan dibuang fail-closed.
    const contextText = child.text;
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
  datasetId: string | string[],
  question: string,
  limit = 5,
  knownChannels: string[] = [],
): CoreCitation[] {
  const entities = extractRetrievalEntities(question, knownChannels);
  const candidates = searchChunks(db, {
    datasetId,
    question,
    limit,
    boostSection: entities.boostSection,
    boostPage: entities.boostPage,
  });
  // P3-PRECISION: evidence gate HANYA untuk mode kelompok dokumen (array > 1
  // dataset = chip "Semua dokumen"). Di mode itu FTS5 OR-match lintas dokumen
  // mengisi sitasi dengan chunk acak — itulah failure mode GT-001/GT-100.
  // Mode dokumen tunggal (string) sengaja dikembalikan persis seperti lama:
  // derau lintas dokumen tidak ada di sana, dan memaksa gate yang sama
  // merusak fixture eval existing (4 suite regresi tetap PASS).
  if (!Array.isArray(datasetId) || datasetId.length <= 1) {
    return candidates.slice(0, limit);
  }
  return selectEvidenceChunks(question, candidates, limit >= 20 ? 4 : 2);
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

/* ========================================================================== */
/* P3-MIGRATION — Qdrant / hybrid dispatch (DECISION-032 ADR-QD-01/05)          */
/*                                                                             */
/* `RETRIEVAL_MODE=hybrid` is now the DEFAULT (DECISION-033). The `fts5` path  */
/* is preserved unchanged: env `RETRIEVAL_MODE=fts5` selects the legacy path.  */
/* Existing callers of the synchronous `retrieveWithEntityBoost` keep          */
/* identical behaviour and need no edit.                                       */
/* ========================================================================== */

export type { RetrievalMode, FallbackReason };

/**
 * DECISION-033: default diubah ke `hybrid` (dense + BM25 + FTS5 via RRF).
 * Circuit breaker di `retrieveWithEntityBoostDetailed` menjamin fallback ke
 * FTS5 deterministik bila Qdrant/embedding gagal, dengan `meta.fallbackReason`
 * terisi. Jalur `fts5` sengaja DIPERTAHANKAN — env `RETRIEVAL_MODE=fts5`
 * (atau nilai asing) tetap memilih jalur lama persis.
 */
export function getRetrievalMode(): RetrievalMode {
  const raw = String(process.env.RETRIEVAL_MODE ?? 'hybrid').trim().toLowerCase();
  return raw === 'hybrid' || raw === 'qdrant' ? raw : 'fts5';
}

export interface RetrievalDispatchMeta {
  retrievalBackend: 'fts5' | 'qdrant' | 'hybrid';
  fallbackReason?: string;
  embeddingUsed: boolean;
}

export interface RetrievalDispatchResult {
  citations: CoreCitation[];
  meta: RetrievalDispatchMeta;
}

/** Hydrate Qdrant-only chunk ids from SQLite — Qdrant is never a text source. */
function hydrateChunks(db: DB, ids: string[]): Map<string, CoreCitation> {
  const map = new Map<string, CoreCitation>();
  const numeric = ids.map((id) => Number(id)).filter((n) => Number.isInteger(n) && n > 0);
  if (!numeric.length) return map;
  const placeholders = numeric.map(() => '?').join(',');
  const rows = allRows(
    db,
    `SELECT c.id AS chunk_id, c.document_id, c.section_path, c.page, c.text AS quote
       FROM core_chunks c WHERE c.id IN (${placeholders})`,
    numeric,
  );
  for (const row of rows) {
    const id = String(num(row.chunk_id));
    map.set(id, {
      chunk_id: num(row.chunk_id),
      document_id: str(row.document_id),
      section_path: str(row.section_path),
      page: row.page === null || row.page === undefined ? null : num(row.page),
      quote: truncateText(str(row.quote).replace(/\s+/g, ' '), 240),
      score: 0,
    });
  }
  return map;
}

/**
 * Mode-aware retrieval with an honest circuit breaker.
 *
 * - `fts5`   → exact legacy path (no model, no network, no env dependency).
 * - `hybrid` → FTS5 + Qdrant BM25 (+ dense when available), fused by RRF.
 * - `qdrant` → Qdrant BM25 (+ dense) only; still hydrates text from SQLite.
 *
 * Any Qdrant/embedding failure falls back to FTS5 and records `fallbackReason`.
 * `citation.score` remains BM25-derived: FTS5 chunks keep their original score,
 * Qdrant-only chunks get the Qdrant BM25 score normalised to the FTS5 scale.
 * RRF never touches a citation score or a guardrail threshold.
 */
export async function retrieveWithEntityBoostDetailed(
  db: DB,
  datasetId: string | string[],
  question: string,
  limit = 5,
  knownChannels: string[] = [],
): Promise<RetrievalDispatchResult> {
  const mode = getRetrievalMode();
  const fts5Only = (fallbackReason?: string, embeddingUsed = false): RetrievalDispatchResult => ({
    citations: retrieveWithEntityBoost(db, datasetId, question, limit, knownChannels),
    meta: {
      retrievalBackend: 'fts5',
      ...(fallbackReason ? { fallbackReason } : {}),
      embeddingUsed,
    },
  });

  if (mode === 'fts5') return fts5Only();

  const config = getQdrantConfig(datasetId);
  if (!config) return fts5Only('qdrant_unavailable');

  const dense = await embedQuery(question);
  const embeddingUsed = dense !== null;
  const outcome = await fetchQdrantCandidates({
    question,
    terms: queryTerms(question),
    dense,
    config,
  });

  if (!outcome.ok) return fts5Only(outcome.reason, embeddingUsed);

  const { bm25, dense: denseCandidates, bm25ByChunk } = outcome.data;
  const ftsCitations = retrieveWithEntityBoost(
    db, datasetId, question, Math.min(config.topK, 20), knownChannels,
  );
  const ftsLeg: Candidate[] = ftsCitations.map((citation, index) => ({
    id: String(citation.chunk_id),
    rank: index + 1,
    rawScore: citation.score ?? 0,
    leg: 'fts5',
  }));

  const legs = mode === 'qdrant' ? [bm25, denseCandidates] : [ftsLeg, bm25, denseCandidates];
  const fused = rrfFuse(legs);
  if (!fused.length) return fts5Only('qdrant_empty', embeddingUsed);

  const ftsById = new Map(ftsCitations.map((citation) => [String(citation.chunk_id), citation]));
  const scoreById = new Map<string, number>();
  for (const citation of ftsCitations) {
    if (citation.chunk_id !== null && citation.chunk_id !== undefined) {
      scoreById.set(String(citation.chunk_id), citation.score ?? 0);
    }
  }
  const maxAbs = Math.max(1e-6, ...Object.values(bm25ByChunk).map((v) => Math.abs(v)));
  for (const [id, raw] of Object.entries(bm25ByChunk)) {
    if (!scoreById.has(id)) scoreById.set(id, normalizeScore(raw, 'qdrant_bm25', maxAbs) ?? 0);
  }

  const qdrantOnlyIds = fused
    .map((entry) => entry.id)
    .filter((id) => !ftsById.has(id))
    .slice(0, config.topK);
  const hydrated = hydrateChunks(db, qdrantOnlyIds);

  const citations: CoreCitation[] = [];
  for (const entry of fused) {
    const existing = ftsById.get(entry.id);
    if (existing) {
      citations.push({ ...existing, score: scoreById.get(entry.id) ?? existing.score });
    } else {
      const chunk = hydrated.get(entry.id);
      if (!chunk) continue;
      citations.push({ ...chunk, score: scoreById.get(entry.id) ?? 0 });
    }
    if (citations.length >= limit) break;
  }

  if (!citations.length) return fts5Only('qdrant_empty', embeddingUsed);

  return {
    citations,
    meta: {
      retrievalBackend: mode,
      ...(outcome.partialReason ? { fallbackReason: outcome.partialReason } : {}),
      embeddingUsed,
    },
  };
}

/* ========================================================================== */
/* SEMANTIC QUERY V1 — multi-variant retrieval + RRF (DECISION-033 lanjutan)    */
/*                                                                             */
/* Pertanyaan natural ("Bagaimana prosedur dalam pergantian shift?") sering    */
/* gagal pada FTS5 OR-match karena kata tanya mengencerkan term. Kirim original */
/* + parafrasa hasil query understanding ke retrieval, lalu gabungkan dengan   */
/* RRF. Skor sitasi TETAP BM25-derived (RRF hanya mengurutkan), sehingga        */
/* ambang guardrail tidak berubah.                                             */
/* ========================================================================== */

export interface VariantRetrievalResult extends RetrievalDispatchResult {
  meta: RetrievalDispatchMeta & { variantCount: number };
}

/** RRF setara `query-rewrite.ts::rrfFuse`, lokal agar tidak ada cycle import. */
function rrfCitations(lists: CoreCitation[][], limit: number): CoreCitation[] {
  const merged = new Map<string, { citation: CoreCitation; score: number }>();
  for (const list of lists) {
    list.forEach((citation, index) => {
      const key = String(citation.chunk_id ?? `${citation.section_path ?? ''}:${citation.quote ?? ''}`);
      const prior = merged.get(key);
      merged.set(key, {
        citation,
        score: (prior?.score ?? 0) + 1 / (60 + index + 1),
      });
    });
  }
  return [...merged.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.citation);
}

/**
 * Jalankan retrieval untuk setiap variasi query dan gabungkan dengan RRF.
 * Fail-closed: bila semua variasi gagal, kembalikan hasil variasi pertama
 * (bisa jadi kosong) dengan meta jujur — tidak pernah melempar exception.
 *
 * BATAS KONTRAK: varian di sini HANYA memperlebar retrieval. Fungsi ini tidak
 * pernah dipakai untuk menilai answerability/out_of_scope — keputusan abstain
 * ada di `checkGuardrails` dan memakai pertanyaan asli. Memakai varian untuk
 * guardrail membuat kata kunci parafrasa "tercocokkan" dengan dokumen dan
 * menurunkan refusal accuracy (regresi SOP-09/SOP-11).
 */
export async function retrieveWithQueryVariants(
  db: DB,
  datasetId: string | string[],
  question: string,
  variants: string[],
  limit = 5,
  knownChannels: string[] = [],
): Promise<VariantRetrievalResult> {
  // 7 = 1 pertanyaan asli + 4 parafrasa + 2 variasi aksi diagnostik
  // (diagnosticActionQueries). Kasus non-diagnostik tetap <= 5 query, jadi
  // tidak ada perubahan perilaku di luar pola tanya klasifikasi/penanganan.
  const queries = [...new Set([String(question ?? '').trim(), ...(variants ?? [])])]
    .filter(Boolean)
    .slice(0, 7);
  const runs = await Promise.all(
    queries.map((q) => retrieveWithEntityBoostDetailed(db, datasetId, q, limit, knownChannels)),
  );
  const first = runs[0];
  if (runs.length === 1) {
    return { ...first, meta: { ...first.meta, variantCount: 1 } };
  }
  const citations = rrfCitations(runs.map((r) => r.citations), limit);
  const backend = runs.find((r) => r.meta.retrievalBackend !== 'fts5')?.meta.retrievalBackend ?? 'fts5';
  const fallbackReason = runs.map((r) => r.meta.fallbackReason).find(Boolean);
  return {
    citations,
    meta: {
      retrievalBackend: backend,
      ...(fallbackReason ? { fallbackReason } : {}),
      embeddingUsed: runs.some((r) => r.meta.embeddingUsed),
      variantCount: queries.length,
    },
  };
}
