import ExcelJS from 'exceljs';
import { parse } from 'csv-parse/sync';
import type { DB } from '@/lib/db/client';
import { unprocessable } from '@/lib/errors';
import { nowJakartaIso } from '@/lib/date';
import {
  CANONICAL_COLUMNS,
  mapColumns,
  normalizeAmount,
  normalizeDate,
  normalizeStatus,
  type CanonicalColumn,
  type ColumnMapping,
} from '@/lib/ingest/validate';
import { updateSource, type SourceRow } from '@/lib/ingest/store';
import { invalidateQueryCache } from '@/lib/core/cache';

type RawRow = Record<string, string>;

const SQL_TYPES: Record<CanonicalColumn, string> = {
  transaction_id: 'TEXT',
  created_at: 'TEXT',
  transaction_date: 'TEXT',
  merchant_id: 'TEXT',
  channel_id: 'TEXT',
  channel_name: 'TEXT',
  category: 'TEXT',
  amount: 'REAL',
  fee: 'REAL',
  status: 'TEXT',
  failure_code: 'TEXT',
  processing_time_ms: 'INTEGER',
  device_type: 'TEXT',
  customer_region: 'TEXT',
};

export function tableNameFor(sourceId: string): string {
  const safe = sourceId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 16) || 'upload';
  return `ds_${safe}`;
}

async function readRows(format: string, buffer: Buffer): Promise<{ headers: string[]; rows: RawRow[] }> {
  if (format === 'csv') {
    try {
      const rows = parse(buffer, {
        bom: true,
        columns: true,
        skip_empty_lines: true,
        relax_column_count: true,
        trim: true,
      }) as RawRow[];
      const headers = rows.length ? Object.keys(rows[0]) : [];
      return { headers, rows };
    } catch {
      throw unprocessable('CSV tidak dapat diparse', { reason: 'PARSE_ERROR' });
    }
  }

  if (format === 'xlsx') {
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
    if (matrix.length < 2) return { headers: matrix[0] ?? [], rows: [] };
    const headers = matrix[0].map((h) => String(h ?? '').trim());
    const rows = matrix.slice(1).map((cells) => {
      const obj: RawRow = {};
      headers.forEach((h, i) => {
        if (h) obj[h] = cells[i] ?? '';
      });
      return obj;
    });
    return { headers, rows };
  }

  throw unprocessable(`Format dataset .${format} tidak didukung`);
}

function columnValue(row: RawRow, mapping: ColumnMapping, column: CanonicalColumn): string {
  const header = mapping[column];
  if (!header) return '';
  return (row[header] ?? '').toString().trim();
}

