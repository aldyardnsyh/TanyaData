/**
 * Document-type classifier (P3-CORE) — docs/CORE_AI_SPEC.md §3.
 *
 * Weighted deterministic signals: keyword + heading structure + table shape +
 * metadata. Optional LLM hint is accepted but never required. Final scores are
 * normalised by the sum of weights that actually fired, so a document with only
 * one strong signal can still clear the acceptance threshold.
 *
 * No domain-specific intent ids, channel names or codes live here. The keyword
 * sets describe document *genres*, not one business domain.
 *
 * ADAPT-2 / WS-B — extension for `identity` and `sop`:
 *  - The legacy four ids (legal / technical_report / financial / general) keep
 *    their original scoring path **unchanged**. A document already classified
 *    as legal / technical_report / financial is never re-labelled here.
 *  - New ids are resolved only when the legacy pass lands on `general`, and
 *    only with multi-signal evidence (see `detectNewDocType`). A single stray
 *    word such as "NIK" or "prosedur" is not enough.
 *  - `doc_group` is always returned via `docGroupOf(doc_type)` so callers stay
 *    consistent with the single taxonomy registry (`lib/core/doc-taxonomy.ts`).
 */
import type { Block, ClassificationResult, DocType, Signal } from './types';
import { docGroupOf, type DocTypeId } from '@/lib/core/doc-taxonomy';

const BASE_DOC_TYPES: DocType[] = ['legal', 'technical_report', 'financial', 'general'];

/** New ids introduced by ADAPT-2. `sop` is its own id, identity has 7. */
type NewDocTypeId = Extract<
  DocTypeId,
  | 'sop'
  | 'ktp'
  | 'paspor'
  | 'sim'
  | 'kartu_keluarga'
  | 'npwp'
  | 'tagihan_utilitas'
  | 'rekening_koran'
>;

const NEW_DOC_TYPES: NewDocTypeId[] = [
  'sop',
  'ktp',
  'paspor',
  'sim',
  'kartu_keluarga',
  'npwp',
  'tagihan_utilitas',
  'rekening_koran',
];

/** Genre vocabulary. Deliberately generic across domains and bilingual. */
const KEYWORDS: Record<DocType, string[]> = {
  legal: [
    'pasal', 'ayat', 'bab', 'undang-undang', 'undang undang', 'regulasi',
    'peraturan', 'putusan', 'hukum', 'ketentuan', 'pemerintah', 'negara',
    'warga negara', 'dikuasai', 'dipelihara', 'undang', 'ayatnya', 'pasalnya',
  ],
  technical_report: [
    'sumur', 'kedalaman', 'formasi', 'tekanan', 'laju', 'parameter',
    'spesifikasi', 'pemboran', 'drilling', 'laporan teknis', 'satuan',
    'psi', 'bbl', 'logging', 'well', 'laju pemboran', 'kedalaman total',
    'tabel parameter', 'spesifikasi teknis', 'laporan laboratorium',
  ],
  financial: [
    'pendapatan', 'laba', 'neraca', 'arus kas', 'periode', 'mata uang',
    'saldo', 'kuartal', 'revenue', 'profit', 'cash flow', 'aset',
    'liabilitas', 'ekuitas', 'laporan keuangan', 'mata uang', 'idrp',
  ],
  general: [
    'faq', 'sop', 'prosedur', 'catatan', 'panduan', 'umum', 'informasi',
    'tanya jawab', 'petunjuk', 'berlaku sejak', 'versi',
  ],
};

const HEADING_PATTERNS: Record<DocType, RegExp> = {
  legal: /^\s*(pasal\s+\d+|ayat\s*\(?\d+\)?|bab\s+[ivxlcdm\d]+)\b/i,
  technical_report: /^\s*(tabel\s+\d+|parameter|spesifikasi|laporan\s+(teknis|pemboran)|well[\s-]?id)\b/i,
  financial: /^\s*(ringkasan|laporan\s+keuangan|neraca|arus\s+kas|kuartal\s*[1-4])\b/i,
  general: /^\s*(faq|sop|prosedur|catatan|panduan|bagian\s+\d+)\b/i,
};

