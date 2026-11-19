import fs from 'node:fs';
import path from 'node:path';
import type { DB } from '@/lib/db/client';
import { seedDocPath } from '@/lib/db/paths';
import { conflict, notFound, unprocessable } from '@/lib/errors';
import { readSettingsState } from '@/lib/settings';
import { datasetStats, dropDatasetTable, tableNameFor } from '@/lib/ingest/dataset';
import { ingestDocument } from '@/lib/ingest/documents';
import {
  createJob,
  findSourceRow,
  getJob,
  getSourceRow,
  jobDto,
  jobForSource,
  parseMeta,
  removeStoredFile,
  sourceToDto,
  updateSource,
  type SourceRow,
} from '@/lib/ingest/store';
import type {
  DocumentSourceDetail,
  DatasetSourceDetail,
  PreviewResponse,
  SourceDetailResponse,
  SourceListItem,
  SourceSchemaColumn,
  ReindexResponse,
} from '@/lib/contracts/http';

type ColumnRow = { name: string; sql_type: string; nullable: number };

function activeDatasetId(db: DB): string {
  try {
    return readSettingsState(db).activeDatasetId;
  } catch {
    return 'seed';
  }
}

export function sourceList(db: DB, kind?: SourceListItem['kind'] | null, status?: SourceListItem['status'] | null) {
  const params: string[] = [];
  const clauses: string[] = [];
  if (kind) {
    clauses.push('kind = ?');
    params.push(kind);
  }
  if (status) {
    clauses.push('status = ?');
    params.push(status);
  }
  const result = db
    .prepare(
      `SELECT * FROM data_sources
       ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
       ORDER BY CASE WHEN id='seed' THEN 0 ELSE 1 END, created_at ASC`,
    )
    .all(...params) as SourceRow[];
  const items = result.map((row) => sourceToDto(row));
  return { items, total: items.length };
}

export function sourceDetail(db: DB, id: string): SourceDetailResponse & { source: SourceListItem } {
  const row = getSourceRow(db, id);
  const jobRow = jobForSource(db, id);
  const job = jobRow ? jobDto(jobRow) : null;

  if (row.kind === 'dataset') {
    let tableName: string | null = null;
    let columns: SourceSchemaColumn[] = [];
    if (row.id === 'seed') {
      tableName = 'transactions';
      const info = db.prepare('PRAGMA seed.table_info(transactions)').all() as {
        name: string;
        type: string;
        notnull: number;
      }[];
      columns = info.map((c) => ({ name: c.name, type: c.type || 'TEXT', nullable: !c.notnull }));
    } else {
      const meta = parseMeta(row);
      tableName = meta.table ?? tableNameFor(row.id);
      const rows = db
        .prepare('SELECT name, sql_type, nullable FROM dataset_columns WHERE source_id = ? ORDER BY ordinal')
        .all(id) as ColumnRow[];
      columns = rows.map((c) => ({ name: c.name, type: c.sql_type, nullable: Boolean(c.nullable) }));
    }

    const meta = parseMeta(row);
    const quality =
      row.id === 'seed'
        ? null
        : {
            missingByColumn: meta.missingByColumn ?? {},
            duplicateRows: meta.duplicateRows ?? 0,
            rowsParsed: meta.rowsParsed ?? row.row_count ?? 0,
            rowsRejected: meta.rowsRejected ?? 0,
          };

    const detail: DatasetSourceDetail = {
      source: sourceToDto(row, { tableCount: meta.tables ?? 1 }),
      schema: tableName ? { tableName, columns } : null,
      quality,
      bounds: meta.minDate && meta.maxDate ? { minDate: meta.minDate, maxDate: meta.maxDate } : null,
      active: activeDatasetId(db) === row.id,
      job,
    };
    return detail;
  }

  const sections = db
    .prepare(
      `SELECT section_no, section, page, COUNT(*) AS chunkCount
       FROM document_chunks WHERE source_id = ?
       GROUP BY section_no, section, page
       ORDER BY MIN(id)`,
    )
    .all(id) as { section_no: number | null; section: string | null; page: number | null; chunkCount: number }[];

  const meta = parseMeta(row);
  const detail: DocumentSourceDetail = {
    source: sourceToDto(row),
    sections: sections.map((s) => ({
      no: s.section_no,
      title: s.section ?? row.name,
      page: s.page,
      chunkCount: s.chunkCount,
    })),
    index: {
      indexed: row.status === 'READY' && (row.chunk_count ?? 0) > 0,
      indexedAt: meta.indexedAt ?? row.updated_at,
      engine: 'fts5-bm25',
    },
    job,
  };
  return detail;
}

