/**
 * CORE ingest pipeline — tahap 1..9 (CORE_ARCHITECTURE §4).
 * Dataset-agnostik: tidak ada format domain, kolom, atau status transaksi.
 * OCR sengaja opsional dan tidak dipaksa (ADR-C04).
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { getDocumentProxy } from 'unpdf';
import mammoth from 'mammoth';
import type { DB } from '@/lib/db/client';
import { UPLOADS_DIR } from '@/lib/db/paths';
import { nowJakartaIso } from '@/lib/date';
import { AppError, unprocessable, validationError } from '@/lib/errors';
import type {
  Chunk,
  Dataset,
  DocType,
  DocumentSection,
  QualityReport,
  OcrPageStatus,
  SchemaJson,
  SchemaTable,
  SourceType,
} from '@/lib/core/contracts';
import { emptyQualityReport, recordStep } from '@/lib/core/registry';
import { docGroupOf } from '@/lib/core/doc-taxonomy';
import { invalidateQueryCache } from '@/lib/core/cache';
import { normalizeForFts } from '@/lib/core/store';
import { drainOutbox, enqueueUpserts } from '@/lib/qdrant/sync';
import { chunkDocument, matchGenericHeading, type ChunkDocumentResult } from '@/lib/ingest/chunker';
import { layoutAwarePdfTexts } from '@/lib/ingest/extract';
import type { LayoutInfo } from '@/lib/ingest/types';
import { LOW_TEXT_THRESHOLD, UNREADABLE_PAGE_TEXT, ocrPage, type OcrStatus } from '@/lib/ingest/ocr';
import { detectPages, type PageLabel } from '@/lib/ingest/scan-detect';
import { buildDocumentVocabulary, repairMojibake } from '@/lib/ingest/mojibake';
import { sampleRss } from '@/lib/ingest/watchdog';
import {
  buildSchemaJson,
  detectPeriod,
  parseCsv,
  parseSqlite,
  parseXlsx,
  physicalTableName,
  profileColumns,
  quoteIdent,
  safeIdentifier,
  type RawTable,
} from '@/lib/core/schema';

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

const EXT_TO_SOURCE: Record<string, SourceType> = {
  csv: 'csv',
  xlsx: 'xlsx',
  sqlite: 'sqlite',
  db: 'sqlite',
  pdf: 'pdf',
  docx: 'docx',
  txt: 'txt',
  md: 'md',
};

const TABULAR = new Set<SourceType>(['csv', 'xlsx', 'sqlite']);

/* ------------------------------------------------------------ stage 1: upload */

export type ValidatedUpload = {
  format: SourceType;
  originalName: string;
  safeName: string;
  sha256: string;
  buffer: Buffer;
};

export function validateUpload(input: {
  filename: string;
  mime: string;
  size: number;
  buffer: Buffer;
}): ValidatedUpload {
  const raw = String(input.filename ?? '');
  if (!raw || raw.includes('/') || raw.includes('\\') || raw.includes('..') || raw.includes('\0')) {
    throw validationError('Nama file tidak valid (path traversal dicegah)');
  }
  const ext = raw.toLowerCase().split('.').pop() ?? '';
  const format = EXT_TO_SOURCE[ext];
  if (!format) {
    throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', `Format .${ext || '?'} tidak didukung`, {
      allowed: Object.keys(EXT_TO_SOURCE),
    });
  }
  if (input.size > MAX_UPLOAD_BYTES) {
    throw new AppError(413, 'FILE_TOO_LARGE', 'Ukuran file melebihi 25 MB', { maxBytes: MAX_UPLOAD_BYTES });
  }
  if (input.size === 0 || input.buffer.length === 0) throw validationError('File kosong');

  const head = input.buffer.subarray(0, 16);
  if (format === 'pdf' && head.subarray(0, 5).toString('latin1') !== '%PDF-') {
    throw unprocessable('PDF tidak valid (magic bytes tidak cocok)', { reason: 'MIME_MISMATCH' });
  }
  if ((format === 'xlsx' || format === 'docx') && head.subarray(0, 4).toString('latin1') !== 'PK\u0003\u0004') {
    throw unprocessable(`File .${ext} bukan arsip ZIP yang valid`, { reason: 'MIME_MISMATCH' });
  }
  if (format === 'sqlite' && head.subarray(0, 14).toString('latin1') !== 'SQLite format 3\u0000') {
    throw unprocessable('File bukan database SQLite yang valid', { reason: 'MIME_MISMATCH' });
  }
  if ((format === 'csv' || format === 'txt' || format === 'md') && input.buffer.subarray(0, 512).includes(0)) {
    throw unprocessable('File teks mengandung byte biner', { reason: 'MIME_MISMATCH' });
  }

  return {
    format,
    originalName: raw,
    safeName: raw.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'upload',
    sha256: createHash('sha256').update(input.buffer).digest('hex'),
    buffer: input.buffer,
  };
}

/* --------------------------------------------------------- stage 2: classify */

export type Classification = {
  kind: Dataset['kind'];
  doc_type: DocType;
  confidence: number;
  signals: string[];
};

const DOC_SIGNALS: Record<Exclude<DocType, 'general' | 'unknown'>, RegExp[]> = {
  legal: [/pasal\b/i, /ayat\b/i, /bab\s+[ivxlcdm\d]+/i, /undang-undang/i, /peraturan/i, /regulasi/i],
  technical_report: [/formasi/i, /kedalaman/i, /sumur/i, /tekanan/i, /laju\s+pemboran/i, /parameter/i, /spesifikasi/i],
  financial: [/pendapatan/i, /laba/i, /neraca/i, /arus\s+kas/i, /kuartal/i, /mata\s+uang/i, /saldo/i],
};