const UNIT_RE = /\b(m|km|psi|bar|bbl|bbl\/hari|m\/jam|kg|ton|°c|meter)\b/i;
const CURRENCY_RE = /\b(IDR|Rp|USD|\$|EUR)\b/i;
const PERIOD_RE = /\b(Q[1-4]\s*20\d{2}|20\d{2}[-/]\d{1,2}|(Januari|Februari|Maret|April|Mei|Juni|Juli|Agustus|September|Oktober|November|Desember)\s+20\d{2})\b/i;

const METADATA_KEYS: Record<DocType, RegExp> = {
  legal: /^(nomor|no\.?|tahun|jenis|klasifikasi|pemilik|berlaku)/i,
  technical_report: /^(well|well_id|sumur|tanggal_logging|lokasi|depth|kedalaman|operator)/i,
  financial: /^(periode|mata_uang|currency|tahun|kuartal|entity|entitas)/i,
  general: /^(versi|pemilik|berlaku|klasifikasi)/i,
};

/**
 * Signal vocabulary for the new genres. `strong` = a term that almost only
 * appears on that kind of document; `weak` = supporting context. Regexes use
 * word boundaries so short tokens ("nik", "sim", "kk") do not match inside
 * unrelated words ("teknik", "simulasi"). No filenames or document titles are
 * used — only text that the document itself contains.
 */
interface NewTypeRule {
  strong: RegExp[];
  weak: RegExp[];
  /** Metadata keys that support this type (matched per key, not joined). */
  metadata?: RegExp;
  /** Evidence points needed before the legacy `general` label is replaced. */
  minPoints: number;
}

