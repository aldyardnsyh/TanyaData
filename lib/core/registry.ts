/**
 * Dataset registry — CRUD metadata di workspace DB (tabel core_*).
 * Seed `analytics.db` tidak pernah ditulis; ia hanya didaftarkan sebagai
 * SATU dataset demo lewat `registerSeedDataset` (DECISION-014).
 */

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import type { DB } from '@/lib/db/client';
import { resolveSeedDb } from '@/lib/db/paths';
import { nowJakartaIso } from '@/lib/date';
import { notFound } from '@/lib/errors';
import { invalidateQueryCache } from '@/lib/core/cache';
import type {
  Dataset,
  DatasetKind,
  DatasetStatus,
  DocType,
  IngestionStep,
  IngestionStepStatus,
  QualityReport,
  SchemaJson,
  SourceType,
} from '@/lib/core/contracts';

export function hashJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function newDatasetId(): string {
  return `ds_${randomBytes(6).toString('hex')}`;
}

export function newDocumentId(): string {
  return `doc_${randomBytes(6).toString('hex')}`;
}

export function emptyQualityReport(): QualityReport {
  return {
    parsedPages: 0,
    tablesFound: 0,
    ocrUsed: false,
    issues: [],
    rowsParsed: 0,
    rowsRejected: 0,
    duplicateRows: 0,
    missingByColumn: {},
  };
}

export function emptySchema(hash = hashJson({ tables: [] })): SchemaJson {
  return { version: 1, hash, tables: [], relations: [], enums: {} };
}

type DatasetRow = {
  id: string;
  name: string;
  kind: DatasetKind;
  source_type: SourceType;
  doc_type: DocType;
  status: DatasetStatus;
  schema_json: string;
  row_count: number;
  period_start: string | null;
  period_end: string | null;
  quality_report: string;
  storage_path: string | null;
  sha256: string | null;
  size_bytes: number;
  is_demo: number;
  created_at: string;
  updated_at: string;
};

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * Schema_json lama bisa berupa `'{}'` (cermin pra-C2): JSON valid tapi tanpa
 * `tables`, yang membuat buildRuleBasedCandidate crash. Normalisasi bentuknya,
 * bukan hanya validitas JSON-nya.
 */
function parseSchema(raw: string): SchemaJson {
  const parsed = parseJson<Partial<SchemaJson> | null>(raw, emptySchema());
  if (!parsed || !Array.isArray(parsed.tables)) return emptySchema();
  return {
    version: parsed.version ?? 1,
    hash: parsed.hash ?? hashJson({ tables: parsed.tables }),
    tables: parsed.tables,
    relations: parsed.relations ?? [],
    enums: parsed.enums ?? {},
  };
}