export function classifySource(input: {
  format: SourceType;
  name: string;
  sampleText: string;
  hasHeader: boolean;
}): Classification {
  if (TABULAR.has(input.format)) {
    return { kind: 'tabular', doc_type: 'general', confidence: 0.9, signals: ['tabular-format'] };
  }
  const text = input.sampleText.slice(0, 20_000);
  const scores: Array<{ type: Exclude<DocType, 'general' | 'unknown'>; score: number; hits: string[] }> = [];
  for (const [type, patterns] of Object.entries(DOC_SIGNALS) as Array<
    [Exclude<DocType, 'general' | 'unknown'>, RegExp[]]
  >) {
    const hits = patterns.filter((re) => re.test(text)).map((re) => re.source);
    const keyword = Math.min(1, hits.length / 3);
    const structure =
      type === 'legal' && /pasal\s+\d+/i.test(text)
        ? 1
        : type === 'technical_report' && /tabel\s+\d+/i.test(text)
          ? 1
          : type === 'financial' && /\d{1,3}([.,]\d{3})+/.test(text)
            ? 1
            : 0;
    scores.push({ type, score: 0.5 * keyword + 0.3 * structure, hits });
  }
  scores.sort((a, b) => b.score - a.score);
  const best = scores[0];
  const second = scores[1];
  if (!best || best.score < 0.6 || (second && best.score - second.score < 0.1)) {
    return {
      kind: 'document',
      doc_type: best && best.score >= 0.4 ? best.type : 'general',
      confidence: best?.score ?? 0,
      signals: best?.hits ?? [],
    };
  }
  return { kind: 'document', doc_type: best.type, confidence: best.score, signals: best.hits };
}

/* ------------------------------------------------------------ stage 3: parse */

type ParsedPage = {
  page: number;
  text: string;
  unreadable?: boolean;
  ocrStatus?: OcrStatus;
  ocrConfidence?: number;
  ocrLatencyMs?: number;
  label?: PageLabel;
  readingOrder?: string[];
  layout?: LayoutInfo;
};

export type ExtractOutcome = {
  pages: ParsedPage[];
  ocrUsed: boolean;
  ocrPages: number[];
  ocrStatuses: OcrPageStatus[];
  pageLabels: Array<{ page: number; label: string; needsOcr: boolean }>;
  peakRssBytes: number;
};

/**
 * Ekstraksi teks dengan OCR on-demand (ADR-11). Text layer didahulukan; OCR
 * hanya untuk halaman yang terdeteksi butuh, dipanggil BERURUTAN (konkurensi 1).
 * Watchdog RSS dicek tiap halaman; bila lewat 1,2 GB ingest dibatalkan.
 */
async function extractPages(format: SourceType, buffer: Buffer, docId: string): Promise<ExtractOutcome> {
  const base: ExtractOutcome = {
    pages: [],
    ocrUsed: false,
    ocrPages: [],
    ocrStatuses: [],
    pageLabels: [],
    peakRssBytes: 0,
  };
  const trackRss = () => {
    base.peakRssBytes = Math.max(base.peakRssBytes, sampleRss().rssBytes);
  };

  if (format === 'pdf') {
    let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
    try {
      pdf = await getDocumentProxy(new Uint8Array(buffer));
    } catch {
      throw unprocessable('PDF tidak dapat dibaca (rusak atau terenkripsi)', { reason: 'PARSE_ERROR' });
    }
    // Fase 2A: urutan baca sadar layout (kolom kiri → kanan), header/footer
    // berulang dan nomor halaman dibuang. Sama dengan jalur workspace.
    const pagesItems: unknown[][] = [];
    for (let i = 1; i <= pdf.numPages; i += 1) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      pagesItems.push(content.items);
    }
    const layouts = layoutAwarePdfTexts(pagesItems);
    const texts = layouts.map((layout) => layout.text);

    const signals = await detectPages(pdf, texts);
    base.pageLabels = signals.map((s) => ({ page: s.page, label: s.label, needsOcr: s.needsOcr }));

    for (let i = 0; i < texts.length; i += 1) {
      trackRss();
      const signal = signals[i];
      const pageNo = i + 1;
      // Pemicu OCR: sinyal deteksi ATAU fallback char-count lama (< 40).
      const needsOcr = signal?.needsOcr || texts[i].replace(/\s/g, '').length < LOW_TEXT_THRESHOLD;
      if (!needsOcr) {
        base.pages.push({
          page: pageNo,
          text: texts[i],
          label: signal?.label,
          readingOrder: layouts[i].readingOrder,
          layout: layouts[i].layout,
        });
        continue;
      }
      base.ocrUsed = true;
      base.ocrPages.push(pageNo);
      const outcome = await ocrPage({ page: pageNo, docId, pdf });
      trackRss();
      base.ocrStatuses.push({
        page: pageNo,
        status: outcome.status,
        confidence: outcome.confidence,
        latencyMs: outcome.latencyMs,
        ...(outcome.reason ? { reason: outcome.reason } : {}),
        ...(outcome.width ? { width: outcome.width, height: outcome.height } : {}),
      });
      if (outcome.skipped) {
        base.pages.push({
          page: pageNo,
          text: UNREADABLE_PAGE_TEXT,
          unreadable: true,
          ocrStatus: 'ocr_skipped',
          ocrConfidence: outcome.confidence,
          ocrLatencyMs: outcome.latencyMs,
          label: signal?.label,
          readingOrder: [],
          layout: layouts[i].layout,
        });
      } else {
        base.pages.push({
          page: pageNo,
          text: outcome.text,
          ocrStatus: outcome.status,
          ocrConfidence: outcome.confidence,
          ocrLatencyMs: outcome.latencyMs,
          label: signal?.label,
          readingOrder: outcome.text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
          // Metadata kolom dari service OCR bila tersedia (halaman image-only
          // tidak punya analisis text-layer); fallback ke analisis halaman.
          layout: (outcome.columns ?? 1) === 2
            ? {
                columns: 2,
                columnSplitX: outcome.columnSplitX ?? null,
                readingOrder: 'column',
                repeatedLines: [],
                pageNumber: null,
                tables: 0,
              }
            : layouts[i].layout,
        });
      }
    }
    return base;
  }
  if (format === 'docx') {
    try {
      const result = await mammoth.extractRawText({ buffer });
      return { ...base, pages: [{ page: 1, text: result.value }] };
    } catch {
      throw unprocessable('DOCX tidak dapat dibaca', { reason: 'PARSE_ERROR' });
    }
  }
  return { ...base, pages: [{ page: 1, text: buffer.toString('utf8') }] };
}