const NEW_TYPE_RULES: Record<NewDocTypeId, NewTypeRule> = {
  sop: {
    strong: [
      /\bsop\b/i,
      /standard\s+operating\s+procedure/i,
      /prosedur\s+operasional/i,
      /instruksi\s+kerja/i,
      /langkah[\s-]?langkah/i,
    ],
    weak: [
      /\bprosedur\b/i,
      /\blangkah\b/i,
      /\btahapan\b/i,
      /\balur\b/i,
      /\bpelaksanaan\b/i,
      /penanggung\s+jawab/i,
    ],
    metadata: /^(sop|prosedur|versi|revisi|berlaku|pemilik)/i,
    minPoints: 3,
  },
  ktp: {
    strong: [
      /\bnik\b/i,
      /kartu\s+tanda\s+penduduk/i,
      /golongan\s+darah/i,
      /status\s+perkawinan/i,
      /tempat\s*\/?\s*tanggal\s+lahir/i,
      /kewarganegaraan/i,
    ],
    weak: [
      /nama\s+lengkap/i,
      /\balamat\b/i,
      /jenis\s+kelamin/i,
      /\bagama\b/i,
    ],
    metadata: /^(nik|nama|alamat|tanggal_lahir|golongan_darah|status_perkawinan)/i,
    minPoints: 4,
  },
  paspor: {
    strong: [
      /\bpaspor\b/i,
      /\bpassport\b/i,
      /nomor\s+paspor/i,
      /kantor\s+imigrasi/i,
      /masa\s+berlaku\s+paspor/i,
    ],
    weak: [
      /tempat\s+lahir/i,
      /tanggal\s+lahir/i,
      /kewarganegaraan/i,
    ],
    metadata: /^(paspor|passport|nomor_paspor|masa_berlaku)/i,
    minPoints: 4,
  },
  sim: {
    strong: [
      /surat\s+izin\s+mengemudi/i,
      /\bsim\b/i,
      /golongan\s+sim/i,
      /masa\s+berlaku\s+sim/i,
    ],
    weak: [
      /\bkendaraan\b/i,
      /golongan\s+darah/i,
      /tempat\s+lahir/i,
    ],
    metadata: /^(sim|golongan_sim|nomor_sim|masa_berlaku)/i,
    minPoints: 4,
  },
  kartu_keluarga: {
    strong: [
      /kartu\s+keluarga/i,
      /nomor\s+kartu\s+keluarga/i,
      /kepala\s+keluarga/i,
      /\bkk\b/i,
    ],
    weak: [
      /\bnik\b/i,
      /status\s+perkawinan/i,
      /hubungan\s+dalam\s+keluarga/i,
      /anggota\s+keluarga/i,
    ],
    metadata: /^(kartu_keluarga|kk|nomor_kk|kepala_keluarga)/i,
    minPoints: 4,
  },
  npwp: {
    strong: [
      /\bnpwp\b/i,
      /nomor\s+pokok\s+wajib\s+pajak/i,
      /wajib\s+pajak/i,
      /npwp\s+badan/i,
    ],
    weak: [
      /\bpajak\b/i,
      /\bterdaftar\b/i,
      /kantor\s+pajak/i,
    ],
    metadata: /^(npwp|nomor_npwp|wajib_pajak)/i,
    minPoints: 4,
  },
  tagihan_utilitas: {
    strong: [
      /tagihan\s+listrik/i,
      /tagihan\s+air/i,
      /tagihan\s+utilitas/i,
      /\bpln\b/i,
      /\bpdam\b/i,
      /\bmeteran\b/i,
    ],
    weak: [
      /\btagihan\b/i,
      /jatuh\s+tempo/i,
      /periode\s+pemakaian/i,
      /jumlah\s+tagihan/i,
      /biaya\s+administrasi/i,
    ],
    metadata: /^(tagihan|periode|jumlah_tagihan|jatuh_tempo|nomor_meter)/i,
    minPoints: 4,
  },
  rekening_koran: {
    strong: [
      /rekening\s+koran/i,
      /mutasi\s+rekening/i,
      /bank\s+statement/i,
      /nomor\s+rekening/i,
      /saldo\s+awal/i,
      /saldo\s+akhir/i,
    ],
    weak: [
      /\bdebit\b/i,
      /\bkredit\b/i,
      /\btransaksi\b/i,
      /\bperiode\b/i,
    ],
    metadata: /^(rekening|nomor_rekening|saldo_awal|saldo_akhir|periode)/i,
    minPoints: 4,
  },
};

export interface ClassifyInput {
  text: string;
  headings?: string[];
  blocks?: Block[];
  tables?: { judul?: string; columns?: string[]; rows?: unknown[][] }[];
  metadata?: Record<string, string>;
  /** Optional, untrusted hint. Clamped to [0,1]; never trusted blindly. */
  llmHint?: { doc_type: DocType; confidence: number } | null;
}

function countHits(text: string, words: string[]): number {
  let hits = 0;
  for (const w of words) {
    if (text.includes(w)) hits += 1;
  }
  return hits;
}

function keywordScores(text: string): Record<DocType, number> {
  const out = {} as Record<DocType, number>;
  for (const t of BASE_DOC_TYPES) {
    const hits = countHits(text, KEYWORDS[t]);
    out[t] = Math.min(1, hits / 4);
  }
  return out;
}

function headingScores(headings: string[]): Record<DocType, number> {
  const out = {} as Record<DocType, number>;
  for (const t of BASE_DOC_TYPES) {
    const hits = headings.filter((h) => HEADING_PATTERNS[t].test(h)).length;
    out[t] = Math.min(1, hits / 2);
  }
  return out;
}

function tableScores(tables: ClassifyInput['tables']): Record<DocType, number> {
  const out = {} as Record<DocType, number>;
  const flat = (tables ?? [])
    .map((t) => [t.judul ?? '', ...(t.columns ?? []), ...(t.rows ?? []).flat().map(String)].join(' '))
    .join(' ');
  out.legal = /pasal|ayat|bab/i.test(flat) ? 0.8 : 0;
  out.technical_report = UNIT_RE.test(flat) ? Math.min(1, (flat.match(UNIT_REg()) ?? []).length / 3) : 0;
  out.financial = CURRENCY_RE.test(flat) && PERIOD_RE.test(flat) ? 0.9 : CURRENCY_RE.test(flat) ? 0.5 : 0;
  out.general = tables && tables.length ? 0.2 : 0;
  return out;
}

