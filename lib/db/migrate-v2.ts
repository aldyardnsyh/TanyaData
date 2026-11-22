/**
 * Migrasi aditif CORE V2 untuk workspace DB yang sudah ada (DECISION-016).
 *
 * `core-schema.sql` sudah memuat kolom/tabel baru untuk DB segar (termasuk
 * eval harness). File ini menambahkan kolom ke DB lama secara idempoten via
 * PRAGMA table_info + ALTER TABLE. Reversible: DROP COLUMN / DROP TABLE.
 */

import type { DB } from '@/lib/db/client';

const CHUNK_COLUMNS: Array<[string, string]> = [
  ['content_hash', 'TEXT'],
  ['page_span', 'TEXT'],
  ['clean_version', "INTEGER NOT NULL DEFAULT 0"],
  ['clean_flags', "TEXT NOT NULL DEFAULT '[]'"],
  ['ocr_status', "TEXT NOT NULL DEFAULT 'ok'"],
  ['confidence', 'REAL NOT NULL DEFAULT 1'],
];

const CITATION_COLUMNS: Array<[string, string]> = [
  ['page_end', 'INTEGER'],
  ['rev', 'TEXT'],
  ['deep_link', 'TEXT'],
  ['status', "TEXT NOT NULL DEFAULT 'valid'"],
  ['reject_reason', 'TEXT'],
];

// Pengelompokan + penyematan percakapan (NotebookLM-style sidebar).
const CONVERSATION_COLUMNS: Array<[string, string]> = [
  ['group_name', 'TEXT'],
  ['pinned', "INTEGER NOT NULL DEFAULT 0"],
];

function addColumns(db: DB, table: string, columns: Array<[string, string]>): void {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  const existing = new Set(rows.map((r) => r.name));
  for (const [name, decl] of columns) {
    if (!existing.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${decl}`);
  }
}

export function ensureCoreV2Columns(db: DB): void {
  addColumns(db, 'core_chunks', CHUNK_COLUMNS);
  addColumns(db, 'core_citations', CITATION_COLUMNS);
  addColumns(db, 'conversations', CONVERSATION_COLUMNS);
}