const HEADING_PATTERNS: Array<{ re: RegExp; kind: string }> = [
  { re: /^(pasal)\s+(\d+[a-z]?)\s*[.:-]?\s*(.*)$/i, kind: 'pasal' },
  { re: /^(ayat)\s*\(?(\d+)\)?\s*[.:-]?\s*(.*)$/i, kind: 'ayat' },
  { re: /^(bab)\s+([ivxlcdm\d]+)\s*[.:-]?\s*(.*)$/i, kind: 'bab' },
  { re: /^(tabel)\s+(\d+)\s*[.:-]?\s*(.*)$/i, kind: 'tabel' },
  { re: /^#{1,6}\s+(.+)$/, kind: 'markdown' },
  { re: /^(\d{1,2})[.)]\s+(.+)$/, kind: 'numbered' },
];

/**
 * Heading yang menempel di tengah baris. Text layer PDF sering menggabungkan
 * banyak item tanpa pemisah ("...PENGELOLAAN Pasal 4 ayat (1)..."), sehingga
 * regex ber-anchor awal melewatkan batas pasal. Pola ini hanya dipakai bila
 * baris pendek dan heading muncul dekat awal baris.
 */
const INLINE_HEADING_PATTERNS: Array<{ re: RegExp; kind: string }> = [
  { re: /\b(pasal)\s+(\d+[a-z]?)\b/i, kind: 'pasal' },
  { re: /\b(bab)\s+([ivxlcdm]+|\d+)\b/i, kind: 'bab' },
  { re: /\b(ayat)\s*\((\d+)\)/i, kind: 'ayat' },
];

type HeadingHit = {
  kind: string;
  index: number;
  title: string;
  rest: string;
  code: string | null;
  match: RegExpExecArray;
};

/**
 * Satu detektor heading generik dipakai core DAN workspace (chunker.ts).
 * Pola lama tetap sebagai fallback untuk `Ayat (n)` di tengah baris, yang
 * tidak tercakup aturan generik. Tidak ada regex khusus KB0x/P1/SEV.
 */
function headingFromLine(line: string): HeadingHit | null {
  const generic = matchGenericHeading(line);
  if (generic) {
    const code = generic.code ?? '';
    const title = generic.title;
    const rest = generic.rest ?? '';
    const match = Object.assign([line, code, title, rest], { index: 0 }) as unknown as RegExpExecArray;
    return {
      kind: generic.kind ?? 'generic',
      index: 0,
      title,
      rest,
      code: code || null,
      match,
    };
  }
  for (const { re, kind } of HEADING_PATTERNS) {
    const match = re.exec(line);
    if (!match) continue;
    const title = kind === 'pasal' ? `Pasal ${match[2]}`
      : kind === 'ayat' ? `Ayat (${match[2]})`
        : kind === 'bab' ? `BAB ${match[2]}`
          : kind === 'tabel' ? `Tabel ${match[2]}`
            : (match[2] ?? match[1] ?? line);
    const rest = (match[3] ?? line.slice(match[0].length)).trim();
    return { kind, index: 0, title, rest, code: match[2] ?? null, match };
  }
  if (line.length > 160) return null;
  for (const { re, kind } of INLINE_HEADING_PATTERNS) {
    const match = re.exec(line);
    if (!match || match.index > 60) continue;
    const title = kind === 'pasal' ? `Pasal ${match[2]}`
      : kind === 'bab' ? `BAB ${match[2]}`
        : `Ayat (${match[2]})`;
    const rest = line.slice(match.index + match[0].length).trim();
    return { kind, index: match.index, title, rest, code: match[2] ?? null, match };
  }
  return null;
}

export type ParsedSection = DocumentSection & {
  text: string;
  ocrStatus?: OcrStatus;
  ocrConfidence?: number;
  unreadable?: boolean;
  pageSpan?: [number, number];
  cleanFlags?: string[];
  readingOrder?: string[];
  layout?: LayoutInfo | null;
  legalChildren?: Array<{
    id: string;
    type: 'ayat' | 'butir';
    text: string;
    page: number;
    ayat: number | null;
    butir: string | null;
  }>;
};

