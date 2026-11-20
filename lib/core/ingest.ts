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
  SchemaJson,
  SchemaTable,
  SourceType,
} from '@/lib/core/contracts';
import { emptyQualityReport, newDocumentId, recordStep } from '@/lib/core/registry';
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

type ParsedPage = { page: number; text: string };

async function extractPages(format: SourceType, buffer: Buffer): Promise<ParsedPage[]> {
  if (format === 'pdf') {
    let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
    try {
      pdf = await getDocumentProxy(new Uint8Array(buffer));
    } catch {
      throw unprocessable('PDF tidak dapat dibaca (rusak atau terenkripsi)', { reason: 'PARSE_ERROR' });
    }
    const pages: ParsedPage[] = [];
    for (let i = 1; i <= pdf.numPages; i += 1) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      let text = '';
      for (const raw of content.items) {
        const item = raw as unknown as { str?: unknown; hasEOL?: boolean };
        if (typeof item.str === 'string') {
          text += item.str;
          if (item.hasEOL) text += '\n';
        }
      }
      pages.push({ page: i, text });
    }
    return pages;
  }
  if (format === 'docx') {
    try {
      const result = await mammoth.extractRawText({ buffer });
      return [{ page: 1, text: result.value }];
    } catch {
      throw unprocessable('DOCX tidak dapat dibaca', { reason: 'PARSE_ERROR' });
    }
  }
  return [{ page: 1, text: buffer.toString('utf8') }];
}

const HEADING_PATTERNS: Array<{ re: RegExp; kind: string }> = [
  { re: /^(pasal)\s+(\d+[a-z]?)\s*[.:-]?\s*(.*)$/i, kind: 'pasal' },
  { re: /^(ayat)\s*\(?(\d+)\)?\s*[.:-]?\s*(.*)$/i, kind: 'ayat' },
  { re: /^(bab)\s+([ivxlcdm\d]+)\s*[.:-]?\s*(.*)$/i, kind: 'bab' },
  { re: /^(tabel)\s+(\d+)\s*[.:-]?\s*(.*)$/i, kind: 'tabel' },
  { re: /^#{1,6}\s+(.+)$/, kind: 'markdown' },
  { re: /^(\d{1,2})[.)]\s+(.+)$/, kind: 'numbered' },
];

export type ParsedSection = DocumentSection & { text: string };

/** Struktur dokumen generik → sections dengan section_path hierarkis. */
export function sectionsFromPages(pages: ParsedPage[], title: string): ParsedSection[] {
  const sections: ParsedSection[] = [];
  let currentPath = title || 'Dokumen';
  let currentPage = pages[0]?.page ?? 1;
  let buffer: string[] = [];

  const flush = () => {
    const text = buffer.join('\n').replace(/[ \t]+/g, ' ').trim();
    if (text) sections.push({ section_path: currentPath, page: currentPage, char_count: text.length, text });
    buffer = [];
  };

  for (const page of pages) {
    for (const rawLine of page.text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;
      let matched = false;
      for (const { re, kind } of HEADING_PATTERNS) {
        const m = re.exec(line);
        if (!m) continue;
        flush();
        currentPage = page.page;
        if (kind === 'pasal') currentPath = `Pasal ${m[2]}`;
        else if (kind === 'ayat') currentPath = `${currentPath}/Ayat (${m[2]})`;
        else if (kind === 'bab') currentPath = `BAB ${m[2]}${m[3] ? ` — ${m[3]}` : ''}`;
        else if (kind === 'tabel') currentPath = `Tabel ${m[2]}${m[3] ? ` — ${m[3]}` : ''}`;
        else currentPath = m[2] ?? m[1] ?? line;
        if (m[3] && kind !== 'ayat') buffer.push(m[3]);
        matched = true;
        break;
      }
      if (!matched) buffer.push(line);
    }
  }
  flush();
  return sections;
}

/* ----------------------------------------------------------- stage 5: clean */

export function cleanSections(sections: ParsedSection[]): ParsedSection[] {
  const seen = new Map<string, number>();
  const out: ParsedSection[] = [];
  for (const section of sections) {
    const text = section.text.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const key = text.slice(0, 80);
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    if (count > 1 && text.length < 120) continue; // header/footer berulang
    out.push({ ...section, text, char_count: text.length });
  }
  return out;
}

/* ----------------------------------------------------------- stage 7: chunk */

const CHILD_TARGET = 1200; // ~300 token
const CHILD_OVERLAP = 150;
const PARENT_TARGET = 4000; // ~1000 token

type ChunkDraft = Chunk & { key: string; parentKey: string | null };

function splitText(text: string, target: number, overlap: number): string[] {
  const units = text
    .split(/\n\s*\n+/)
    .flatMap((para) => para.split(/(?<=[.!?])\s+/))
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const parts: string[] = [];
  let current = '';
  for (const unit of units) {
    if (!current) {
      current = unit;
    } else if (current.length + 1 + unit.length <= target) {
      current += ` ${unit}`;
    } else {
      parts.push(current);
      const tail = current.slice(-overlap);
      current = `${tail} ${unit}`.trim();
    }
  }
  if (current) parts.push(current);
  return parts.length ? parts : [text];
}

