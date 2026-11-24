/**
 * TanyaData — Qdrant sync / outbox (P3-MIGRATION / DECISION-032, ADR-QD-04).
 *
 * Prinsip: SQLite commit dulu, Qdrant mengikuti. Qdrant adalah derived index
 * yang bisa dibangun ulang; SQLite tidak. Semua fungsi di sini:
 *   - NO-OP total saat QDRANT_MODE=off (perilaku identik dengan sebelum migrasi);
 *   - TIDAK pernah melempar exception ke pemanggil (ingest/removeSource tidak
 *     boleh gagal hanya karena Qdrant mati);
 *   - mencatat error yang sudah diredaksi, bukan API key / stack trace.
 *
 * Point ID = core_chunks.id → upsert berulang idempoten.
 */

import { nowJakartaIso } from '@/lib/date';
import { embedDocuments, isEmbeddingEnabled } from '@/lib/ai/embedding';
import { normalizeForFts } from '@/lib/core/stem';
import type { DB } from '@/lib/db/client';
import {
  getQdrantClient,
  getQdrantConfig,
  isQdrantEnabled,
  redactQdrantError,
} from '@/lib/qdrant/client';
import { ensureQdrantCollection } from '@/lib/qdrant/collections';

const MAX_ATTEMPTS = 5;
const RETRY_BASE_MS = 5_000;
const RETRY_CAP_MS = 60_000;

export interface SyncChunkRow {
  id: number;
  dataset_id: string;
  document_id: string;
  section_path: string;
  page: number | null;
  text: string;
  level: string;
  ocr_status: string | null;
  content_hash: string | null;
  /** Fase 2A: teks dengan prefix kontekstual `[Nama Dokumen | Bagian n: Judul]`. */
  embed_text?: string | null;
}

export interface SyncSummary {
  enabled: boolean;
  attempted: number;
  succeeded: number;
  failed: number;
  tombstoned: number;
  error: string | null;
}

function emptySummary(): SyncSummary {
  return { enabled: false, attempted: 0, succeeded: 0, failed: 0, tombstoned: 0, error: null };
}

function nextAttemptIso(attempts: number): string {
  const delay = Math.min(RETRY_BASE_MS * Math.max(1, attempts), RETRY_CAP_MS);
  return nowJakartaIso(Date.now() + delay);
}

/* ------------------------------------------------------------- enqueue (sync) */

/**
 * Tulis op upsert ke outbox. Dipanggil DI DALAM transaksi SQLite yang sama
 * dengan INSERT core_chunks. Tidak melakukan I/O ke Qdrant.
 */
export function enqueueUpserts(
  db: DB,
  chunkIds: number[],
  datasetId: string,
  sourceId?: string | null,
): void {
  if (!isQdrantEnabled() || !chunkIds.length) return;
  const now = nowJakartaIso();
  const source = sourceId ?? datasetId;
  // Idempoten by (chunk_id, op): satu baris per chunk, tidak pernah duplikat.
  // ON CONFLICT DO UPDATE juga mengembalikan baris yang SUDAH 'synced' ke
  // 'pending'. Ini wajib untuk reindex: deleteBySource() mengosongkan point
  // Qdrant lebih dulu, sementara chunk yang tidak berubah tidak masuk
  // insertedIds dari replaceIndexedChunks(). Tanpa reset ini, enqueue ulang
  // diabaikan → drainOutbox attempted=0 → Qdrant tetap kosong (bug reindex).
  const insert = db.prepare(
    `INSERT INTO qdrant_outbox
       (chunk_id, dataset_id, source_id, op, status, attempts, created_at, updated_at)
     VALUES (?, ?, ?, 'upsert', 'pending', 0, ?, ?)
     ON CONFLICT(chunk_id, op) DO UPDATE SET
       dataset_id = excluded.dataset_id,
       source_id = excluded.source_id,
       status = 'pending',
       attempts = 0,
       last_error = NULL,
       next_attempt_at = NULL,
       updated_at = excluded.updated_at`,
  );
  db.transaction(() => {
    for (const id of chunkIds) {
      if (!Number.isInteger(id) || id <= 0) continue;
      insert.run(id, datasetId, source, now, now);
    }
  })();
}

/** Tombstone penghapusan sumber. Dipakai bila Qdrant sedang tidak bisa dihubungi. */
export function markTombstone(db: DB, sourceId: string): void {
  if (!isQdrantEnabled() || !String(sourceId ?? '').trim()) return;
  const now = nowJakartaIso();
  db.prepare(
    `INSERT OR IGNORE INTO qdrant_pending_deletes
       (source_id, attempts, created_at, updated_at)
     VALUES (?, 0, ?, ?)`,
  ).run(sourceId, now, now);
}

/* --------------------------------------------------------------- point builder */