/** Struktur dokumen generik → sections dengan section_path hierarkis. */
export function sectionsFromPages(pages: ParsedPage[], title: string): ParsedSection[] {
  const sections: ParsedSection[] = [];
  let currentPath = title || 'Dokumen';
  let currentPage = pages[0]?.page ?? 1;
  let currentOcr: OcrStatus | undefined;
  let currentConfidence: number | undefined;
  let currentUnreadable = false;
  let currentReadingOrder: string[] | undefined;
  let currentLayout: LayoutInfo | null | undefined;
  let buffer: string[] = [];

  const flush = () => {
    const text = buffer.join('\n').replace(/[ \t]+/g, ' ').trim();
    if (text) {
      sections.push({
        section_path: currentPath,
        page: currentPage,
        char_count: text.length,
        text,
        ...(currentOcr ? { ocrStatus: currentOcr } : {}),
        ...(currentConfidence !== undefined ? { ocrConfidence: currentConfidence } : {}),
        ...(currentUnreadable ? { unreadable: true } : {}),
        pageSpan: [currentPage, currentPage],
        readingOrder: currentReadingOrder,
        layout: currentLayout,
      });
    }
    buffer = [];
  };

  for (const page of pages) {
    currentOcr = page.ocrStatus;
    currentConfidence = page.ocrConfidence;
    currentUnreadable = page.unreadable === true;
    currentReadingOrder = page.readingOrder;
    currentLayout = page.layout;
    for (const rawLine of page.text.split(/\r?\n/)) {
      const line = rawLine.replace(/[ \t]+/g, ' ').trim();
      if (!line) continue;
      const hit = headingFromLine(line);
      if (!hit) {
        buffer.push(line);
        continue;
      }
      const { kind, index, title, rest, code } = hit;
      const prefix = index > 0 ? line.slice(0, index).trim() : '';
      if (prefix) buffer.push(prefix);
      flush();
      currentPage = page.page;
      currentPath = kind === 'ayat' ? `${currentPath}/${code ?? title}` : (title || code || line);
      // Isi yang menempel di baris heading (CUTI#1 Tujuan: ..., 2.1.1. Verifikasi: ...)
      // harus masuk ke bagian baru — jangan dibuang seperti heading lama.
      if (rest) buffer.push(rest);
    }
  }
  flush();
  return sections;
}

const PASAL_HEADING_RE = /^Pasal\s+(\d+[a-z]?)\s*[.:]?\s*$/i;
const BAB_HEADING_RE = /^BAB\s*([IVX\d]+)\s*[.:]?\s*$/i;
const BAGIAN_HEADING_RE = /^Bagi\.?an\s+\w+\s*$/i;
const PAGE_FOOTER_RE = /^(?:PRESIDEN|PRE\s?SI\s?OEN|F>RESIDEN|PRESIOEN|REPUBLIK\s+(?:INDONESIA|INOONESIA)|REF>?UBL[I%]K|REPUBLlf:<)(?!\s*,)/;

type LegalDraft = {
  path: string;
  lines: Array<{ text: string; page: number }>;
  page: number;
  lastPage: number;
  ocrStatus?: OcrStatus;
  ocrConfidence?: number;
  unreadable?: boolean;
  readingOrder?: string[];
  layout?: LayoutInfo | null;
};

function legalChildrenFromLines(
  path: string,
  lines: Array<{ text: string; page: number }>,
): NonNullable<ParsedSection['legalChildren']> {
  const match = /^Pasal\s+(\d+)/i.exec(path);
  const pasal = match ? Number(match[1]) : null;
  if (pasal === null) return [];
  const children: NonNullable<ParsedSection['legalChildren']> = [];
  const intro: Array<{ text: string; page: number }> = [];
  let current: NonNullable<ParsedSection['legalChildren']>[number] | null = null;
  for (const line of lines) {
    const ayat = /^\s*(?:[lLI]\s+)?[^\p{L}\p{N}]*\(\s*(\d+)\s*\)\s*(.*)$/u.exec(line.text);
    const butir = /^(\d+|[a-z])\.\s+(.*)$/.exec(line.text);
    if (ayat) {
      current = {
        id: `pasal-${pasal}-a${ayat[1]}`,
        type: 'ayat',
        text: line.text,
        page: line.page,
        ayat: Number(ayat[1]),
        butir: null,
      };
      children.push(current);
      continue;
    }
    if (butir) {
      const label = butir[1] === 'l' && !children.some((c) => c.butir === '1') ? '1' : butir[1];
      current = {
        id: `pasal-${pasal}-b-${label}`,
        type: 'butir',
        text: line.text.replace(/^l\./, '1.'),
        page: line.page,
        ayat: null,
        butir: label,
      };
      children.push(current);
      continue;
    }
    if (current) current.text = `${current.text} ${line.text}`.trim();
    else intro.push(line);
  }
  if (intro.length && children.length) {
    children.unshift({
      id: `pasal-${pasal}-b-pengantar`,
      type: 'butir',
      text: intro.map((l) => l.text).join(' '),
      page: intro[0].page,
      ayat: null,
      butir: 'pengantar',
    });
  }
  return children;
}

/**
 * Sectioning khusus dokumen hukum Indonesia: hanya heading Pasal yang
 * berdiri sendiri yang memulai bagian. Ayat "(n)" dan butir "n."/"a." tetap
 * menjadi isi pasal; pemecahan child dilakukan oleh `chunkDocument`.
 */