export async function ingestDataset(db: DB, source: SourceRow, buffer: Buffer): Promise<{ rowCount: number }> {
  const { headers, rows } = await readRows(source.format, buffer);
  if (!headers.length) throw unprocessable('File tidak memiliki header', { reason: 'EMPTY' });

  const { mapping, missing } = mapColumns(headers);
  if (missing.length) {
    throw unprocessable('Kolom wajib tidak ditemukan', { reason: 'MISSING_COLUMNS', missing });
  }

  const used = new Set(Object.values(mapping).filter((v): v is string => Boolean(v)));

  const missingByColumn: Record<string, number> = {};
  for (const column of CANONICAL_COLUMNS) missingByColumn[column] = 0;

  const seen = new Set<string>();
  let duplicates = 0;
  let rejected = 0;
  const prepared: {
    values: (string | number | null)[];
    extra: string | null;
  }[] = [];
  let minDate: string | null = null;
  let maxDate: string | null = null;

  for (const row of rows) {
    const date = normalizeDate(columnValue(row, mapping, 'transaction_date'));
    const status = columnValue(row, mapping, 'status');
    if (!date || !status) {
      rejected += 1;
      continue;
    }

    const canonical: Record<CanonicalColumn, string | number | null> = {} as Record<CanonicalColumn, string | number | null>;
    for (const column of CANONICAL_COLUMNS) {
      const raw = columnValue(row, mapping, column);
      if (!raw) missingByColumn[column] += 1;
      switch (column) {
        case 'transaction_date':
          canonical[column] = date;
          break;
        case 'status':
          canonical[column] = normalizeStatus(raw);
          break;
        case 'amount':
        case 'fee':
          canonical[column] = normalizeAmount(raw);
          break;
        case 'processing_time_ms': {
          const n = normalizeAmount(raw);
          canonical[column] = n === null ? null : Math.round(n);
          break;
        }
        case 'created_at':
          canonical[column] = raw ? raw.replace('T', ' ').slice(0, 19) : `${date} 00:00:00`;
          break;
        default:
          canonical[column] = raw || null;
      }
    }

    if (!canonical.transaction_date) continue;
    if (!canonical.channel_id && canonical.channel_name) {
      canonical.channel_id = String(canonical.channel_name);
    }

    const key = String(canonical.transaction_id ?? `${date}|${status}|${canonical.amount ?? ''}|${canonical.channel_name ?? ''}`);
    if (seen.has(key)) {
      duplicates += 1;
      continue;
    }
    seen.add(key);

    const extra: Record<string, string> = {};
    for (const header of Object.keys(row)) {
      if (used.has(header)) continue;
      const value = (row[header] ?? '').toString().trim();
      if (value) extra[header] = value;
    }

    const values = CANONICAL_COLUMNS.map((c) => canonical[c]);
    prepared.push({ values, extra: Object.keys(extra).length ? JSON.stringify(extra) : null });

    if (!minDate || date < minDate) minDate = date;
    if (!maxDate || date > maxDate) maxDate = date;
  }

  if (!prepared.length) {
    throw unprocessable('Tidak ada baris valid (transaction_date dan status wajib terisi)', {
      reason: 'NO_VALID_ROWS',
      rowsRejected: rejected,
    });
  }

  const table = tableNameFor(source.id);
  const columnDefs = CANONICAL_COLUMNS.map((c) => `"${c}" ${SQL_TYPES[c]}`).join(', ');
  const insertSql = `INSERT INTO "${table}" (${CANONICAL_COLUMNS.map((c) => `"${c}"`).join(', ')}, extra_json)
                     VALUES (${CANONICAL_COLUMNS.map(() => '?').join(', ')}, ?)`;

  const insertMany = db.transaction((entries: typeof prepared) => {
    db.exec(`DROP TABLE IF EXISTS "${table}"`);
    db.exec(
      `CREATE TABLE "${table}" (
         row_id INTEGER PRIMARY KEY,
         ${columnDefs},
         extra_json TEXT
       )`,
    );
    db.exec(`CREATE INDEX "ix_${table}_date" ON "${table}" (transaction_date)`);
    db.exec(`CREATE INDEX "ix_${table}_channel" ON "${table}" (channel_name)`);
    const stmt = db.prepare(insertSql);
    for (const entry of entries) stmt.run(...entry.values, entry.extra);
  });
  insertMany(prepared);

  const columns = CANONICAL_COLUMNS.map((c, i) => ({
    name: c,
    type: SQL_TYPES[c],
    nullable: c !== 'transaction_date' && c !== 'status',
    ordinal: i + 1,
  }));

  const sampleRows = prepared.slice(0, 20).map((entry) => {
    const obj: Record<string, string | number | null> = {};
    CANONICAL_COLUMNS.forEach((c, i) => {
      obj[c] = entry.values[i] ?? null;
    });
    return obj;
  });

  const meta = {
    table,
    rowsParsed: rows.length,
    rowsRejected: rejected,
    duplicateRows: duplicates,
    missingByColumn,
    columns,
    minDate,
    maxDate,
    tables: 1,
    indexedAt: nowJakartaIso(),
  };

  const persist = db.transaction(() => {
    db.prepare('DELETE FROM dataset_columns WHERE source_id = ?').run(source.id);
    db.prepare('DELETE FROM dataset_samples WHERE source_id = ?').run(source.id);
    const colStmt = db.prepare(
      'INSERT INTO dataset_columns(source_id, table_name, ordinal, name, sql_type, nullable) VALUES (?, ?, ?, ?, ?, ?)',
    );
    for (const col of columns) {
      colStmt.run(source.id, table, col.ordinal, col.name, col.type, col.nullable ? 1 : 0);
    }
    const sampleStmt = db.prepare(
      'INSERT INTO dataset_samples(source_id, table_name, row_no, row_json) VALUES (?, ?, ?, ?)',
    );
    sampleRows.forEach((row, index) => sampleStmt.run(source.id, table, index + 1, JSON.stringify(row)));
    updateSource(db, source.id, {
      status: 'READY',
      row_count: prepared.length,
      error: null,
      meta_json: JSON.stringify(meta),
    });
  });
  persist();
  invalidateQueryCache(db);

  return { rowCount: prepared.length };
}

export function dropDatasetTable(db: DB, source: SourceRow): void {
  let table: string | null = null;
  try {
    table = source.meta_json ? (JSON.parse(source.meta_json) as { table?: string }).table ?? null : null;
  } catch {
    table = null;
  }
  if (table) db.exec(`DROP TABLE IF EXISTS "${table}"`);
}

export function datasetStats(db: DB, table: string): { rowCount: number; minDate: string | null; maxDate: string | null } {
  try {
    const row = db
      .prepare(`SELECT COUNT(*) AS n, MIN(transaction_date) AS minDate, MAX(transaction_date) AS maxDate FROM ${table}`)
      .get() as { n: number; minDate: string | null; maxDate: string | null };
    return { rowCount: row.n, minDate: row.minDate, maxDate: row.maxDate };
  } catch {
    return { rowCount: 0, minDate: null, maxDate: null };
  }
}
