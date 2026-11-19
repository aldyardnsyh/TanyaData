import fs from 'node:fs';
import path from 'node:path';
import type { DB } from '@/lib/db/client';
import { UPLOADS_DIR } from '@/lib/db/paths';
import type { IngestionJob, SourceListItem, SourceStatus, SourceKind } from '@/lib/contracts/http';
import { notFound } from '@/lib/errors';
import { nowJakartaIso } from '@/lib/date';
import { randomUUID } from 'node:crypto';

export type SourceRow = {
  id: string;
  kind: SourceKind;
  name: string;
  original_name: string | null;
  format: string;
  mime: string | null;
  size_bytes: number;
  status: SourceStatus;
  row_count: number | null;
  chunk_count: number | null;
  error: string | null;
  storage_path: string | null;
  meta_json: string | null;
  created_at: string;
  updated_at: string;
};

export type JobRow = {
  id: string;
  source_id: string | null;
  kind: string;
  status: IngestionJob['status'];
  step: string | null;
  progress: number;
  message: string | null;
  error: string | null;
  started_at: string;
  finished_at: string | null;
};

export type SourceMeta = {
  table?: string;
  tables?: number;
  pageCount?: number;
  sections?: number;
  minDate?: string;
  maxDate?: string;
  rowsParsed?: number;
  rowsRejected?: number;
  duplicateRows?: number;
  missingByColumn?: Record<string, number>;
  columns?: { name: string; type: string; nullable: boolean }[];
  docId?: string;
  indexedAt?: string;
};

export function newSourceId(): string {
  return `src_${randomUUID().replace(/-/g, '').slice(0, 8)}`;
}