export function legalSectionsFromPages(pages: ParsedPage[], title: string): ParsedSection[] {
  const sections: ParsedSection[] = [];
  const firstPage = pages[0]?.page ?? 1;
  let draft: LegalDraft = { path: 'pembukaan', lines: [], page: firstPage, lastPage: firstPage };

  const flush = () => {
    const text = draft.lines.map((l) => l.text).join('\n').replace(/[ \t]+/g, ' ').trim();
    if (!text) return;
    const children = legalChildrenFromLines(draft.path, draft.lines);
    sections.push({
      section_path: draft.path,
      page: draft.page,
      char_count: text.length,
      text,
      pageSpan: [draft.page, draft.lastPage],
      ...(children.length ? { legalChildren: children } : {}),
      ...(draft.ocrStatus ? { ocrStatus: draft.ocrStatus } : {}),
      ...(draft.ocrConfidence !== undefined ? { ocrConfidence: draft.ocrConfidence } : {}),
      ...(draft.unreadable ? { unreadable: true } : {}),
      readingOrder: draft.readingOrder,
      layout: draft.layout,
    });
  };

  const start = (path: string, page: number, current: ParsedPage) => {
    flush();
    draft = {
      path,
      lines: [],
      page,
      lastPage: page,
      ocrStatus: current.ocrStatus,
      ocrConfidence: current.ocrConfidence,
      unreadable: current.unreadable,
      readingOrder: current.readingOrder,
      layout: current.layout,
    };
  };

  for (const page of pages) {
    for (const raw of page.text.split(/\r?\n/)) {
      const line = raw.replace(/[ \t]+/g, ' ').trim();
      if (!line) continue;
      const pasal = PASAL_HEADING_RE.exec(line);
      if (pasal) {
        start(`Pasal ${pasal[1]}`, page.page, page);
        continue;
      }
      if (BAB_HEADING_RE.test(line) || BAGIAN_HEADING_RE.test(line)) continue;
      if (/^Agar\s+setiap\s+orang\s+mengetahui\b/i.test(line)) {
        start('penutup', page.page, page);
      }
      if (/^\d+[.,]?\s*$/.test(line) || /^[lLI]\s*[.;]?\s*$/.test(line)
        || /^[\\/]\s*\d+\s*-\s*$/.test(line) || PAGE_FOOTER_RE.test(line)) continue;
      const hasEllipsis = /\.\s*\.\s*\./.test(line);
      const withoutMarkers = line
        .replace(/\.\s*\.\s*\.*/g, '')
        .replace(/PRES\s?I\s?DEN/gi, '')
        .trim();
      if (!withoutMarkers || (hasEllipsis && withoutMarkers.split(/\s+/).filter(Boolean).length < 4)) continue;
      draft.lastPage = page.page;
      draft.lines.push({ text: line, page: page.page });
    }
  }
  flush();
  if (!sections.length) {
    return sectionsFromPages(pages, title);
  }
  return sections;
}

/* ----------------------------------------------------------- stage 5: clean */

export function cleanSections(
  sections: ParsedSection[],
  onClean?: (result: ReturnType<typeof repairMojibake>, section: ParsedSection) => void,
): ParsedSection[] {
  const seen = new Map<string, number>();
  const out: ParsedSection[] = [];
  // Istilah dokumen dikumpulkan dulu supaya koreksi OCR tidak merusak kata
  // yang sudah sah di domain ini (mis. `Patch` pada kebijakan TI).
  const knownTerms = buildDocumentVocabulary(sections.map((section) => section.text));
  for (const section of sections) {
    const repaired = repairMojibake(section.text, { knownTerms });
    onClean?.(repaired, section);
    const text = repaired.text.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const key = text.slice(0, 80);
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    if (count > 1 && text.length < 120) continue; // header/footer berulang
    out.push({
      ...section,
      text,
      char_count: text.length,
      cleanFlags: [...(section.cleanFlags ?? []), ...repaired.flags],
    });
  }
  return out;
}

/* ----------------------------------------------------------- stage 7: chunk */

type ChunkDraft = Chunk & { key: string; parentKey: string | null };

/**
 * ADR-OF-13 — adapter dari entry point tunggal `chunkDocument` ke draft DB.
 * Tidak ada lagi logika pemotongan teks di core: semua aturan chunking
 * (legal vs non-legal) berada di `lib/ingest/chunker.ts` dan dipakai eval.
 *
 * - non-legal → chunk datar berlevel 'child' (sama dengan jalur hold-out);
 * - legal → chunk induk berlevel 'parent' + child dengan parentKey stabil.
 */
function toChunkDrafts(
  chunks: ChunkDocumentResult[],
  documentId: string,
  datasetId: string,
  docName: string,
): ChunkDraft[] {
  const legalParentKeys = new Set<string>();
  for (const chunk of chunks) {
    if (chunk.legal_id && !chunk.parent_id) legalParentKeys.add(chunk.legal_id);
  }

  return chunks.map((chunk, index) => {
    const isLegalParent = Boolean(chunk.legal_id && legalParentKeys.has(chunk.legal_id) && !chunk.parent_id);
    const span = chunk.pageSpan ??
      (chunk.page != null ? ([chunk.page, chunk.page] as [number, number]) : null);
    return {
      key: chunk.legal_id ?? `${documentId}:c:${index}`,
      parentKey: chunk.parent_id ?? null,
      document_id: documentId,
      dataset_id: datasetId,
      section_path: chunk.section ?? `Bagian ${index + 1}`,
      page: chunk.page,
      text: chunk.content,
      token_count: Math.ceil(chunk.content.length / 4),
      char_count: chunk.charCount,
      level: isLegalParent ? 'parent' : 'child',
      parent_id: null,
      embedding: null,
      ocr_status: chunk.ocrStatus ?? (chunk.ocrSkipped ? 'ocr_skipped' : 'ok'),
      confidence: chunk.ocrConfidence ?? chunk.confidence ?? 1,
      page_span: span,
      clean_flags: chunk.clean_flags ?? [],
      clean_version: chunk.clean_flags?.length ? 2 : 0,
      content_hash: chunk.content_hash ?? null,
      char_start: chunk.charStart ?? null,
      char_end: chunk.charEnd ?? null,
      unit_id: chunk.units?.[0]?.id ?? null,
      section_id: chunk.sectionId ?? null,
      section_hash: chunk.sectionHash ?? null,
      units_json: JSON.stringify(chunk.units ?? []),
      reading_order: chunk.readingOrder ? JSON.stringify(chunk.readingOrder) : null,
      layout_json: chunk.layout ? JSON.stringify(chunk.layout) : null,
      embed_text: `[${docName} | ${chunk.section ?? 'Bagian 1'}] ${chunk.content}`,
    };
  });
}