function buildPayload(row: SyncChunkRow, sourceId: string): Record<string, unknown> {
  return {
    chunk_id: row.id,
    doc_id: row.document_id,
    dataset_id: row.dataset_id,
    source_id: sourceId,
    section_path: row.section_path,
    page: row.page,
    // rev mengikuti content_hash; sitasi tetap di-hidrasi dari SQLite (fail-closed).
    rev: row.content_hash ?? '',
    level: row.level,
    parse_ok: row.ocr_status !== 'ocr_skipped',
    // Snowball Qdrant tidak punya Indonesian → teks sudah di-stem di aplikasi.
    text_fts: normalizeForFts(row.text),
    // Salinan mentah untuk referensi; BUKAN sumber teks sitasi.
    text: row.text,
  };
}

async function buildPoints(rows: SyncChunkRow[], sourceId: string): Promise<Array<{
  id: number;
  vector: Record<string, unknown>;
  payload: Record<string, unknown>;
}>> {
  const cfg = getQdrantConfig();
  // Fase B saja. Default off → tidak ada model yang dimuat, tidak ada jaringan.
  const dense = isEmbeddingEnabled() ? await embedDocuments(rows.map((r) => r.text)) : null;
  return rows.map((row, index) => {
    const candidate = dense?.[index];
    const vector: Record<string, unknown> = {};
    if (
      Array.isArray(candidate) &&
      candidate.length === cfg.vectorSize &&
      candidate.every((n) => Number.isFinite(n))
    ) {
      vector[cfg.denseVector] = candidate;
    }
    return { id: row.id, vector, payload: buildPayload(row, sourceId ?? row.dataset_id) };
  });
}

/* ------------------------------------------------------------------- upsert */

/** Upsert sekumpulan chunk. Dipakai oleh drainOutbox dan reindex eksplisit. */
export async function upsertChunks(db: DB, chunkIds: number[], sourceId?: string | null): Promise<SyncSummary> {
  const summary = emptySummary();
  if (!isQdrantEnabled() || !chunkIds.length) return summary;
  summary.enabled = true;
  summary.attempted = chunkIds.length;

  const placeholders = chunkIds.map(() => '?').join(',');
  const rows = db
    .prepare(`SELECT * FROM core_chunks WHERE id IN (${placeholders})`)
    .all(...chunkIds) as SyncChunkRow[];
  if (!rows.length) return summary;

  try {
    await ensureQdrantCollection();
    const cfg = getQdrantConfig();
    const client = await getQdrantClient();
    const points = await buildPoints(rows, sourceId ?? rows[0]?.dataset_id ?? '');
    await client.upsert(cfg.collection, { points, wait: cfg.wait });
    summary.succeeded = points.length;

    const now = nowJakartaIso();
    const mark = db.prepare(
      `UPDATE qdrant_outbox
          SET status = 'synced', attempts = attempts + 1, last_error = NULL, updated_at = ?
        WHERE chunk_id = ? AND op = 'upsert'`,
    );
    db.transaction(() => {
      for (const row of rows) mark.run(now, row.id);
    })();
  } catch (error) {
    summary.failed = rows.length;
    summary.error = redactQdrantError(error);
  }
  return summary;
}

/* ------------------------------------------------------------------- delete */

/**
 * Hapus semua point untuk sebuah source_id. Dipanggil SEBELUM reindex (karena
 * newDocumentId() menghasilkan chunk_id baru) dan sebelum removeSource.
 * Kegagalan → tombstone, penghapusan SQLite tetap jalan.
 */
export async function deleteBySource(db: DB, sourceId: string): Promise<SyncSummary> {
  const summary = emptySummary();
  const id = String(sourceId ?? '').trim();
  if (!isQdrantEnabled() || !id) return summary;
  summary.enabled = true;
  summary.attempted = 1;

  try {
    const cfg = getQdrantConfig();
    const client = await getQdrantClient();
    await client.delete(cfg.collection, {
      filter: { must: [{ key: 'source_id', match: { value: id } }] },
      wait: cfg.wait,
    });
    summary.succeeded = 1;
    const now = nowJakartaIso();
    db.prepare(
      `UPDATE qdrant_outbox
          SET status = 'synced', attempts = attempts + 1, last_error = NULL, updated_at = ?
        WHERE source_id = ? AND op = 'delete_source' AND status = 'pending'`,
    ).run(now, id);
  } catch (error) {
    summary.failed = 1;
    summary.error = redactQdrantError(error);
    markTombstone(db, id);
    summary.tombstoned = 1;
  }
  return summary;
}

/* -------------------------------------------------------------------- drain */

type OutboxRow = {
  id: number;
  chunk_id: number;
  source_id: string | null;
  op: 'upsert' | 'delete_source';
  attempts: number;
};

/**
 * Kurasi outbox + tombstone. Tidak pernah melempar exception. Aman dipanggil
 * dari route handler maupun script; saat mode off langsung kembali.
 */