export function rowToDataset(row: DatasetRow): Dataset {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    source_type: row.source_type,
    doc_type: row.doc_type,
    status: row.status,
    schema_json: parseSchema(row.schema_json),
    row_count: row.row_count,
    period_start: row.period_start,
    period_end: row.period_end,
    quality_report: parseJson<QualityReport>(row.quality_report, emptyQualityReport()),
    storage_path: row.storage_path,
    sha256: row.sha256,
    size_bytes: row.size_bytes,
    is_demo: row.is_demo === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export type CreateDatasetInput = {
  id?: string;
  name: string;
  kind: DatasetKind;
  source_type: SourceType;
  doc_type?: DocType;
  status?: DatasetStatus;
  schema_json?: SchemaJson;
  row_count?: number;
  period_start?: string | null;
  period_end?: string | null;
  quality_report?: QualityReport;
  storage_path?: string | null;
  sha256?: string | null;
  size_bytes?: number;
  is_demo?: boolean;
};

export function createDataset(db: DB, input: CreateDatasetInput): Dataset {
  const id = input.id ?? newDatasetId();
  const now = nowJakartaIso();
  const schema = input.schema_json ?? emptySchema();
  db.prepare(
    `INSERT INTO core_datasets
       (id, name, kind, source_type, doc_type, status, schema_json, row_count,
        period_start, period_end, quality_report, storage_path, sha256, size_bytes,
        is_demo, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.name,
    input.kind,
    input.source_type,
    input.doc_type ?? 'unknown',
    input.status ?? 'UPLOADED',
    JSON.stringify(schema),
    input.row_count ?? 0,
    input.period_start ?? null,
    input.period_end ?? null,
    JSON.stringify(input.quality_report ?? emptyQualityReport()),
    input.storage_path ?? null,
    input.sha256 ?? null,
    input.size_bytes ?? 0,
    input.is_demo ? 1 : 0,
    now,
    now,
  );
  return getDataset(db, id);
}

export function getDataset(db: DB, id: string): Dataset {
  const row = db.prepare('SELECT * FROM core_datasets WHERE id = ?').get(id) as DatasetRow | undefined;
  if (!row) throw notFound(`Dataset ${id} tidak ditemukan`);
  return rowToDataset(row);
}

export function findDataset(db: DB, id: string): Dataset | null {
  const row = db.prepare('SELECT * FROM core_datasets WHERE id = ?').get(id) as DatasetRow | undefined;
  return row ? rowToDataset(row) : null;
}

export function listDatasets(db: DB, options: { limit?: number; offset?: number; status?: DatasetStatus } = {}): {
  items: Dataset[];
  total: number;
} {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
  const offset = Math.max(options.offset ?? 0, 0);
  const where = options.status ? 'WHERE status = ?' : '';
  const params = options.status ? [options.status] : [];
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM core_datasets ${where}`).get(...params) as { n: number }).n;
  const rows = db
    .prepare(`SELECT * FROM core_datasets ${where} ORDER BY is_demo DESC, created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as DatasetRow[];
  return { items: rows.map(rowToDataset), total };
}

export type UpdateDatasetInput = Partial<{
  name: string;
  kind: DatasetKind;
  source_type: SourceType;
  doc_type: DocType;
  status: DatasetStatus;
  schema_json: SchemaJson;
  row_count: number;
  period_start: string | null;
  period_end: string | null;
  quality_report: QualityReport;
  storage_path: string | null;
  sha256: string | null;
  size_bytes: number;
}>;

const COLUMN_BY_KEY: Record<keyof UpdateDatasetInput, string> = {
  name: 'name',
  kind: 'kind',
  source_type: 'source_type',
  doc_type: 'doc_type',
  status: 'status',
  schema_json: 'schema_json',
  row_count: 'row_count',
  period_start: 'period_start',
  period_end: 'period_end',
  quality_report: 'quality_report',
  storage_path: 'storage_path',
  sha256: 'sha256',
  size_bytes: 'size_bytes',
};

export function updateDataset(db: DB, id: string, patch: UpdateDatasetInput): Dataset {
  getDataset(db, id);
  const entries = Object.entries(patch).filter(([, value]) => value !== undefined) as Array<
    [keyof UpdateDatasetInput, unknown]
  >;
  if (entries.length === 0) return getDataset(db, id);
  const sets = entries.map(([key]) => `${COLUMN_BY_KEY[key]} = ?`);
  const values = entries.map(([key, value]) => {
    if (key === 'schema_json') return JSON.stringify(value);
    if (key === 'quality_report') return JSON.stringify(value);
    return value;
  });
  db.prepare(`UPDATE core_datasets SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`).run(
    ...values,
    nowJakartaIso(),
    id,
  );
  return getDataset(db, id);
}

/** Hapus metadata + tabel data fisik milik dataset. Tidak menyentuh `seed.*`. */
export function deleteDataset(db: DB, id: string): void {
  const dataset = getDataset(db, id);
  const physical = dataset.schema_json.tables
    .map((table) => table.name)
    .filter((name) => name.startsWith('core_data_'));
  db.transaction(() => {
    for (const table of physical) {
      db.exec(`DROP TABLE IF EXISTS "${table.replace(/"/g, '')}"`);
    }
    db.prepare('DELETE FROM core_datasets WHERE id = ?').run(id);
    invalidateQueryCache(db);
  })();
}

export function getSchema(db: DB, id: string): SchemaJson {
  return getDataset(db, id).schema_json;
}

export function setSchema(db: DB, id: string, schema: SchemaJson): Dataset {
  return updateDataset(db, id, { schema_json: schema });
}

/* ------------------------------------------------------------ ingestion log */

export function recordStep(
  db: DB,
  datasetId: string,
  step: string,
  status: IngestionStepStatus,
  durationMs: number,
  error: string | null = null,
): void {
  const now = nowJakartaIso();
  db.prepare(
    `INSERT INTO core_ingestion_steps(dataset_id, step, status, duration_ms, error, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(dataset_id, step) DO UPDATE SET
       status = excluded.status, duration_ms = excluded.duration_ms,
       error = excluded.error, updated_at = excluded.updated_at`,
  ).run(datasetId, step, status, durationMs, error, now, now);
}

export function listSteps(db: DB, datasetId: string): IngestionStep[] {
  return db
    .prepare('SELECT * FROM core_ingestion_steps WHERE dataset_id = ? ORDER BY created_at, step')
    .all(datasetId) as IngestionStep[];
}

/* ------------------------------------------------------------- seed adapter */

type SeedColumn = { name: string; type: string; notnull: number; pk: number };

const DATE_NAME_RE = /(date|tanggal|time|waktu|period|periode)/i;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}/;