/** Global regex helper (avoids lastIndex reuse across calls). */
function UNIT_REg(): RegExp {
  return /\b(m|km|psi|bar|bbl|bbl\/hari|m\/jam|kg|ton)\b/gi;
}

function metadataScores(metadata: Record<string, string>): Record<DocType, number> {
  const out = {} as Record<DocType, number>;
  const keys = Object.keys(metadata ?? {});
  for (const t of BASE_DOC_TYPES) {
    out[t] = Math.min(1, keys.filter((k) => METADATA_KEYS[t].test(k)).length / 2);
  }
  return out;
}

function emptyScores(): Record<DocType, number> {
  return { legal: 0, technical_report: 0, financial: 0, general: 0 };
}

/* ------------------------------------------------- new genres (ADAPT-2) --- */

function distinctHits(text: string, patterns: RegExp[]): number {
  let hits = 0;
  for (const re of patterns) {
    if (re.test(text)) hits += 1;
  }
  return hits;
}

interface NewTypeEvidence {
  doc_type: NewDocTypeId;
  points: number;
  score: number;
  strongHits: number;
  weakHits: number;
  metaHits: number;
}

function newTypeEvidence(
  text: string,
  headings: string[],
  metadataKeys: string[],
): NewTypeEvidence[] {
  const headingText = headings.join(' \n ').toLowerCase();
  const out: NewTypeEvidence[] = [];
  for (const docType of NEW_DOC_TYPES) {
    const rule = NEW_TYPE_RULES[docType];
    const strongHits = distinctHits(text, rule.strong) + distinctHits(headingText, rule.strong);
    const weakHits = distinctHits(text, rule.weak);
    const metaHits = rule.metadata
      ? metadataKeys.filter((key) => rule.metadata!.test(key)).length
      : 0;
    const points = strongHits * 2 + weakHits + metaHits;
    const score = Math.min(1, strongHits * 0.45 + weakHits * 0.15 + metaHits * 0.1);
    out.push({ doc_type: docType, points, score, strongHits, weakHits, metaHits });
  }
  return out;
}

/**
 * Resolve a new genre from the legacy `general` fallback. Returns `null` when
 * evidence is weak, ambiguous (tie), or only one generic word fired. This is
 * what keeps a normal general document from drifting into `identity`/`sop`.
 */
function detectNewDocType(
  text: string,
  headings: string[],
  metadataKeys: string[],
): { doc_type: NewDocTypeId; confidence: number; points: number } | null {
  const ranked = newTypeEvidence(text, headings, metadataKeys)
    .filter((e) => e.strongHits >= 1 && e.points >= NEW_TYPE_RULES[e.doc_type].minPoints)
    .sort((a, b) => (b.points - a.points) || (b.score - a.score));
  if (!ranked.length) return null;
  const best = ranked[0];
  const second = ranked[1];
  // A tie between two identity cards is genuine ambiguity — stay `general`.
  if (second && second.points === best.points) return null;
  const confidence = Math.min(0.95, 0.55 + 0.06 * best.points);
  return { doc_type: best.doc_type, confidence, points: best.points };
}

function newGenreScores(text: string, headings: string[], metadataKeys: string[]): Record<NewDocTypeId, number> {
  const out = {} as Record<NewDocTypeId, number>;
  for (const evidence of newTypeEvidence(text, headings, metadataKeys)) {
    out[evidence.doc_type] = evidence.score;
  }
  return out;
}

/**
 * Classify a document. Fail-closed and honest: ambiguous or weak evidence
 * yields `general` with `needs_confirmation: true`, never a confident guess.
 */
