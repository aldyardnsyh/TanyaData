#!/usr/bin/env node
/**
 * Reindex dokumen workspace dengan pipeline ingest terbaru.
 *
 *   node scripts/reindex-documents.mjs            # semua sumber kind=document
 *   node scripts/reindex-documents.mjs src_xxx    # sumber tertentu
 *   node scripts/reindex-documents.mjs --qdrant-verify  # cek count Qdrant vs SQLite
 *
 * Memakai DB workspace asli (data/workspace/tanyadata.db), bukan workspace
 * sementara eval. Aman dijalankan berulang: ingestDocument menimpa chunk lama.
 *
 * DECISION-032: sebelum reindex, point Qdrant lama dihapus by source_id dulu
 * karena newDocumentId() menghasilkan chunk_id baru. Saat QDRANT_MODE=off
 * semua operasi Qdrant adalah no-op → perilaku identik dengan sebelum migrasi.
 *
 * FIX sinkronisasi: deleteBySource() mengosongkan point lebih dulu, tetapi
 * reindexSource() hanya meng-enqueue chunk yang BERUBAH. Bila chunk tidak
 * berubah, outbox tetap 'synced' → drainOutbox attempted=0 → Qdrant kosong.
 * Setelah reindex kami enqueue ULANG semua chunk id sumber (idempoten by
 * chunk_id) lalu drainOutbox sampai habis. Aman dijalankan berulang.
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@/')) {
      const abs = path.join(root, specifier.slice(2)) + '.ts';
      return nextResolve(pathToFileURL(abs).href, context);
    }
    if (specifier.startsWith('.') && !/\.[a-z0-9]+$/i.test(specifier)) {
      try {
        return nextResolve(specifier + '.ts', context);
      } catch {
        // fall through to default resolution
      }
    }
    return nextResolve(specifier, context);
  },
});

const { ensureWorkspaceReady } = await import(pathToFileURL(path.join(root, 'lib/db/migrate.ts')).href);
const { reindexSource } = await import(pathToFileURL(path.join(root, 'lib/ingest/sources.ts')).href);
const { deleteBySource, verifyQdrantCounts, enqueueUpserts, drainOutbox } = await import(
  pathToFileURL(path.join(root, 'lib/qdrant/sync.ts')).href
);

const db = ensureWorkspaceReady();
const flags = process.argv.slice(2).filter((a) => a.startsWith('--'));
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));

/**
 * dataset_id untuk outbox. `data_sources` tidak punya kolom dataset_id di
 * schema saat ini — bila suatu hari ditambahkan, pakai nilainya; jika tidak,
 * fallback ke id sumber (dataset_id core_chunks memang = source id).
 */
function datasetIdFor(sourceId) {
  const hasColumn = db
    .prepare("PRAGMA table_info(data_sources)")
    .all()
    .some((col) => col.name === 'dataset_id');
  if (hasColumn) {
    const row = db.prepare('SELECT dataset_id FROM data_sources WHERE id = ?').get(sourceId);
    if (row?.dataset_id) return String(row.dataset_id);
  }
  return sourceId;
}

/**
 * Kuras outbox sampai habis. drainOutbox membatasi SELECT dengan
 * QDRANT_BATCH_SIZE (default 64); satu sumber bisa punya >64 chunk, jadi
 * satu kali drain tidak cukup. Berhenti saat attempted=0 (tidak ada lagi
 * baris pending yang bisa diproses) atau setelah batas aman.
 */
async function drainAll() {
  const total = { attempted: 0, succeeded: 0, failed: 0, tombstoned: 0, error: null };
  for (let pass = 0; pass < 32; pass += 1) {
    const s = await drainOutbox(db);
    if (!s.enabled) break;
    total.attempted += s.attempted;
    total.succeeded += s.succeeded;
    total.failed += s.failed;
    total.tombstoned += s.tombstoned;
    if (s.error) total.error = s.error;
    if (s.attempted === 0) break;
  }
  return total;
}

if (flags.includes('--qdrant-verify')) {
  const check = await verifyQdrantCounts(db);
  if (!check.enabled) {
    console.log('SKIPPED: Qdrant tidak aktif (QDRANT_MODE=off) — tidak ada count untuk diverifikasi.');
  } else if (check.error) {
    console.error(`FAIL verifikasi Qdrant: ${check.error}`);
    process.exitCode = 1;
  } else {
    console.log(
      `${check.ok ? 'OK  ' : 'FAIL'} qdrant=${check.qdrant} sqlite=${check.sqlite} delta=${(check.qdrant ?? 0) - check.sqlite}`,
    );
    if (!check.ok) process.exitCode = 1;
  }
  db.close();
  process.exit(process.exitCode ?? 0);
}
const ids = args.length
  ? args
  : db
      .prepare("SELECT id FROM data_sources WHERE kind = 'document' ORDER BY id")
      .all()
      .map((row) => row.id);

if (!ids.length) {
  console.log('Tidak ada sumber dokumen untuk direindex.');
  db.close();
  process.exit(0);
}

for (const id of ids) {
  try {
    // Hapus dulu by source_id (idempoten; reindexSource juga menjaga ini).
    const removed = await deleteBySource(db, id);
    if (removed.error) console.warn(`WARN ${id}: qdrant delete gagal → tombstone: ${removed.error}`);
    const result = await reindexSource(db, id);

    // Reindex hanya meng-enqueue chunk BARU (insertedIds dari
    // replaceIndexedChunks). Bila chunk tidak berubah, outbox sudah 'synced'
    // dan deleteBySource() di atas mengosongkan point Qdrant tanpa pengganti.
    // Di sini kami enqueue ULANG semua chunk milik source, lalu kuras outbox.
    //
    // `document_chunks` (kolom source_id) adalah cermin workspace; keberadaan
    // barisnya dipakai sebagai penanda bahwa source memang punya chunk.
    // Point id Qdrant = core_chunks.id (lihat buildPoints/upsertChunks di
    // lib/qdrant/sync.ts), jadi chunk id diambil dari core_chunks dengan
    // document_id = source id (keduanya ditulis oleh ingestDocument yang sama).
    const mirrored = db.prepare('SELECT 1 FROM document_chunks WHERE source_id = ? LIMIT 1').get(id);
    let sync = { attempted: 0, succeeded: 0, failed: 0, tombstoned: 0, error: null };
    if (mirrored) {
      const chunkIds = db
        .prepare('SELECT id FROM core_chunks WHERE document_id = ? ORDER BY id')
        .all(id)
        .map((r) => r.id);
      enqueueUpserts(db, chunkIds, datasetIdFor(id), id);
      sync = await drainAll();
      if (sync.failed || sync.error) {
        console.warn(
          `WARN ${id}: qdrant drain failed=${sync.failed} error=${sync.error ?? '-'} (FTS5 tetap dipakai)`,
        );
      }
    } else {
      console.warn(`WARN ${id}: tidak ada baris document_chunks — enqueue Qdrant dilewati.`);
    }

    const row = db.prepare('SELECT chunk_count, status FROM data_sources WHERE id = ?').get(id);
    const doc = db
      .prepare('SELECT doc_type, pages FROM core_documents WHERE id = ?')
      .get(id);
    console.log(
      `OK   ${id} status=${row?.status} chunks=${row?.chunk_count} doc_type=${doc?.doc_type ?? '-'} pages=${doc?.pages ?? '-'} job=${result.job.status} qdrant_attempted=${sync.attempted} qdrant_synced=${sync.succeeded}`,
    );
  } catch (error) {
    console.error(`FAIL ${id}: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

db.close();