export function chunkSections(
  sections: ParsedSection[],
  documentId: string,
  datasetId: string,
): ChunkDraft[] {
  const drafts: ChunkDraft[] = [];
  let seq = 0;
  for (const section of sections) {
    const text = section.text.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    for (const parentText of splitText(text, PARENT_TARGET, 0)) {
      const parentKey = `${documentId}:p:${seq}`;
      drafts.push({
        key: parentKey,
        parentKey: null,
        document_id: documentId,
        dataset_id: datasetId,
        section_path: section.section_path,
        page: section.page,
        text: parentText,
        token_count: Math.ceil(parentText.length / 4),
        char_count: parentText.length,
        level: 'parent',
        parent_id: null,
        embedding: null,
      });
      seq += 1;
      splitText(parentText, CHILD_TARGET, CHILD_OVERLAP).forEach((childText, childIndex) => {
        drafts.push({
          key: `${parentKey}:c:${childIndex}`,
          parentKey,
          document_id: documentId,
          dataset_id: datasetId,
          section_path: section.section_path,
          page: section.page,
          text: childText,
          token_count: Math.ceil(childText.length / 4),
          char_count: childText.length,
          level: 'child',
          parent_id: null,
          embedding: null,
        });
      });
    }
  }
  return drafts;
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
      const sample = TABULAR.has(format) ? '' : buffer.toString('utf8').slice(0, 20_000);
      classification = classifySource({
        format,
        name: options.originalName,
        sampleText: sample,
        hasHeader: TABULAR.has(format),
      });
    });

    await mark('parsing', async () => {
      if (format === 'csv') rawTables = [parseCsv(buffer)];
      else if (format === 'xlsx') rawTables = [await parseXlsx(buffer)];
      else if (format === 'sqlite') rawTables = parseSqlite(options.storagePath ?? '');
      else {
        const pages = await extractPages(format, buffer);
        quality.parsedPages = pages.length;
        sections = sectionsFromPages(pages, dataset.name);
        const chars = sections.reduce((sum, s) => sum + s.text.trim().length, 0);
        if (chars < 40) {
          if (process.env.OCR_ENABLED === 'true') {
            recordStep(db, dataset.id, 'ocr', 'SKIPPED', 0, 'OCR adapter tidak tersedia; teks tidak dipaksa');
          }
          throw unprocessable('Dokumen tidak memiliki text layer yang dapat diekstrak', { reason: 'NO_TEXT_LAYER' });
        }
      }
    });

    await mark('extraction', () => {
      quality.tablesFound = rawTables.length;
    });

    await mark('cleaning', () => {
      sections = cleanSections(sections);
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
      const documentId = newDocumentId();
      const drafts = chunkSections(sections, documentId, dataset.id);
      db.prepare(
        `INSERT INTO core_documents(id, dataset_id, doc_type, mime, pages, sections_json, source_path, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        documentId,
        dataset.id,
        classification.doc_type,
        null,
        quality.parsedPages,
        JSON.stringify(sections),
        options.storagePath ?? null,
        nowJakartaIso(),
      );
      const parentIds = new Map<string, number>();
      const insert = db.prepare(
        `INSERT INTO core_chunks
           (document_id, dataset_id, section_path, page, text, token_count, char_count, level, parent_id, embedding_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      db.transaction(() => {
        for (const draft of drafts) {
          if (draft.level !== 'parent') continue;
          const result = insert.run(
            draft.document_id,
            draft.dataset_id,
            draft.section_path,
            draft.page,
            draft.text,
            draft.token_count,
            draft.char_count,
            draft.level,
            null,
            null,
          );
          parentIds.set(draft.key, Number(result.lastInsertRowid));
        }
        for (const draft of drafts) {
          if (draft.level !== 'child') continue;
          insert.run(
            draft.document_id,
            draft.dataset_id,
            draft.section_path,
            draft.page,
            draft.text,
            draft.token_count,
            draft.char_count,
            draft.level,
            draft.parentKey ? parentIds.get(draft.parentKey) ?? null : null,
            null,
          );
        }
      })();
    });

    await mark('indexing', () => {
      const n = (
        db.prepare('SELECT COUNT(*) AS n FROM core_chunks WHERE dataset_id = ?').get(dataset.id) as { n: number }
      ).n;
      quality.issues.push(`chunks_indexed=${n}`);
    });

    await mark('storage', () => {
      db.prepare(
        `UPDATE core_datasets SET
           kind = ?, doc_type = ?, status = 'READY', schema_json = ?, row_count = ?,
           period_start = ?, period_end = ?, quality_report = ?, updated_at = ?
         WHERE id = ?`,
      ).run(
        classification.kind,
        classification.doc_type,
        JSON.stringify(schema),
        rowCount,
        period.start,
        period.end,
        JSON.stringify(quality),
        nowJakartaIso(),
        dataset.id,
      );
    });

    return {
      ...dataset,
      kind: classification.kind,
      doc_type: classification.doc_type,
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
