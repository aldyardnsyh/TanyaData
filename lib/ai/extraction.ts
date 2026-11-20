/**
 * Extraction profiles per document type (P3-CORE) — docs/CORE_AI_SPEC.md §3.3.
 *
 * Regex-first by design: structured genres (pasal/ayat, parameter+unit,
 * metrik+periode) follow repeating patterns, so deterministic parsing handles
 * the bulk and flags low-confidence fields instead of guessing. An optional
 * LLM validator may be layered on later by the caller; extraction itself never
 * calls a model and never invents a missing unit, currency or period.
 */
import type {
  Block, DocType, ExtractedField, ExtractionResult, ExtractedTable, Pasal,
} from './types';

const NUM = '-?\\d[\\d.,]*';

/** "2.850" (id thousand) -> 2850; "12,5" (id decimal) -> 12.5. */
export function parseNumber(raw: string): number {
  let s = raw.trim();
  if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, '');
  } else if (s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

function linesOf(blocks: Block[]): { text: string; page?: number }[] {
  const out: { text: string; page?: number }[] = [];
  for (const b of blocks ?? []) {
    for (const line of String(b.text ?? '').split(/\r?\n/)) {
      const t = line.trim();
      if (t) out.push({ text: t, page: b.page });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ legal */

const PASAL_RE = /^pasal\s+(\d+)\s*[:.\-]?\s*(.*)$/i;
const AYAT_RE = /^ayat\s*\(?(\d+)\)?\s*[:.\-]?\s*(.*)$/i;
const BAB_RE = /^bab\s+([ivxlcdm\d]+)\s*[:.\-]?\s*(.*)$/i;

function extractLegal(blocks: Block[]): Pick<
  ExtractionResult, 'bab' | 'pasal' | 'referensi'
> {
  const bab: ExtractionResult['bab'] = [];
  const pasal: Pasal[] = [];
  const referensi: string[] = [];
  let current: Pasal | null = null;
  let currentAyat: number | null = null;

  const flushAyat = () => { currentAyat = null; };
  const flushPasal = () => {
    if (current) pasal.push(current);
    current = null;
    flushAyat();
  };

  for (const { text, page } of linesOf(blocks)) {
    const b = text.match(BAB_RE);
    if (b) {
      flushPasal();
      bab.push({ no: b[1].toUpperCase(), judul: b[2].trim() });
      continue;
    }
    const p = text.match(PASAL_RE);
    if (p) {
      flushPasal();
      current = { no: p[1], judul: p[2].trim() || undefined, ayat: [], page };
      continue;
    }
    const a = text.match(AYAT_RE);
    if (a && current) {
      currentAyat = Number(a[1]);
      current.ayat.push({ no: currentAyat, teks: a[2].trim(), page });
      continue;
    }
    if (current) {
      if (currentAyat !== null && current.ayat.length) {
        const last = current.ayat[current.ayat.length - 1];
        last.teks = `${last.teks} ${text}`.trim();
      } else if (!current.judul && text.length < 80) {
        current.judul = text;
      }
    }
    if (/undang-undang|undang undang|regulasi|peraturan|putusan/i.test(text)) {
      referensi.push(text.slice(0, 200));
    }
  }
  flushPasal();
  return { bab, pasal, referensi };
}

/** Resolve which pasal discusses a topic keyword (e.g. "pendidikan"). */
export function findPasalByKeyword(result: ExtractionResult, keyword: string): Pasal | null {
  const k = keyword.toLowerCase();
  for (const p of result.pasal) {
    const hay = [p.judul ?? '', ...p.ayat.map((a) => a.teks)].join(' ').toLowerCase();
    if (hay.includes(k)) return p;
  }
  return null;
}

/* -------------------------------------------------------- technical_report */

const PARAM_LINE_RE = new RegExp(
  `^([A-Za-z][A-Za-z0-9\\s/&()\\-]{2,40}?)\\s*[:=]?\\s+(${NUM})\\s*([a-zA-Z][a-zA-Z0-9/°]*)?\\s*$`,
);

function extractTechnical(blocks: Block[]): Pick<
  ExtractionResult, 'parameter' | 'tables' | 'narasi' | 'tanggal'
> {
  const parameter: ExtractedField[] = [];
  const narasi: string[] = [];
  const tanggal: string[] = [];
  const tables: ExtractedTable[] = [];

  for (const b of blocks ?? []) {
    if (b.table && typeof b.table === 'object') {
      const t = b.table as { judul?: string; columns?: string[]; rows?: unknown[][] };
      tables.push({
        judul: t.judul ?? 'Tabel',
        columns: t.columns ?? [],
        rows: t.rows ?? [],
        page: b.page,
      });
    }
    for (const { text, page } of linesOf([b])) {
      const m = text.match(PARAM_LINE_RE);
      if (m) {
        const value = parseNumber(m[2]);
        const unit = m[3]?.trim() || null;
        parameter.push({
          name: m[1].trim().replace(/\s+/g, ' '),
          value: Number.isFinite(value) ? value : m[2],
          unit,
          page,
          incomplete: !unit || !Number.isFinite(value),
          raw: text,
        });
        continue;
      }
      if (/\d{4}-\d{2}-\d{2}|\d{1,2}\s+(Januari|Februari|Maret|April|Mei|Juni|Juli|Agustus|September|Oktober|November|Desember)\s+20\d{2}/i.test(text)) {
        tanggal.push(text.slice(0, 160));
      }
      if (text.length > 40) narasi.push(text.slice(0, 400));
    }
  }
  return { parameter, tables, narasi, tanggal };
}

/* ---------------------------------------------------------------- financial */

const METRIC_LINE_RE = new RegExp(
  `^([A-Za-z][A-Za-z0-9\\s/&()\\-]{2,40}?)\\s*[:=]?\\s+(${NUM})\\s*(IDR|Rp|USD|\\$|EUR)?\\s*(Q[1-4]\\s*20\\d{2}|20\\d{2}[-/]\\d{1,2})?\\s*$`,
  'i',
);

function extractFinancial(blocks: Block[]): Pick<
  ExtractionResult, 'metrik' | 'tables' | 'catatan' | 'tanggal'
> {
  const metrik: ExtractedField[] = [];
  const catatan: string[] = [];
  const tanggal: string[] = [];
  const tables: ExtractedTable[] = [];

  for (const b of blocks ?? []) {
    if (b.table && typeof b.table === 'object') {
      const t = b.table as { judul?: string; columns?: string[]; rows?: unknown[][] };
      tables.push({
        judul: t.judul ?? 'Tabel',
        columns: t.columns ?? [],
        rows: t.rows ?? [],
        page: b.page,
      });
    }
    // A document title such as "Laporan Keuangan Ringkas Q3 2026" also matches
    // the metric shape (name + trailing year). Headings are structure, not
    // measurements, so they must never become metrik fields.
    if (b.kind === 'heading' || b.kind === 'title') continue;
    for (const { text, page } of linesOf([b])) {
      const m = text.match(METRIC_LINE_RE);
      if (m) {
        const value = parseNumber(m[2]);
        const currency = m[3]?.trim() || null;
        const period = m[4]?.trim() || null;
        metrik.push({
          name: m[1].trim().replace(/\s+/g, ' '),
          value: Number.isFinite(value) ? value : m[2],
          currency,
          period,
          page,
          incomplete: !currency || !period || !Number.isFinite(value),
          raw: text,
        });
        continue;
      }
      if (/catatan|keterangan|dalam|juta|miliar/i.test(text)) catatan.push(text.slice(0, 300));
      if (/\b20\d{2}\b/.test(text)) tanggal.push(text.slice(0, 160));
    }
  }
  return { metrik, tables, catatan, tanggal };
}

/* ------------------------------------------------------------------ general */

function extractGeneral(blocks: Block[]): Pick<ExtractionResult, 'section' | 'tables'> {
  const section: ExtractionResult['section'] = [];
  const tables: ExtractedTable[] = [];
  let current: { judul: string; teks: string; page?: number } | null = null;

  for (const b of blocks ?? []) {
    if (b.table && typeof b.table === 'object') {
      const t = b.table as { judul?: string; columns?: string[]; rows?: unknown[][] };
      tables.push({ judul: t.judul ?? 'Tabel', columns: t.columns ?? [], rows: t.rows ?? [], page: b.page });
    }
    if (b.kind === 'heading' || b.kind === 'title') {
      if (current) section.push(current);
      current = { judul: b.text.trim(), teks: '', page: b.page };
    } else if (current) {
      current.teks = `${current.teks} ${b.text.trim()}`.trim();
    } else {
      section.push({ judul: 'Umum', teks: b.text.trim().slice(0, 500), page: b.page });
    }
  }
  if (current) section.push(current);
  return { section, tables };
}

/* -------------------------------------------------------------------- main */

export function emptyExtraction(docType: DocType): ExtractionResult {
  return {
    doc_type: docType,
    bab: [], pasal: [], parameter: [], metrik: [], catatan: [], section: [], tables: [],
    referensi: [], narasi: [], tanggal: [], warnings: [],
  };
}

/**
 * Extract fields using the profile for `docType`. Unknown/weak fields are
 * marked `incomplete` rather than coerced to zero — see spec §3.3 hard rule.
 */
export function extractFields(docType: DocType, blocks: Block[]): ExtractionResult {
  const base = emptyExtraction(docType);
  const warnings: string[] = [];

  if (docType === 'legal') {
    const r = extractLegal(blocks);
    if (!r.pasal.length) warnings.push('no_pasal_detected');
    return { ...base, ...r, warnings };
  }
  if (docType === 'technical_report') {
    const r = extractTechnical(blocks);
    const missing = r.parameter.filter((p) => p.incomplete).length;
    if (missing) warnings.push(`incomplete_parameter_fields:${missing}`);
    return { ...base, ...r, warnings };
  }
  if (docType === 'financial') {
    const r = extractFinancial(blocks);
    const missing = r.metrik.filter((m) => m.incomplete).length;
    if (missing) warnings.push(`incomplete_metric_fields:${missing}`);
    return { ...base, ...r, warnings };
  }
  const r = extractGeneral(blocks);
  return { ...base, ...r, warnings };
}

/** Canonical `value|unit|currency|period` form used by the eval grader. */
export function fieldSignature(f: ExtractedField): string {
  return [f.value ?? '', f.unit ?? '', f.currency ?? '', f.period ?? ''].join('|');
}