export function classifyDocument(input: ClassifyInput): ClassificationResult {
  const text = (input.text ?? '').toLowerCase();
  const headings = (input.headings ?? (input.blocks ?? [])
    .filter((b) => b.kind === 'heading' || b.kind === 'title')
    .map((b) => b.text)).filter(Boolean);

  const kw = keywordScores(text);
  const hd = headingScores(headings);
  const tb = tableScores(input.tables);
  const md = metadataScores(input.metadata ?? {});

  const hasHint = Boolean(input.llmHint && BASE_DOC_TYPES.includes(input.llmHint.doc_type));

  const scores = emptyScores();
  const signals: Signal[] = [];
  const weights: { source: Signal['source']; weight: number; table: Record<DocType, number> }[] = [
    { source: 'keyword', weight: 0.35, table: kw },
    { source: 'heading', weight: 0.25, table: hd },
    { source: 'table', weight: 0.20, table: tb },
    { source: 'metadata', weight: 0.10, table: md },
  ];

  // Normalise AFTER accumulation by the sum of weights that actually fired.
  // The previous approach scaled every weight by 1/0.9 when no LLM hint was
  // present, which capped a keyword-only document at 0.35/0.9 = 0.389 — below
  // the 0.60 acceptance threshold no matter how strong the keyword signal was.
  let activeWeight = 0;
  for (const { weight, table } of weights) {
    if (BASE_DOC_TYPES.some((t) => table[t] > 0)) activeWeight += weight;
  }
  if (hasHint) activeWeight += 0.10;
  const denominator = activeWeight > 0 ? activeWeight : 1;

  for (const { source, weight, table } of weights) {
    for (const t of BASE_DOC_TYPES) {
      scores[t] += weight * table[t];
      if (table[t] > 0) {
        signals.push({ source, name: t, weight, score: table[t] });
      }
    }
  }

  if (hasHint && input.llmHint) {
    const h = input.llmHint;
    const c = Math.max(0, Math.min(1, h.confidence));
    scores[h.doc_type] += 0.10 * c;
    signals.push({ source: 'llm', name: h.doc_type, weight: 0.10, score: c });
  }

  for (const t of BASE_DOC_TYPES) scores[t] = Math.max(0, Math.min(1, scores[t] / denominator));
  for (const signal of signals) signal.weight = signal.weight / denominator;

  const ranked = [...BASE_DOC_TYPES].sort((a, b) => scores[b] - scores[a]);
  const top = ranked[0];
  const second = ranked[1];
  const confidence = Math.max(0, Math.min(1, scores[top]));
  const margin = confidence - scores[second];
  const accepted = confidence >= 0.60 && margin >= 0.10;

  const baseDocType: DocType = accepted ? top : 'general';
  const baseConfidence = accepted ? confidence : Math.min(confidence, 0.59);

  // ADAPT-2: new genres only refine a `general` outcome. legal /
  // technical_report / financial results are returned untouched — the hard
  // requirement that existing ground-truth classes never change.
  const metadataKeys = Object.keys(input.metadata ?? {});
  const newScores = newGenreScores(text, headings, metadataKeys);
  const mergedScores: Record<DocType, number> = { ...scores, ...newScores };
  for (const docType of NEW_DOC_TYPES) {
    const score = newScores[docType];
    if (score > 0) {
      signals.push({ source: 'keyword', name: docType, weight: 0.35, score });
    }
  }

  if (baseDocType === 'general') {
    const detected = detectNewDocType(text, headings, metadataKeys);
    if (detected) {
      return {
        doc_type: detected.doc_type,
        doc_group: docGroupOf(detected.doc_type),
        confidence: detected.confidence,
        scores: mergedScores,
        signals,
        needs_confirmation: false,
        runner_up: 'general',
        margin: Math.max(0, detected.confidence - baseConfidence),
      };
    }
  }

  return {
    doc_type: baseDocType,
    doc_group: docGroupOf(baseDocType),
    confidence: baseConfidence,
    scores: mergedScores,
    signals,
    needs_confirmation: !accepted,
    runner_up: accepted ? second : top,
    margin,
  };
}
