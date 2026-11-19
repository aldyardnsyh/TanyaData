import { getWorkspaceDb, seedAvailable, type DB } from '@/lib/db/client';
import { attachDataset } from '@/lib/ingest/dataset-store';
import { notFound, unprocessable } from '@/lib/errors';
import type { DatasetRef, Lang } from '@/lib/contracts/http';

export type Scope = {
  id: string;
  kind: 'seed' | 'upload';
  table: string;
  ref: DatasetRef;
};

type DatasetRow = {
  id: string;
  name: string;
  status: string;
  row_count: number | null;
  meta_json: string | null;
};

function boundsFor(db: DB, table: string): { rowCount: number; minDate: string; maxDate: string } | null {
  try {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS rowCount, MIN(transaction_date) AS minDate, MAX(transaction_date) AS maxDate FROM ${table}`,
      )
      .get() as { rowCount: number; minDate: string | null; maxDate: string | null };
    if (!row || !row.minDate || !row.maxDate) return null;
    return { rowCount: row.rowCount, minDate: row.minDate, maxDate: row.maxDate };
  } catch {
    return null;
  }
}

export function seedScope(db: DB = getWorkspaceDb()): Scope {
  if (!seedAvailable(db)) {
    throw unprocessable('Dataset seed tidak tersedia. Jalankan `npm run db:init`.');
  }
  const bounds = boundsFor(db, 'seed.transactions');
  if (!bounds) throw unprocessable('Dataset seed tidak memiliki transaksi.');
  return {
    id: 'seed',
    kind: 'seed',
    table: 'seed.transactions',
    ref: {
      id: 'seed',
      name: 'analytics.db - Transaksi',
      kind: 'seed',
      rowCount: bounds.rowCount,
      minDate: bounds.minDate,
      maxDate: bounds.maxDate,
    },
  };
}

export function resolveScope(datasetId: string | null | undefined, db: DB = getWorkspaceDb()): Scope {
  if (!datasetId || datasetId === 'seed') return seedScope(db);

  const row = db
    .prepare("SELECT id, name, status, row_count, meta_json FROM data_sources WHERE id = ? AND kind = 'dataset'")
    .get(datasetId) as DatasetRow | undefined;
  if (!row) throw notFound('Dataset tidak ditemukan');
  if (row.status !== 'READY') throw unprocessable('Dataset belum selesai diproses');

  let table: string;
  let metaTable: string | null = null;
  try {
    metaTable = row.meta_json ? ((JSON.parse(row.meta_json) as { table?: string }).table ?? null) : null;
  } catch {
    metaTable = null;
  }

  if (metaTable) {
    table = `main."${metaTable.replace(/"/g, '')}"`;
  } else {
    const alias = attachDataset(db, row.id);
    table = `${alias}.transactions`;
  }

  const bounds = boundsFor(db, table);
  if (!bounds) throw unprocessable('Dataset tidak memiliki tabel transaksi yang valid');

  return {
    id: row.id,
    kind: 'upload',
    table,
    ref: {
      id: row.id,
      name: row.name,
      kind: 'upload',
      rowCount: bounds.rowCount,
      minDate: bounds.minDate,
      maxDate: bounds.maxDate,
    },
  };
}

export function datasetChoices(db: DB = getWorkspaceDb()): { id: string; name: string; rowCount: number }[] {
  const seed = seedScope(db);
  const uploads = db
    .prepare(
      "SELECT id, name, row_count FROM data_sources WHERE kind = 'dataset' AND status = 'READY' AND id <> 'seed' ORDER BY created_at DESC",
    )
    .all() as { id: string; name: string; row_count: number | null }[];
  return [
    { id: seed.id, name: seed.ref.name, rowCount: seed.ref.rowCount },
    ...uploads.map((u) => ({ id: u.id, name: u.name, rowCount: u.row_count ?? 0 })),
  ];
}

export function datasetName(datasetId: string, db: DB = getWorkspaceDb()): string {
  if (datasetId === 'seed') return 'analytics.db - Transaksi';
  const row = db.prepare('SELECT name FROM data_sources WHERE id = ?').get(datasetId) as
    | { name: string }
    | undefined;
  return row?.name ?? datasetId;
}

export type { Lang };