export function previewSource(db: DB, id: string, limit: number): PreviewResponse {
  const row = getSourceRow(db, id);

  if (row.kind === 'document') {
    const rows = db
      .prepare(
        'SELECT section, page, content FROM document_chunks WHERE source_id = ? ORDER BY chunk_index LIMIT ?',
      )
      .all(id, limit) as { section: string | null; page: number | null; content: string }[];
    return {
      columns: [
        { key: 'section', label: 'Section', type: 'TEXT' },
        { key: 'page', label: 'Page', type: 'INTEGER' },
        { key: 'quote', label: 'Quote', type: 'TEXT' },
      ],
      rows: rows.map((r) => ({ section: r.section, page: r.page, quote: r.content })),
      rowCount: row.chunk_count ?? rows.length,
      limit,
      truncated: (row.chunk_count ?? rows.length) > rows.length,
    };
  }

  let table: string;
  let columns: { key: string; label: string; type?: string }[] = [];
  if (row.id === 'seed') {
    table = 'seed.transactions';
    const info = db.prepare('PRAGMA seed.table_info(transactions)').all() as { name: string; type: string }[];
    columns = info
      .filter((c) => !c.name.endsWith('_json'))
      .map((c) => ({ key: c.name, label: c.name, type: c.type || 'TEXT' }));
  } else {
    const meta = parseMeta(row);
    table = `main."${(meta.table ?? tableNameFor(row.id)).replace(/"/g, '')}"`;
    const rows = db
      .prepare('SELECT name, sql_type FROM dataset_columns WHERE source_id = ? ORDER BY ordinal')
      .all(id) as { name: string; sql_type: string }[];
    columns = rows.map((c) => ({ key: c.name, label: c.name, type: c.sql_type }));
  }

  let rows: Record<string, unknown>[] = [];
  try {
    rows = db.prepare(`SELECT * FROM ${table} LIMIT ?`).all(limit) as Record<string, unknown>[];
  } catch {
    throw unprocessable('Tabel dataset tidak dapat dibaca');
  }
  const cleaned = rows.map((r) => {
    const out: Record<string, string | number | null> = {};
    for (const [key, value] of Object.entries(r)) {
      if (key === 'row_id' || key === 'extra_json') continue;
      out[key] = (value as string | number | null) ?? null;
    }
    return out;
  });

  const total = row.row_count ?? cleaned.length;
  return { columns, rows: cleaned, rowCount: total, limit, truncated: total > cleaned.length };
}

function runningJob(db: DB, sourceId: string): boolean {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM ingestion_jobs WHERE source_id = ? AND status IN ('QUEUED','RUNNING')")
    .get(sourceId) as { n: number };
  return row.n > 0;
}

export function removeSource(db: DB, id: string): void {
  const row = findSourceRow(db, id);
  if (!row) throw notFound('Sumber data tidak ditemukan');
  if (id === 'seed') throw conflict('Dataset seed tidak dapat dihapus');
  if (activeDatasetId(db) === id) throw conflict('Dataset sedang aktif dan tidak dapat dihapus');
  if (runningJob(db, id)) throw conflict('Sumber sedang diproses; tunggu hingga selesai');

  if (row.kind === 'dataset') dropDatasetTable(db, row);
  removeStoredFile(row);
  db.prepare('DELETE FROM data_sources WHERE id = ?').run(id);
}

function docFilePath(row: SourceRow): string {
  const stored = row.storage_path ?? '';
  if (stored && path.isAbsolute(stored) && fs.existsSync(stored)) return stored;
  if (stored && fs.existsSync(stored)) return stored;
  const seedPath = seedDocPath(stored || `${row.name}.${row.format}`);
  if (fs.existsSync(seedPath)) return seedPath;
  throw unprocessable('File sumber tidak ditemukan di storage', { reason: 'FILE_MISSING' });
}

export async function reindexSource(db: DB, id: string): Promise<ReindexResponse> {
  const row = getSourceRow(db, id);
  if (runningJob(db, id)) throw conflict('Job reindex lain sedang berjalan');

  if (row.kind === 'document') {
    const job = createJob(db, id, 'document');
    try {
      const file = docFilePath(row);
      const buffer = fs.readFileSync(file);
      await ingestDocument(db, row, buffer);
      const jobs = db
        .prepare("UPDATE ingestion_jobs SET status='DONE', step='done', progress=100, finished_at=? WHERE id=?")
        .run(new Date().toISOString(), job.id);
      void jobs;
      return { job: jobDto(getJob(db, job.id)) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      updateSource(db, id, { status: 'FAILED', error: message });
      db.prepare("UPDATE ingestion_jobs SET status='FAILED', step='failed', error=?, finished_at=? WHERE id=?").run(
        message,
        new Date().toISOString(),
        job.id,
      );
      throw error;
    }
  }

  if (id === 'seed') {
    const job = createJob(db, id, 'structured');
    const stats = datasetStats(db, 'seed.transactions');
    const meta = parseMeta(row);
    updateSource(db, id, {
      status: 'READY',
      row_count: stats.rowCount,
      meta_json: JSON.stringify({ ...meta, minDate: stats.minDate ?? meta.minDate, maxDate: stats.maxDate ?? meta.maxDate }),
    });
    db.prepare("UPDATE ingestion_jobs SET status='DONE', step='done', progress=100, finished_at=? WHERE id=?").run(
      new Date().toISOString(),
      job.id,
    );
    return { job: jobDto(getJob(db, job.id)) };
  }

  const job = createJob(db, id, 'structured');
  const meta = parseMeta(row);
  const table = meta.table ?? tableNameFor(id);
  const stats = datasetStats(db, `main."${table.replace(/"/g, '')}"`);
  if (!stats.minDate || !stats.maxDate) {
    db.prepare("UPDATE ingestion_jobs SET status='FAILED', step='failed', error=?, finished_at=? WHERE id=?").run(
      'Tabel dataset tidak memiliki tanggal valid',
      new Date().toISOString(),
      job.id,
    );
    throw unprocessable('Tabel dataset tidak memiliki tanggal valid');
  }
  updateSource(db, id, {
    status: 'READY',
    row_count: stats.rowCount,
    error: null,
    meta_json: JSON.stringify({ ...meta, rowCount: stats.rowCount, minDate: stats.minDate, maxDate: stats.maxDate }),
  });
  db.prepare("UPDATE ingestion_jobs SET status='DONE', step='done', progress=100, finished_at=? WHERE id=?").run(
    new Date().toISOString(),
    job.id,
  );
  return { job: jobDto(getJob(db, job.id)) };
}
