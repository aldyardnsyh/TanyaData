/**
 * Migrasi aditif CORE V2 untuk workspace DB yang sudah ada (DECISION-016).
 *
 * `core-schema.sql` sudah memuat kolom/tabel baru untuk DB segar (termasuk
 * eval harness). File ini menambahkan kolom ke DB lama secara idempoten via
 * PRAGMA table_info + ALTER TABLE. Reversible: DROP COLUMN / DROP TABLE.
 */

import type { DB } from '@/lib/db/client';
import { nowJakartaIso } from '@/lib/date';

const CHUNK_COLUMNS: Array<[string, string]> = [
  ['content_hash', 'TEXT'],
  ['page_span', 'TEXT'],
  ['clean_version', "INTEGER NOT NULL DEFAULT 0"],
  ['clean_flags', "TEXT NOT NULL DEFAULT '[]'"],
  ['ocr_status', "TEXT NOT NULL DEFAULT 'ok'"],
  ['confidence', 'REAL NOT NULL DEFAULT 1'],
  // Fase 2A — migrasi inkremental (reversible: DROP COLUMN). Kolom lama tetap
  // terbaca dengan nilai NULL/'[]' sehingga tidak ada backfill destruktif.
  ['char_start', 'INTEGER'],
  ['char_end', 'INTEGER'],
  ['unit_id', 'TEXT'],
  ['section_id', 'TEXT'],
  ['section_hash', 'TEXT'],
  ['units_json', "TEXT NOT NULL DEFAULT '[]'"],
  ['reading_order', 'TEXT'],
  ['layout_json', 'TEXT'],
  ['embed_text', 'TEXT'],
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

// P6-FIX / SEC-002 — expiry + revoke untuk share snapshot.
// Diekspor lewat ensureShareSnapshotColumns() agar bisa dijalankan lebih awal
// dari applySchema(), sebelum CREATE INDEX ix_core_share_expiry dieksekusi.
const SHARE_COLUMNS: Array<[string, string]> = [
  ['expires_at', 'TEXT'],
  ['revoked_at', 'TEXT'],
  ['revoked_reason', 'TEXT'],
];

/** Backfill: snapshot lama mendapat jendela 30 hari sejak migrasi dijalankan. */
const LEGACY_SHARE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function addColumns(db: DB, table: string, columns: Array<[string, string]>): void {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  const existing = new Set(rows.map((r) => r.name));
  for (const [name, decl] of columns) {
    if (!existing.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${decl}`);
  }
}

/**
 * P6-FIX / SEC-002 — migrasi inkremental untuk core_share_snapshots.
 *
 * Dipanggil dari applySchema() SEBELUM core-schema.sql dieksekusi, karena
 * schema segar memuat `CREATE INDEX ix_core_share_expiry ON
 * core_share_snapshots(expires_at)` yang akan gagal pada DB lama bila kolom
 * belum ada. Idempoten: cek PRAGMA table_info lalu ALTER TABLE per kolom.
 *
 * Pada DB baru tabel belum ada — fungsi sengaja no-op karena CREATE TABLE di
 * core-schema.sql sudah memuat ketiga kolom sekaligus. Tidak ada data yang
 * dihapus; snapshot lama hanya mendapat backfill expiry (30 hari).
 */
export function ensureShareSnapshotColumns(db: DB): void {
  const table = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'core_share_snapshots'")
    .get() as { name: string } | undefined;
  if (!table) return;

  addColumns(db, 'core_share_snapshots', SHARE_COLUMNS);
  db.prepare('UPDATE core_share_snapshots SET expires_at = ? WHERE expires_at IS NULL').run(
    nowJakartaIso(Date.now() + LEGACY_SHARE_TTL_MS),
  );
}

/* ------------------------------------------------------------------ Qdrant */

// DECISION-032 / ADR-QD-04 — outbox sinkronisasi Qdrant. Mengikuti pola
// `expires_at`: dipanggil dari applySchema() SEBELUM core-schema.sql sehingga
// DB lama yang belum punya tabel/kolom ini tidak gagal saat index dibuat.
// Idempoten dan reversible (DROP TABLE). Tidak ada data yang dihapus.
const QDRANT_OUTBOX_COLUMNS: Array<[string, string]> = [
  ['source_id', 'TEXT'],
  ['status', "TEXT NOT NULL DEFAULT 'pending'"],
  ['attempts', 'INTEGER NOT NULL DEFAULT 0'],
  ['last_error', 'TEXT'],
  ['next_attempt_at', 'TEXT'],
  ['updated_at', 'TEXT'],
];

const QDRANT_DELETE_COLUMNS: Array<[string, string]> = [
  ['attempts', 'INTEGER NOT NULL DEFAULT 0'],
  ['last_error', 'TEXT'],
  ['next_attempt_at', 'TEXT'],
  ['updated_at', 'TEXT'],
];

/**
 * Migrasi inkremental outbox Qdrant.
 *
 * - DB segar: tabel sudah ada di core-schema.sql → fungsi hanya menambahkan
 *   kolom yang mungkin hilang (defensif terhadap schema drift).
 * - DB lama: tabel dibuat di sini bila belum ada, sebelum core-schema.sql
 *   menjalankan CREATE INDEX. Sama seperti pola `expires_at` untuk share
 *   snapshot, sehingga tidak ada "no such column" saat index dibuat.
 */
export function ensureQdrantOutboxSchema(db: DB): void {
  const hasOutbox = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'qdrant_outbox'")
    .get() as { name: string } | undefined;
  if (!hasOutbox) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS qdrant_outbox(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chunk_id INTEGER NOT NULL,
        dataset_id TEXT NOT NULL,
        source_id TEXT,
        op TEXT NOT NULL CHECK(op IN ('upsert','delete_source')),
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','synced','failed')),
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        next_attempt_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(chunk_id, op)
      );
      CREATE INDEX IF NOT EXISTS ix_qdrant_outbox_pending ON qdrant_outbox(status, next_attempt_at, id);
      CREATE INDEX IF NOT EXISTS ix_qdrant_outbox_source ON qdrant_outbox(source_id);
    `);
  } else {
    addColumns(db, 'qdrant_outbox', QDRANT_OUTBOX_COLUMNS);
  }

  const hasDeletes = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'qdrant_pending_deletes'")
    .get() as { name: string } | undefined;
  if (!hasDeletes) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS qdrant_pending_deletes(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_id TEXT NOT NULL UNIQUE,
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        next_attempt_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  } else {
    addColumns(db, 'qdrant_pending_deletes', QDRANT_DELETE_COLUMNS);
  }
}

/**
 * Fase 2A — migrasi inkremental unit bukti untuk `core_chunks`.
 *
 * Dipanggil dari applySchema() SEBELUM core-schema.sql dieksekusi, karena
 * schema segar memuat `CREATE INDEX ix_core_chunks_section ON
 * core_chunks(document_id, section_id)` yang gagal dengan "no such column:
 * section_id" pada DB workspace lama. Sama seperti pola `expires_at` untuk
 * share snapshot dan outbox Qdrant.
 *
 * - DB segar: `core_chunks` belum ada (schema.sql legacy tidak membuatnya)
 *   → no-op; CREATE TABLE di core-schema.sql sudah memuat semua kolom.
 * - DB lama: tabel ada → tambahkan kolom yang hilang via PRAGMA table_info,
 *   lalu index aman dibuat oleh core-schema.sql. Tidak ada data yang dihapus;
 *   baris lama mendapat NULL / '[]' / default yang sudah didefinisikan.
 */
export function ensureCoreChunkColumns(db: DB): void {
  const table = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'core_chunks'")
    .get() as { name: string } | undefined;
  if (!table) return;

  addColumns(db, 'core_chunks', CHUNK_COLUMNS);
  db.exec('CREATE INDEX IF NOT EXISTS ix_core_chunks_section ON core_chunks(document_id, section_id)');
}

export function ensureCoreV2Columns(db: DB): void {
  ensureCoreChunkColumns(db);
  addColumns(db, 'core_citations', CITATION_COLUMNS);
  addColumns(db, 'conversations', CONVERSATION_COLUMNS);
  ensureShareSnapshotColumns(db);
  ensureQdrantOutboxSchema(db);
}