function inferSeedType(decl: string): 'integer' | 'number' | 'text' {
  const t = decl.toUpperCase();
  if (t.includes('INT')) return 'integer';
  if (t.includes('REAL') || t.includes('FLOAT') || t.includes('DOUBLE') || t.includes('NUMERIC')) return 'number';
  return 'text';
}

/**
 * Adapter demo: mendaftarkan analytics.db sebagai SATU dataset. Skema dibangun
 * dari PRAGMA table_info + sampel nilai — bukan dari daftar kolom hardcoded.
 */
export function registerSeedDataset(db: DB): Dataset | null {
  const existing = findDataset(db, 'demo-qris-v1');
  if (existing) return existing;

  let seedPath: string;
  try {
    seedPath = resolveSeedDb();
    fs.accessSync(seedPath, fs.constants.R_OK);
  } catch {
    return null;
  }

  let seed: Database.Database;
  try {
    seed = new Database(seedPath, { readonly: true, fileMustExist: true });
  } catch {
    return null;
  }

  try {
    const names = seed
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all() as Array<{ name: string }>;
    const tables = names.map(({ name }) => {
      const info = seed.prepare(`PRAGMA table_info("${name.replace(/"/g, '')}")`).all() as SeedColumn[];
      const rowCount = (seed.prepare(`SELECT COUNT(*) AS n FROM "${name.replace(/"/g, '')}"`).get() as { n: number }).n;
      const columns = info.map((col, ordinal) => {
        const inferred = inferSeedType(col.type);
        const sampleRows = seed
          .prepare(`SELECT "${col.name.replace(/"/g, '')}" AS v FROM "${name.replace(/"/g, '')}" LIMIT 8`)
          .all() as Array<{ v: unknown }>;
        const values = sampleRows.map((r) => r.v).filter((v) => v !== null && v !== undefined);
        const distinct = new Set(values.map(String)).size;
        const looksDate = values.length > 0 && values.every((v) => ISO_DATE_RE.test(String(v)));
        const role = looksDate || DATE_NAME_RE.test(col.name)
          ? 'time'
          : inferred === 'number'
            ? 'measure'
            : distinct <= Math.max(2, Math.min(20, rowCount)) && /^(id|kode|code|no|number)/i.test(col.name)
              ? 'identifier'
              : distinct <= Math.max(2, Math.min(20, rowCount))
                ? 'dimension'
                : 'text';
        return {
          name: col.name,
          sourceName: col.name,
          inferred_type: inferred,
          semantic_role: role as 'time' | 'measure' | 'identifier' | 'dimension' | 'text',
          nullable: col.notnull === 0,
          distinct_count: distinct,
          sample_values: values.slice(0, 5) as Array<string | number | boolean | null>,
          unit: null,
          description: null,
        };
      });
      const dateColumn = columns.find((c) => c.semantic_role === 'time')?.name ?? null;
      return {
        name: `seed.${name}`,
        sourceName: name,
        rowCount,
        columns,
        dateColumn,
      };
    });

    const schema: SchemaJson = {
      version: 1,
      hash: hashJson({ tables: tables.map((t) => ({ name: t.name, columns: t.columns.map((c) => c.name) })) }),
      tables,
      relations: [],
      enums: {},
    };
    const allDates = tables.flatMap((t) => (t.dateColumn ? [t.dateColumn] : []));
    const bounds: Array<{ lo: string; hi: string }> = [];
    for (const table of tables) {
      if (!table.dateColumn) continue;
      const col = table.dateColumn.replace(/"/g, '');
      const name = table.sourceName.replace(/"/g, '');
      const row = seed.prepare(`SELECT MIN("${col}") AS lo, MAX("${col}") AS hi FROM "${name}"`).get() as {
        lo: string | null;
        hi: string | null;
      };
      if (row.lo && row.hi) bounds.push({ lo: row.lo, hi: row.hi });
    }

    return createDataset(db, {
      id: 'demo-qris-v1',
      name: 'Data demo · Transaksi QRIS',
      kind: 'tabular',
      source_type: 'sqlite',
      doc_type: 'general',
      status: 'READY',
      schema_json: schema,
      row_count: tables.find((t) => t.sourceName === 'transactions')?.rowCount ?? tables[0]?.rowCount ?? 0,
      period_start: bounds.length ? bounds.map((b) => b.lo).sort()[0] : null,
      period_end: bounds.length ? bounds.map((b) => b.hi).sort().at(-1) ?? null : null,
      quality_report: { ...emptyQualityReport(), tablesFound: tables.length, issues: allDates.length ? [] : ['Tidak ada kolom waktu terdeteksi'] },
      storage_path: 'analytics.db',
      sha256: null,
      size_bytes: 0,
      is_demo: true,
    });
  } finally {
    seed.close();
  }
}