export async function drainOutbox(db: DB): Promise<SyncSummary> {
  const summary = emptySummary();
  if (!isQdrantEnabled()) return summary;
  summary.enabled = true;

  try {
    await ensureQdrantCollection();
  } catch (error) {
    summary.error = redactQdrantError(error);
    return summary;
  }

  const cfg = getQdrantConfig();
  const now = nowJakartaIso();
  const rows = db
    .prepare(
      `SELECT id, chunk_id, source_id, op, attempts FROM qdrant_outbox
        WHERE status = 'pending' AND attempts < ?
          AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
        ORDER BY id LIMIT ?`,
    )
    .all(MAX_ATTEMPTS, now, cfg.batchSize) as OutboxRow[];

  const upsertIds = rows.filter((r) => r.op === 'upsert').map((r) => r.chunk_id);
  const deleteSources = [
    ...new Set(rows.filter((r) => r.op === 'delete_source').map((r) => String(r.source_id ?? '')).filter(Boolean)),
  ];

  if (upsertIds.length) {
    const result = await upsertChunks(db, upsertIds);
    summary.attempted += result.attempted;
    summary.succeeded += result.succeeded;
    summary.failed += result.failed;
    if (result.error) summary.error = result.error;
  }

  if (deleteSources.length) {
    try {
      const client = await getQdrantClient();
      for (const source of deleteSources) {
        await client.delete(cfg.collection, {
          filter: { must: [{ key: 'source_id', match: { value: source } }] },
          wait: cfg.wait,
        });
        summary.attempted += 1;
        summary.succeeded += 1;
        db.prepare(
          `UPDATE qdrant_outbox
              SET status = 'synced', attempts = attempts + 1, last_error = NULL, updated_at = ?
            WHERE source_id = ? AND op = 'delete_source' AND status = 'pending'`,
        ).run(now, source);
      }
    } catch (error) {
      summary.error = redactQdrantError(error);
    }
  }

  // Retry dengan backoff untuk baris yang masih pending (upsert gagal atau
  // delete yang tidak ikut terproses di loop atas).
  const retry = db.prepare(
    `UPDATE qdrant_outbox
        SET attempts = attempts + 1, last_error = ?, next_attempt_at = ?, updated_at = ?
      WHERE id = ? AND status = 'pending'`,
  );
  const fail = db.prepare(
    `UPDATE qdrant_outbox SET status = 'failed', last_error = ?, updated_at = ? WHERE id = ? AND status = 'pending'`,
  );
  db.transaction(() => {
    for (const row of rows) {
      const current = db
        .prepare("SELECT status, attempts FROM qdrant_outbox WHERE id = ?")
        .get(row.id) as { status: string; attempts: number } | undefined;
      if (!current || current.status !== 'pending') continue;
      if (current.attempts + 1 >= MAX_ATTEMPTS) {
        fail.run(summary.error ?? 'retry_exhausted', now, row.id);
      } else {
        retry.run(summary.error ?? 'pending', nextAttemptIso(current.attempts + 1), now, row.id);
      }
    }
  })();

  // Tombstone: hapus point yang tertunda saat Qdrant sedang mati.
  const tombstones = db
    .prepare(
      `SELECT id, source_id, attempts FROM qdrant_pending_deletes
        WHERE (next_attempt_at IS NULL OR next_attempt_at <= ?) ORDER BY id LIMIT ?`,
    )
    .all(now, cfg.batchSize) as Array<{ id: number; source_id: string; attempts: number }>;
  for (const tomb of tombstones) {
    try {
      const client = await getQdrantClient();
      await client.delete(cfg.collection, {
        filter: { must: [{ key: 'source_id', match: { value: tomb.source_id } }] },
        wait: cfg.wait,
      });
      db.prepare('DELETE FROM qdrant_pending_deletes WHERE id = ?').run(tomb.id);
      summary.tombstoned += 1;
    } catch (error) {
      const message = redactQdrantError(error);
      summary.error = message;
      if (tomb.attempts + 1 >= MAX_ATTEMPTS) {
        db.prepare('DELETE FROM qdrant_pending_deletes WHERE id = ?').run(tomb.id);
      } else {
        db.prepare(
          `UPDATE qdrant_pending_deletes
              SET attempts = attempts + 1, last_error = ?, next_attempt_at = ?, updated_at = ?
            WHERE id = ?`,
        ).run(message, nextAttemptIso(tomb.attempts + 1), now, tomb.id);
      }
    }
  }

  return summary;
}

/* ------------------------------------------------------------------- verify */

export interface QdrantCountCheck {
  enabled: boolean;
  ok: boolean;
  qdrant: number | null;
  sqlite: number;
  error: string | null;
}

/** Bandingkan count Qdrant dengan core_chunks level='child' (Q-B2). */
export async function verifyQdrantCounts(db: DB): Promise<QdrantCountCheck> {
  const sqlite = (
    db.prepare("SELECT COUNT(*) AS n FROM core_chunks WHERE level = 'child'").get() as { n: number }
  ).n;
  if (!isQdrantEnabled()) return { enabled: false, ok: true, qdrant: null, sqlite, error: null };
  try {
    const cfg = getQdrantConfig();
    const client = await getQdrantClient();
    const result = await client.count(cfg.collection, {
      exact: true,
      filter: { must: [{ key: 'level', match: { value: 'child' } }] },
    });
    return { enabled: true, ok: result.count === sqlite, qdrant: result.count, sqlite, error: null };
  } catch (error) {
    return { enabled: true, ok: false, qdrant: null, sqlite, error: redactQdrantError(error) };
  }
}