/* ------------------------------------------------------- stage 8/9: storage */

function toStoredValue(value: unknown, type: string): string | number | null {
  if (value === null || value === undefined || value === '') return null;
  if (type === 'integer' || type === 'number') {
    const n = Number(String(value).replace(/,/g, '.'));
    return Number.isFinite(n) ? n : null;
  }
  if (type === 'boolean') {
    const v = String(value).toLowerCase();
    return v === 'true' || v === 'ya' || v === 'yes' ? 1 : 0;
  }
  return String(value);
}

export function writePhysicalTable(
  db: DB,
  datasetId: string,
  index: number,
  table: RawTable,
  columns: ReturnType<typeof profileColumns>,
): SchemaTable {
  const name = physicalTableName(datasetId, index);
  const sqlType = (t: string) =>
    t === 'integer' || t === 'boolean' ? 'INTEGER' : t === 'number' ? 'REAL' : 'TEXT';
  const defs = columns.map((c) => `${quoteIdent(c.name)} ${sqlType(c.inferred_type)}`).join(', ');
  db.transaction(() => {
    db.exec(`DROP TABLE IF EXISTS ${quoteIdent(name)}`);
    db.exec(`CREATE TABLE ${quoteIdent(name)} (row_id INTEGER PRIMARY KEY, ${defs})`);
    const insert = db.prepare(
      `INSERT INTO ${quoteIdent(name)} (${columns.map((c) => quoteIdent(c.name)).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
    );
    for (const row of table.rows) {
      insert.run(...columns.map((c) => toStoredValue(row[c.sourceName], c.inferred_type)));
    }
  })();
  return {
    name,
    sourceName: table.sourceName,
    rowCount: table.rows.length,
    columns,
    dateColumn: columns.find((c) => c.semantic_role === 'time')?.name ?? null,
  };
}

/* ------------------------------------------------------------- orchestrator */

export type IngestOptions = {
  dataset: Dataset;
  buffer: Buffer;
  format: SourceType;
  originalName: string;
  storagePath?: string | null;
};

export async function ingestIntoDataset(db: DB, options: IngestOptions): Promise<Dataset> {
  const { dataset, buffer, format } = options;
  const quality: QualityReport = emptyQualityReport();
  const mark = async (step: string, fn: () => void | Promise<void>) => {
    const started = performance.now();
    try {
      await fn();
      recordStep(db, dataset.id, step, 'DONE', Math.round(performance.now() - started));
    } catch (error) {
      recordStep(
        db,
        dataset.id,
        step,
        'FAILED',
        Math.round(performance.now() - started),
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  };

  db.prepare("UPDATE core_datasets SET status = 'PROCESSING', updated_at = ? WHERE id = ?").run(
    nowJakartaIso(),
    dataset.id,
  );

  try {
    let rawTables: RawTable[] = [];
    let sections: ParsedSection[] = [];
    let classification: Classification = { kind: 'tabular', doc_type: 'general', confidence: 0, signals: [] };

    await mark('classification', () => {
      // Dokumen: klasifikasi ditunda sampai text layer terbaca. Membaca
      // `buffer.toString('utf8')` untuk PDF/DOCX menghasilkan sampah biner,
      // sehingga dokumen hukum selalu jatuh ke 'general' (bug Perpres).
      if (!TABULAR.has(format)) return;
      classification = classifySource({
        format,
        name: options.originalName,
        sampleText: '',
        hasHeader: true,
      });
    });

    await mark('parsing', async () => {
      if (format === 'csv') rawTables = [parseCsv(buffer)];
      else if (format === 'xlsx') rawTables = [await parseXlsx(buffer)];
      else if (format === 'sqlite') rawTables = parseSqlite(options.storagePath ?? '');
      else {
        const extracted = await extractPages(format, buffer, dataset.id);
        quality.parsedPages = extracted.pages.length;
        quality.ocrUsed = extracted.ocrUsed;
        quality.ocrPages = extracted.ocrPages;
        quality.ocrStatuses = extracted.ocrStatuses;
        quality.pageLabels = extracted.pageLabels;
        quality.peakRssBytes = extracted.peakRssBytes;
        const unreadable = extracted.pages.filter((p) => p.unreadable).map((p) => p.page);
        if (unreadable.length) {
          quality.issues.push(`unreadable_pages=${JSON.stringify(unreadable)}`);
          recordStep(
            db,
            dataset.id,
            'ocr',
            'DONE',
            extracted.ocrStatuses.reduce((sum, s) => sum + s.latencyMs, 0),
            `halaman tidak terbaca: ${unreadable.join(', ')}`,
          );
        } else if (extracted.ocrUsed) {
          recordStep(db, dataset.id, 'ocr', 'DONE', extracted.ocrStatuses.reduce((sum, s) => sum + s.latencyMs, 0));
        } else {
          recordStep(db, dataset.id, 'ocr', 'SKIPPED', 0, 'text layer mencukupi; OCR tidak dipanggil');
        }
        sections = sectionsFromPages(extracted.pages, dataset.name);
        // Klasifikasi SETELAH ekstraksi: sinyal "pasal/ayat/undang-undang"
        // hanya ada di teks hasil ekstraksi, bukan di byte PDF/DOCX.
        classification = classifySource({
          format,
          name: options.originalName,
          sampleText: sections
            .map((s) => s.text)
            .join('\n')
            .slice(0, 20_000),
          hasHeader: false,
        });
        const readableChars = sections
          .filter((s) => !s.unreadable)
          .reduce((sum, s) => sum + s.text.trim().length, 0);
        // Semua halaman gagal → FAILED jujur, bukan jawaban diam-diam.
        if (readableChars < LOW_TEXT_THRESHOLD) {
          throw unprocessable('Dokumen tidak memiliki text layer yang dapat diekstrak', {
            reason: 'NO_TEXT_LAYER',
            ocrPages: extracted.ocrPages,
            unreadablePages: unreadable,
          });
        }
      }
    });

    await mark('extraction', () => {
      quality.tablesFound = rawTables.length;
    });

    await mark('cleaning', () => {
      const log: NonNullable<QualityReport['cleaningLog']> = [];
      const flags = new Set<string>();
      sections = cleanSections(sections, (result, section) => {
        for (const entry of result.cleaningLog) {
          log.push({ ...entry, reason: `halaman ${section.page ?? '?'}: ${entry.reason}` });
        }
        for (const flag of result.flags) flags.add(flag);
        if (!result.numericSafe) {
          quality.issues.push(`numeric_guard_halaman_${section.page ?? '?'}`);
        }
      });
      quality.cleaningLog = log;
      quality.cleanFlags = [...flags];
      if (flags.size) quality.issues.push(`clean_flags=${JSON.stringify([...flags])}`);
    });

    let schema: SchemaJson = dataset.schema_json;
    let period = { start: dataset.period_start, end: dataset.period_end };
    let rowCount = 0;

    await mark('normalization', () => {
      if (rawTables.length) {
        const tables: SchemaTable[] = rawTables.map((table, index) => {
          const columns = profileColumns(table.headers, table.rows, { sourceName: table.sourceName });
          return writePhysicalTable(db, dataset.id, index, table, columns);
        });
        schema = buildSchemaJson(tables);
        rowCount = tables.reduce((sum, t) => sum + t.rowCount, 0);
        period = detectPeriod(schema.tables[0]?.columns ?? [], rawTables[0]?.rows ?? []);
        quality.rowsParsed = rowCount;
        quality.missingByColumn = {};
        for (const table of rawTables) {
          for (const header of table.headers) {
            quality.missingByColumn[header] = table.rows.filter(
              (r) => r[header] === null || r[header] === undefined || String(r[header]).trim() === '',
            ).length;
          }
        }
      } else {
        schema = buildSchemaJson([]);
        rowCount = 0;
      }
    });

    await mark('chunking', () => {
      if (!sections.length) return;
      // Fase 2A: id dokumen STABIL dari isi file. Upload ulang PDF yang sama
      // tidak menciptakan document_id/chunk_id baru (idempotensi).
      const documentId = `doc_${createHash('sha256').update(buffer).digest('hex').slice(0, 12)}`;
      const drafts = toChunkDrafts(
        chunkDocument({ sections, docType: classification.doc_type, documentId }),
        documentId,
        dataset.id,
        options.originalName,
      );
      db.prepare(
        `INSERT INTO core_documents(id, dataset_id, doc_type, doc_group, mime, pages, sections_json, source_path, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           dataset_id = excluded.dataset_id, doc_type = excluded.doc_type, doc_group = excluded.doc_group,
           pages = excluded.pages, sections_json = excluded.sections_json, source_path = excluded.source_path`,
      ).run(
        documentId,
        dataset.id,
        classification.doc_type,
        docGroupOf(classification.doc_type),
        null,
        quality.parsedPages,
        JSON.stringify(sections),
        options.storagePath ?? null,
        nowJakartaIso(),
      );
      const insert = db.prepare(
        `INSERT INTO core_chunks
           (document_id, dataset_id, section_path, page, text, token_count, char_count, level, parent_id, embedding_json,
            content_hash, page_span, clean_version, clean_flags, ocr_status, confidence,
            char_start, char_end, unit_id, section_id, section_hash, units_json, reading_order, layout_json, embed_text)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const values = (draft: ChunkDraft, parentId: number | null) => [
        draft.document_id,
        draft.dataset_id,
        draft.section_path,
        draft.page,
        draft.text,
        draft.token_count,
        draft.char_count,
        draft.level,
        parentId,
        null,
        draft.content_hash ?? null,
        draft.page_span ? JSON.stringify(draft.page_span) : null,
        draft.clean_version ?? 0,
        JSON.stringify(draft.clean_flags ?? []),
        draft.ocr_status ?? 'ok',
        draft.confidence ?? 1,
        draft.char_start ?? null,
        draft.char_end ?? null,
        draft.unit_id ?? null,
        draft.section_id ?? null,
        draft.section_hash ?? null,
        draft.units_json ?? '[]',
        draft.reading_order ?? null,
        draft.layout_json ?? null,
        draft.embed_text ?? null,
      ];
      const childIds: number[] = [];
      db.transaction(() => {
        // Re-index selektif per bagian: bagian dengan section_hash sama
        // dipertahankan, hanya bagian berubah yang ditulis ulang.
        const byHash = new Map<string, ChunkDraft[]>();
        for (const draft of drafts) {
          const hash = draft.section_hash ?? draft.content_hash ?? `c:${draft.key}`;
          const group = byHash.get(hash) ?? [];
          group.push(draft);
          byHash.set(hash, group);
        }
        const existing = db
          .prepare('SELECT id, section_hash FROM core_chunks WHERE document_id = ?')
          .all(documentId) as Array<{ id: number; section_hash: string | null }>;
        const keep = new Set(byHash.keys());
        const stale = existing
          .filter((row) => !row.section_hash || !keep.has(row.section_hash))
          .map((row) => row.id);
        if (stale.length) {
          db.prepare(`DELETE FROM core_chunks WHERE id IN (${stale.map(() => '?').join(',')})`).run(...stale);
        }
        const present = new Set(
          existing
            .filter((row) => row.section_hash && keep.has(row.section_hash))
            .map((row) => row.section_hash as string),
        );
        const parentIds = new Map<string, number>();
        for (const [hash, group] of byHash) {
          if (present.has(hash)) continue;
          for (const draft of group) {
            if (draft.level !== 'parent') continue;
            const result = insert.run(...values(draft, null));
            parentIds.set(draft.key, Number(result.lastInsertRowid));
          }
          for (const draft of group) {
            if (draft.level !== 'child') continue;
            const result = insert.run(
              ...values(draft, draft.parentKey ? parentIds.get(draft.parentKey) ?? null : null),
            );
            childIds.push(Number(result.lastInsertRowid));
          }
        }
        // DECISION-032: chunk + op sync ditulis dalam SATU transaksi SQLite.
        // Saat QDRANT_MODE=off enqueueUpserts() adalah no-op → perilaku lama.
        enqueueUpserts(db, childIds, dataset.id, dataset.id);
      })();
    });

    await mark('indexing', async () => {
      const n = (
        db.prepare('SELECT COUNT(*) AS n FROM core_chunks WHERE dataset_id = ?').get(dataset.id) as { n: number }
      ).n;
      quality.issues.push(`chunks_indexed=${n}`);

      // Normalisasi teks saat indexing: trigger core-schema.sql mengisi FTS
      // dengan teks mentah; di sini diganti bentuk stem ringan. Dibatasi 2000
      // chunk agar RAM puncak tetap rendah di VPS 2 GB. Bila UPDATE FTS tidak
      // didukung, query dual-term (asli + stem) di store.ts tetap bekerja.
      try {
        const rows = db
          .prepare(
            `SELECT id, text, section_path FROM core_chunks
             WHERE dataset_id = ? ORDER BY id LIMIT 2000`,
          )
          .all(dataset.id) as Array<{ id: number; text: string; section_path: string }>;
        const update = db.prepare('UPDATE core_chunks_fts SET text = ?, section_path = ? WHERE rowid = ?');
        db.transaction(() => {
          for (const row of rows) {
            update.run(normalizeForFts(row.text), normalizeForFts(row.section_path), row.id);
          }
        })();
        quality.issues.push('fts_stemmed=1');
      } catch {
        quality.issues.push('fts_stemmed=0');
      }

      // Qdrant adalah derived index. Kuras outbox di sini, tetapi kegagalan
      // Qdrant TIDAK BOLEH menggagalkan ingest — FTS5 tetap terisi.
      try {
        const sync = await drainOutbox(db);
        quality.issues.push(`qdrant_sync_enabled=${sync.enabled ? 1 : 0}`);
        if (sync.enabled) {
          quality.issues.push(`qdrant_synced=${sync.succeeded}`);
          if (sync.failed) quality.issues.push(`qdrant_failed=${sync.failed}`);
          if (sync.error) quality.issues.push('qdrant_error=1');
        }
      } catch {
        quality.issues.push('qdrant_sync=skipped');
      }
    });

    await mark('storage', () => {
      db.prepare(
        `UPDATE core_datasets SET
           kind = ?, doc_type = ?, doc_group = ?, status = 'READY', schema_json = ?, row_count = ?,
           period_start = ?, period_end = ?, quality_report = ?, updated_at = ?
         WHERE id = ?`,
      ).run(
        classification.kind,
        classification.doc_type,
        docGroupOf(classification.doc_type),
        JSON.stringify(schema),
        rowCount,
        period.start,
        period.end,
        JSON.stringify(quality),
        nowJakartaIso(),
        dataset.id,
      );
    });

    // Dataset berubah → cache lama tidak boleh dipakai lagi.
    invalidateQueryCache(db);

    return {
      ...dataset,
      kind: classification.kind,
      doc_type: classification.doc_type,
      doc_group: docGroupOf(classification.doc_type),
      status: 'READY',
      schema_json: schema,
      row_count: rowCount,
      period_start: period.start,
      period_end: period.end,
      quality_report: quality,
    };
  } catch (error) {
    db.prepare("UPDATE core_datasets SET status = 'FAILED', updated_at = ? WHERE id = ?").run(
      nowJakartaIso(),
      dataset.id,
    );
    throw error;
  }
}

/** Simpan file upload ke storage dengan nama aman (path traversal sudah dicegah). */
export function persistUpload(datasetId: string, safeName: string, buffer: Buffer): string {
  const dir = path.join(UPLOADS_DIR, 'core');
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, `${datasetId.replace(/[^a-zA-Z0-9_-]/g, '')}_${safeIdentifier(safeName)}`);
  fs.writeFileSync(target, buffer);
  return target;
}
