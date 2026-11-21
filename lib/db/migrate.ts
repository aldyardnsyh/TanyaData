import fs from 'node:fs';
import { getWorkspaceDb, seedAvailable, type DB } from '@/lib/db/client';
import { resolveDocumentsJson } from '@/lib/db/paths';
import { chunkDocument } from '@/lib/ingest/chunker';
import { docSourceId, type DocumentsJson } from '@/lib/ingest/types';
import { nowJakartaIso } from '@/lib/date';
import { conflict } from '@/lib/errors';
import { registerSeedDataset } from '@/lib/core/registry';
import { ensureCoreV2Columns } from '@/lib/db/migrate-v2';

export const SCHEMA_VERSION = 1;
const SETTINGS_KEY = 'app';
const DOCS_INDEXED_AT = 'documents_indexed_at';

declare global {
  // eslint-disable-next-line no-var
  var __tanyadataReady: boolean | undefined;
}

type MetaRow = { value: string };

function upsertMeta(db: DB, key: string, value: string): void {
  db.prepare(
    'INSERT INTO app_meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, value);
}

export function readMeta(db: DB, key: string): string | null {
  const row = db.prepare('SELECT value FROM app_meta WHERE key = ?').get(key) as MetaRow | undefined;
  return row?.value ?? null;
}

function seedBounds(db: DB): { minDate: string; maxDate: string; rowCount: number } | null {
  if (!seedAvailable(db)) return null;
  const row = db
    .prepare(
      `SELECT COUNT(*) AS rowCount, MIN(transaction_date) AS minDate, MAX(transaction_date) AS maxDate
       FROM seed.transactions`,
    )
    .get() as { rowCount: number; minDate: string | null; maxDate: string | null };
  if (!row.minDate || !row.maxDate) return null;
  return { minDate: row.minDate, maxDate: row.maxDate, rowCount: row.rowCount };
}

export function defaultSettings(): Record<string, unknown> {
  const now = nowJakartaIso();
  return {
    profile: { name: 'Rani Prameswari', role: 'Operations Analyst' },
    lang: 'id',
    dateRange: { start: now.slice(0, 10), end: now.slice(0, 10), preset: 'this_month' },
    activeDatasetId: 'seed',
    preferences: { chartDefault: 'bar', denseTables: false },
    updatedAt: now,
  };
}

function ensureSettings(db: DB): void {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(SETTINGS_KEY) as MetaRow | undefined;
  if (row) return;
  db.prepare('INSERT INTO settings(key, value, updated_at) VALUES (?, ?, ?)').run(
    SETTINGS_KEY,
    JSON.stringify(defaultSettings()),
    nowJakartaIso(),
  );
}

function ensureSeedSource(db: DB): void {
  const bounds = seedBounds(db);
  if (!bounds) return;
  const now = nowJakartaIso();
  db.prepare(
    `INSERT INTO data_sources
       (id, kind, name, original_name, format, mime, size_bytes, status, row_count, chunk_count,
        error, storage_path, meta_json, created_at, updated_at)
     VALUES ('seed','dataset','analytics.db - Transaksi','analytics.db','seed-dataset','application/vnd.sqlite3',0,'READY',?,NULL,NULL,'analytics.db',?,?,?)
     ON CONFLICT(id) DO UPDATE SET row_count=excluded.row_count, meta_json=excluded.meta_json, updated_at=excluded.updated_at`,
  ).run(
    bounds.rowCount,
    JSON.stringify({ tables: 5, minDate: bounds.minDate, maxDate: bounds.maxDate }),
    now,
    now,
  );
}

function ensureDocuments(db: DB): void {
  const existing = db
    .prepare("SELECT COUNT(*) AS n FROM data_sources WHERE kind = 'document'")
    .get() as { n: number };
  if (existing.n > 0) return;

  const file = resolveDocumentsJson();
  if (!file) return;

  let parsed: DocumentsJson;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as DocumentsJson;
  } catch {
    return;
  }
  if (!Array.isArray(parsed.documents) || parsed.documents.length === 0) return;

  const now = nowJakartaIso();
  const insertSource = db.prepare(
    `INSERT OR IGNORE INTO data_sources
       (id, kind, name, original_name, format, mime, size_bytes, status, row_count, chunk_count,
        error, storage_path, meta_json, created_at, updated_at)
     VALUES (?, 'document', ?, ?, ?, ?, ?, 'READY', NULL, ?, NULL, ?, ?, ?, ?)`,
  );
  const insertChunk = db.prepare(
    `INSERT INTO document_chunks
       (source_id, doc_title, section_no, section, page, chunk_index, content, char_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const run = db.transaction(() => {
    for (const doc of parsed.documents) {
      const chunks = chunkDocument({ sections: doc.sections ?? [], docType: 'general' });
      const sourceId = docSourceId(doc.id);
      insertSource.run(
        sourceId,
        doc.title,
        doc.file,
        doc.format,
        doc.format === 'pdf' ? 'application/pdf' : doc.format === 'docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'text/plain',
        doc.sizeBytes ?? 0,
        chunks.length,
        doc.file,
        JSON.stringify({ docId: doc.id, pageCount: doc.pages?.length ?? 0, sections: doc.sections?.length ?? 0 }),
        now,
        now,
      );
      for (const chunk of chunks) {
        insertChunk.run(
          sourceId,
          doc.title,
          chunk.sectionNo,
          chunk.section,
          chunk.page,
          chunk.chunkIndex,
          chunk.content,
          chunk.charCount,
        );
      }
    }
  });
  run();
  upsertMeta(db, DOCS_INDEXED_AT, now);
}

/**
 * C2 — unifikasi chunk store: cermin dokumen workspace (data_sources +
 * document_chunks) ke tabel inti (core_datasets/core_documents/core_chunks)
 * sehingga attachment FR-C, scoping per dokumen, dan retrieval chat membaca
 * SATU sumber yang sama. Idempoten: sumber yang sudah terdaftar dilewati.
 */
function ensureDocumentsCoreMirror(db: DB): void {
  const sources = db
    .prepare(
      `SELECT * FROM data_sources
        WHERE kind = 'document' AND status = 'READY'
          AND id NOT IN (SELECT id FROM core_datasets)`,
    )
    .all() as Array<Record<string, unknown>>;
  for (const row of sources) {
    const id = String(row.id);
    const chunks = db
      .prepare('SELECT * FROM document_chunks WHERE source_id = ? ORDER BY chunk_index')
      .all(id) as Array<{ section: string; page: number | null; content: string; char_count: number; ocr_status: string; confidence: number | null }>;
    if (chunks.length === 0) continue;
    const now = nowJakartaIso();
    const docId = `doc_${id}`;
    const mirror = db.transaction(() => {
      db.prepare(
        `INSERT INTO core_datasets(id, name, kind, source_type, doc_type, status, schema_json, row_count, quality_report, storage_path, size_bytes, is_demo, created_at, updated_at)
         VALUES (?, ?, 'document', ?, 'general', 'READY', '{}', 0, '{}', ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO NOTHING`,
      ).run(id, String(row.name), String(row.format ?? 'txt'), row.storage_path ?? null, Number(row.size_bytes ?? 0), 0, now, now);
      db.prepare(
        `INSERT INTO core_documents(id, dataset_id, doc_type, mime, pages, sections_json, source_path, created_at)
         VALUES (?, ?, 'general', NULL, ?, '[]', ?, ?)
         ON CONFLICT(id) DO NOTHING`,
      ).run(docId, id, Math.max(1, ...chunks.map((c) => c.page ?? 1), 1), row.storage_path ?? null, now);
      db.prepare('DELETE FROM core_chunks WHERE dataset_id = ?').run(id);
      const insert = db.prepare(
        `INSERT INTO core_chunks
           (document_id, dataset_id, section_path, page, text, token_count, char_count, level, parent_id, embedding_json,
            content_hash, page_span, clean_version, clean_flags, ocr_status, confidence)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'child', NULL, NULL, NULL, NULL, 1, '[]', ?, ?)`,
      );
      for (const chunk of chunks) {
        insert.run(
          docId,
          id,
          chunk.section ?? '',
          chunk.page ?? null,
          chunk.content,
          Math.max(1, Math.ceil((chunk.char_count ?? 0) / 4)),
          chunk.char_count ?? 0,
          chunk.ocr_status ?? 'ok',
          chunk.confidence ?? 1,
        );
      }
    });
    mirror();
  }
}

export function ensureWorkspaceReady(): DB {
  const db = getWorkspaceDb();
  if (globalThis.__tanyadataReady) return db;

  if (!seedAvailable(db)) {
    throw conflict('Dataset seed tidak tersedia. Jalankan `npm run db:init` terlebih dahulu.');
  }

  upsertMeta(db, 'schema_version', String(SCHEMA_VERSION));
  ensureCoreV2Columns(db);
  ensureSettings(db);
  ensureSeedSource(db);
  registerSeedDataset(db);
  ensureDocuments(db);
  ensureDocumentsCoreMirror(db);
  upsertMeta(db, 'ready_at', nowJakartaIso());

  globalThis.__tanyadataReady = true;
  return db;
}

export function resetReadyFlag(): void {
  globalThis.__tanyadataReady = false;
}
