/**
 * Schema introspection & profiling — dataset-agnostik.
 * CSV / XLSX / SQLite → SchemaColumn[] dengan inferred_type, semantic_role,
 * distinct_count dan sample_values. TIDAK ada daftar kolom domain di sini.
 */

import ExcelJS from 'exceljs';
import { parse } from 'csv-parse/sync';
import Database from 'better-sqlite3';
import { unprocessable } from '@/lib/errors';
import { hashJson } from '@/lib/core/registry';
import type {
  InferredType,
  SchemaColumn,
  SchemaJson,
  SchemaTable,
  SemanticRole,
} from '@/lib/core/contracts';

export const PROFILE_ROW_LIMIT = 5000;
const SAMPLE_SIZE = 5;

export type RawTable = {
  sourceName: string;
  headers: string[];
  rows: Array<Record<string, unknown>>;
  totalRows: number;
};

/** Nama identifier aman untuk SQL (dipakai sebagai nama kolom fisik). */
export function safeIdentifier(input: string, fallback = 'col'): string {
  const cleaned = String(input ?? '')
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase()
    .slice(0, 48);
  if (!cleaned) return fallback;
  return /^[0-9]/.test(cleaned) ? `c_${cleaned}` : cleaned;
}

export function physicalTableName(datasetId: string, index = 0): string {
  const safe = datasetId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 20) || 'upload';
  return `core_data_${safe}${index > 0 ? `_${index}` : ''}`;
}

export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;
const INTEGER = /^-?\d+$/;
const NUMBER = /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/;
const BOOL_WORDS = new Set(['true', 'false', 'ya', 'tidak', 'yes', 'no']);
const TIME_NAME = /(date|tanggal|time|waktu|period|periode|year|tahun|month|bulan|timestamp)/i;
const ID_NAME = /^(id|kode|code|no|number|uuid|key|_id)$|(^id_)|(_id$)/i;
const TEXT_NAME = /(text|deskripsi|description|catatan|note|narasi|narrative|isi|content|judul|title|alamat|address)/i;

function isNull(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
}

function textOf(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value).trim();
}

export function inferType(values: unknown[]): InferredType {
  const present = values.filter((v) => !isNull(v)).map(textOf);
  if (!present.length) return 'text';
  if (present.every((v) => BOOL_WORDS.has(v.toLowerCase()))) return 'boolean';
  if (present.every((v) => ISO_DATETIME.test(v))) return 'datetime';
  if (present.every((v) => ISO_DATE.test(v))) return 'date';
  if (present.every((v) => INTEGER.test(v))) return 'integer';
  if (present.every((v) => NUMBER.test(v.replace(/,/g, '.')))) return 'number';
  return 'text';
}

export function inferRole(
  sourceName: string,
  type: InferredType,
  values: unknown[],
  distinctCount: number,
  rowCount: number,
): SemanticRole {
  const present = values.filter((v) => !isNull(v)).map(textOf);
  if (type === 'date' || type === 'datetime' || TIME_NAME.test(sourceName)) return 'time';
  if (type === 'boolean') return 'dimension';
  if (type === 'integer' || type === 'number') {
    const uniqueAlmostAll = rowCount > 0 && distinctCount >= rowCount * 0.95;
    if (ID_NAME.test(sourceName) || uniqueAlmostAll) return 'identifier';
    return 'measure';
  }
  if (TEXT_NAME.test(sourceName)) return 'text';
  const avgLength = present.length
    ? present.reduce((sum, v) => sum + v.length, 0) / present.length
    : 0;
  if (avgLength > 120) return 'text';
  const lowCardinality = rowCount > 0 && distinctCount <= Math.max(2, Math.min(60, Math.ceil(rowCount * 0.5)));
  if (ID_NAME.test(sourceName)) return 'identifier';
  return lowCardinality ? 'dimension' : 'text';
}

export type ProfileOptions = {
  /** Nama asli tabel/sheet (hanya untuk metadata, bukan pengetahuan domain). */
  sourceName?: string;
  /** Nama objek SQL yang akan di-whitelist. */
  tableName?: string;
  /** Batasi jumlah baris yang diprofil (default 5000). */
  rowLimit?: number;
};

