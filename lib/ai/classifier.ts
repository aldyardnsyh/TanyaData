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
 */
import type { Block, ClassificationResult, DocType, Signal } from './types';

const DOC_TYPES: DocType[] = ['legal', 'technical_report', 'financial', 'general'];

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
  for (const t of DOC_TYPES) {
    const hits = countHits(text, KEYWORDS[t]);
    out[t] = Math.min(1, hits / 4);
  }
  return out;
}

function headingScores(headings: string[]): Record<DocType, number> {
  const out = {} as Record<DocType, number>;
  for (const t of DOC_TYPES) {
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
  for (const t of DOC_TYPES) {
    out[t] = Math.min(1, keys.filter((k) => METADATA_KEYS[t].test(k)).length / 2);
  }
  return out;
}

function emptyScores(): Record<DocType, number> {
  return { legal: 0, technical_report: 0, financial: 0, general: 0 };
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

  const hasHint = Boolean(input.llmHint && DOC_TYPES.includes(input.llmHint.doc_type));

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
    if (DOC_TYPES.some((t) => table[t] > 0)) activeWeight += weight;
  }
  if (hasHint) activeWeight += 0.10;
  const denominator = activeWeight > 0 ? activeWeight : 1;

  for (const { source, weight, table } of weights) {
    for (const t of DOC_TYPES) {
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

  for (const t of DOC_TYPES) scores[t] = Math.max(0, Math.min(1, scores[t] / denominator));
  for (const signal of signals) signal.weight = signal.weight / denominator;

  const ranked = [...DOC_TYPES].sort((a, b) => scores[b] - scores[a]);
  const top = ranked[0];
  const second = ranked[1];
  const confidence = Math.max(0, Math.min(1, scores[top]));
  const margin = confidence - scores[second];
  const accepted = confidence >= 0.60 && margin >= 0.10;

  return {
    doc_type: accepted ? top : 'general',
    confidence: accepted ? confidence : Math.min(confidence, 0.59),
    scores,
    signals,
    needs_confirmation: !accepted,
    runner_up: accepted ? second : top,
    margin,
  };
}