export function newJobId(): string {
  return `job_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

export function parseMeta(row: SourceRow): SourceMeta {
  if (!row.meta_json) return {};
  try {
    return JSON.parse(row.meta_json) as SourceMeta;
  } catch {
    return {};
  }
}

export function sourceToDto(row: SourceRow, extras?: { tableCount?: number }): SourceListItem {
  const meta = parseMeta(row);
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    originalName: row.original_name,
    format: row.format,
    mime: row.mime,
    sizeBytes: row.size_bytes,
    status: row.status,
    rowCount: row.row_count,
    tableCount: row.kind === 'dataset' ? extras?.tableCount ?? meta.tables ?? 1 : null,
    chunkCount: row.chunk_count,
    pageCount: row.kind === 'document' ? meta.pageCount ?? null : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    error: row.error,
    meta:
      row.kind === 'dataset'
        ? { minDate: meta.minDate, maxDate: meta.maxDate, tables: meta.tables ?? extras?.tableCount ?? 1 }
        : null,
  };
}

export function getSourceRow(db: DB, id: string): SourceRow {
  const row = db.prepare('SELECT * FROM data_sources WHERE id = ?').get(id) as SourceRow | undefined;
  if (!row) throw notFound('Sumber data tidak ditemukan');
  return row;
}

export function findSourceRow(db: DB, id: string): SourceRow | null {
  return (db.prepare('SELECT * FROM data_sources WHERE id = ?').get(id) as SourceRow | undefined) ?? null;
}

export function createSource(
  db: DB,
  input: { id?: string; kind: SourceKind; name: string; originalName: string; format: string; mime: string; sizeBytes: number; storagePath: string },
): SourceRow {
  const id = input.id ?? newSourceId();
  const now = nowJakartaIso();
  db.prepare(
    `INSERT INTO data_sources
       (id, kind, name, original_name, format, mime, size_bytes, status, row_count, chunk_count,
        error, storage_path, meta_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'PROCESSING', NULL, NULL, NULL, ?, NULL, ?, ?)`,
  ).run(
    id,
    input.kind,
    input.name,
    input.originalName,
    input.format,
    input.mime,
    input.sizeBytes,
    input.storagePath,
    now,
    now,
  );
  return getSourceRow(db, id);
}

export function updateSource(
  db: DB,
  id: string,
  patch: Partial<Pick<SourceRow, 'status' | 'row_count' | 'chunk_count' | 'error' | 'meta_json' | 'name'>>,
): void {
  const fields: string[] = [];
  const params: (string | number | null)[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    fields.push(`${key} = ?`);
    params.push(value as string | number | null);
  }
  if (!fields.length) return;
  fields.push('updated_at = ?');
  params.push(nowJakartaIso());
  params.push(id);
  db.prepare(`UPDATE data_sources SET ${fields.join(', ')} WHERE id = ?`).run(...params);
}

export function createJob(db: DB, sourceId: string, kind: string): JobRow {
  const id = newJobId();
  db.prepare(
    `INSERT INTO ingestion_jobs
       (id, source_id, kind, status, step, progress, message, error, started_at, finished_at)
     VALUES (?, ?, ?, 'RUNNING', 'queued', 0, NULL, NULL, ?, NULL)`,
  ).run(id, sourceId, kind, nowJakartaIso());
  return getJob(db, id);
}

export function getJob(db: DB, id: string): JobRow {
  const row = db.prepare('SELECT * FROM ingestion_jobs WHERE id = ?').get(id) as JobRow | undefined;
  if (!row) throw notFound('Job tidak ditemukan');
  return row;
}

export function jobForSource(db: DB, sourceId: string): JobRow | null {
  const row = db
    .prepare('SELECT * FROM ingestion_jobs WHERE source_id = ? ORDER BY started_at DESC LIMIT 1')
    .get(sourceId) as JobRow | undefined;
  return row ?? null;
}

export function updateJob(
  db: DB,
  id: string,
  patch: Partial<Pick<JobRow, 'status' | 'step' | 'progress' | 'message' | 'error'>> & { finished?: boolean },
): void {
  const fields: string[] = [];
  const params: (string | number | null)[] = [];
  for (const key of ['status', 'step', 'progress', 'message', 'error'] as const) {
    const value = patch[key];
    if (value === undefined) continue;
    fields.push(`${key} = ?`);
    params.push(value as string | number | null);
  }
  if (patch.finished) {
    fields.push('finished_at = ?');
    params.push(nowJakartaIso());
  }
  if (!fields.length) return;
  params.push(id);
  db.prepare(`UPDATE ingestion_jobs SET ${fields.join(', ')} WHERE id = ?`).run(...params);
}

export function jobDto(row: JobRow): IngestionJob {
  return {
    id: row.id,
    status: row.status,
    step: row.step,
    progress: row.progress,
    message: row.message,
    error: row.error,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

export function storagePathFor(sourceId: string, format: string): string {
  return path.join(UPLOADS_DIR, `${sourceId}.${format}`);
}

export function removeStoredFile(row: SourceRow): void {
  if (!row.storage_path) return;
  const target = path.isAbsolute(row.storage_path) ? row.storage_path : path.join(UPLOADS_DIR, row.storage_path);
  try {
    fs.rmSync(target, { force: true });
  } catch {
    // file mungkin tidak ada
  }
}

export function listSources(
  db: DB,
  filter: { kind?: SourceKind | null; status?: SourceStatus | null } = {},
): { items: SourceListItem[]; counts: { dataset: number; document: number; processing: number; failed: number } } {
  const clauses: string[] = [];
  const params: string[] = [];
  if (filter.kind) {
    clauses.push('kind = ?');
    params.push(filter.kind);
  }
  if (filter.status) {
    clauses.push('status = ?');
    params.push(filter.status);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db
    .prepare(
      `SELECT * FROM data_sources ${where}
       ORDER BY CASE WHEN id = 'seed' THEN 0 ELSE 1 END, created_at ASC, name ASC`,
    )
    .all(...params) as SourceRow[];

  const counts = db
    .prepare(
      `SELECT
         SUM(CASE WHEN kind='dataset' THEN 1 ELSE 0 END) AS dataset,
         SUM(CASE WHEN kind='document' THEN 1 ELSE 0 END) AS document,
         SUM(CASE WHEN status IN ('UPLOADED','PROCESSING') THEN 1 ELSE 0 END) AS processing,
         SUM(CASE WHEN status='FAILED' THEN 1 ELSE 0 END) AS failed
       FROM data_sources`,
    )
    .get() as { dataset: number | null; document: number | null; processing: number | null; failed: number | null };

  return {
    items: rows.map((row) => sourceToDto(row)),
    counts: {
      dataset: counts.dataset ?? 0,
      document: counts.document ?? 0,
      processing: counts.processing ?? 0,
      failed: counts.failed ?? 0,
    },
  };
}