/** Profil satu tabel mentah → SchemaColumn[]. */
export function profileColumns(
  headers: string[],
  rows: Array<Record<string, unknown>>,
  options: ProfileOptions = {},
): SchemaColumn[] {
  const limit = options.rowLimit ?? PROFILE_ROW_LIMIT;
  const sampled = rows.slice(0, limit);
  const seenNames = new Set<string>();

  return headers.map((rawHeader, ordinal) => {
    const sourceName = String(rawHeader ?? '').trim() || `column_${ordinal + 1}`;
    let name = safeIdentifier(sourceName, `col_${ordinal + 1}`);
    while (seenNames.has(name)) name = `${name}_${ordinal + 1}`;
    seenNames.add(name);

    const values = sampled.map((row) => row[rawHeader]);
    const present = values.filter((v) => !isNull(v));
    const distinct = new Set(present.map(textOf));
    const inferred_type = inferType(values);
    const semantic_role = inferRole(sourceName, inferred_type, present, distinct.size, sampled.length);
    const sample_values = [...distinct].slice(0, SAMPLE_SIZE).map((v) => {
      if (inferred_type === 'integer' || inferred_type === 'number') {
        const n = Number(v.replace(/,/g, '.'));
        return Number.isFinite(n) ? n : v;
      }
      return v;
    });

    return {
      name,
      sourceName,
      inferred_type,
      semantic_role,
      nullable: present.length < sampled.length,
      distinct_count: distinct.size,
      sample_values,
      unit: null,
      description: null,
    };
  });
}

export function buildSchemaJson(tables: SchemaTable[]): SchemaJson {
  return {
    version: 1,
    hash: hashJson({ tables: tables.map((t) => ({ name: t.name, columns: t.columns.map((c) => c.name) })) }),
    tables,
    relations: [],
    enums: {},
  };
}

/** Deteksi rentang periode dari kolom bertipe time (generik, bukan nama domain). */
export function detectPeriod(
  columns: SchemaColumn[],
  rows: Array<Record<string, unknown>>,
): { start: string | null; end: string | null } {
  const timeCols = columns.filter((c) => c.semantic_role === 'time');
  for (const col of timeCols) {
    const values = rows
      .map((row) => textOf(row[col.name] ?? row[col.sourceName]))
      .filter((v) => ISO_DATE.test(v) || ISO_DATETIME.test(v))
      .map((v) => v.slice(0, 10))
      .sort();
    if (values.length) return { start: values[0], end: values[values.length - 1] };
  }
  return { start: null, end: null };
}

/* ------------------------------------------------------------------- parsers */

export function parseCsv(buffer: Buffer): RawTable {
  try {
    const rows = parse(buffer, {
      bom: true,
      columns: true,
      skip_empty_lines: true,
      relax_column_count: true,
      trim: true,
    }) as Array<Record<string, unknown>>;
    const headers = rows.length ? Object.keys(rows[0]) : [];
    return { sourceName: 'csv', headers, rows, totalRows: rows.length };
  } catch {
    throw unprocessable('CSV tidak dapat diparse', { reason: 'PARSE_ERROR' });
  }
}

export async function parseXlsx(buffer: Buffer): Promise<RawTable> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw unprocessable('XLSX rusak atau tidak dapat dibaca', { reason: 'PARSE_ERROR' });
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) throw unprocessable('XLSX tidak memiliki sheet', { reason: 'EMPTY' });
  const matrix: string[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      values[col - 1] = cell.text?.trim() ?? String(cell.value ?? '').trim();
    });
    matrix.push(values);
  });
  if (!matrix.length) throw unprocessable('XLSX kosong', { reason: 'EMPTY' });
  const headers = (matrix[0] ?? []).map((h, i) => String(h ?? '').trim() || `column_${i + 1}`);
  const rows = matrix.slice(1).map((cells) => {
    const obj: Record<string, unknown> = {};
    headers.forEach((h, i) => {
      obj[h] = cells[i] ?? '';
    });
    return obj;
  });
  return { sourceName: sheet.name || 'sheet', headers, rows, totalRows: rows.length };
}

/** Baca file SQLite yang diunggah (read-only) → satu RawTable per tabel. */
export function parseSqlite(filePath: string): RawTable[] {
  let db: Database.Database;
  try {
    db = new Database(filePath, { readonly: true, fileMustExist: true });
  } catch {
    throw unprocessable('File SQLite tidak dapat dibuka', { reason: 'PARSE_ERROR' });
  }
  try {
    const names = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all() as Array<{ name: string }>;
    if (!names.length) throw unprocessable('File SQLite tidak memiliki tabel', { reason: 'EMPTY' });
    return names.map(({ name }) => {
      const info = db.prepare(`PRAGMA table_info(${quoteIdent(name)})`).all() as Array<{ name: string }>;
      const headers = info.map((c) => c.name);
      const totalRows = (db.prepare(`SELECT COUNT(*) AS n FROM ${quoteIdent(name)}`).get() as { n: number }).n;
      const rows = db.prepare(`SELECT * FROM ${quoteIdent(name)} LIMIT ${PROFILE_ROW_LIMIT}`).all() as Array<
        Record<string, unknown>
      >;
      return { sourceName: name, headers, rows, totalRows };
    });
  } finally {
    db.close();
  }
}
