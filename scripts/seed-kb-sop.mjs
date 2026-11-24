#!/usr/bin/env node
/**
 * Seed dataset kb-sop + fixture eval:extraction-gt ke workspace DB yang SUDAH
 * ada (DECISION-033 / P3-MIGRATION).
 *
 *   npm run db:seed:kb-sop
 *
 * Latar: `ensureDocuments()` di lib/db/migrate.ts sengaja return early bila
 * sudah ada sumber dokumen. Artinya dokumen baru di documents.json TIDAK
 * otomatis masuk ke workspace lama. Script ini menambah (idempoten) sumber
 * kb-sop dan fixture Perpres 76 tanpa menyentuh 6 dokumen seed existing.
 *
 * Juga membersihkan `src_df43cee6`: artifact upload lama KB_01 (PDF image-only)
 * yang hanya berisi chunk placeholder `[halaman tidak terbaca]`. Bukan bagian
 * dari 6 dokumen seed; digantikan oleh `src_kb_01_penanganan_tiket_layanan`
 * yang sumbernya PDF asli (bukan transkrip GT).
 *
 * Anti-kebocoran: indeks HANYA dari PDF. KB01/KB04 image-only tanpa OCR
 * ditandai `ocr_unavailable` + `needsReview`; `corpus_sections` GT dipakai
 * untuk validasi saja dan TIDAK pernah dijadikan teks indeks. GT tidak diubah.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@/')) {
      return nextResolve(pathToFileURL(path.join(root, specifier.slice(2)) + '.ts').href, context);
    }
    if (specifier.startsWith('.') && !/\.[a-z0-9]+$/i.test(specifier)) {
      try { return nextResolve(specifier + '.ts', context); } catch { /* fall through */ }
    }
    return nextResolve(specifier, context);
  },
});

const { ensureWorkspaceReady } = await import(pathToFileURL(path.join(root, 'lib/db/migrate.ts')).href);
const { docSourceId } = await import(pathToFileURL(path.join(root, 'lib/ingest/types.ts')).href);
const { reindexSource } = await import(pathToFileURL(path.join(root, 'lib/ingest/sources.ts')).href);
const { nowJakartaIso } = await import(pathToFileURL(path.join(root, 'lib/date.ts')).href);

const docsPath = path.join(root, 'data', 'generated', 'documents.json');
if (!fs.existsSync(docsPath)) {
  console.error('FAIL: documents.json belum ada — jalankan `npm run db:extract` dulu.');
  process.exit(1);
}
const docs = JSON.parse(fs.readFileSync(docsPath, 'utf8')).documents ?? [];
const targets = docs.filter((d) => d.dataset === 'kb-sop' || d.dataset === 'eval-fixture');
if (!targets.length) {
  console.error('FAIL: tidak ada dokumen kb-sop / eval-fixture di documents.json.');
  process.exit(1);
}

const db = ensureWorkspaceReady();
const now = nowJakartaIso();

// 1. Bersihkan artifact lama yang rusak (bukan 6 dokumen seed).
const stale = db.prepare("SELECT id FROM data_sources WHERE id = 'src_df43cee6'").get();
if (stale) {
  db.transaction(() => {
    db.prepare('DELETE FROM core_datasets WHERE id = ?').run('src_df43cee6');
    db.prepare('DELETE FROM data_sources WHERE id = ?').run('src_df43cee6');
  })();
  console.log('CLEAN src_df43cee6 (placeholder KB_01 lama, bukan seed)');
}

// 2. Daftarkan sumber baru secara idempoten + metadata asal yang jujur.
const insert = db.prepare(
  `INSERT OR IGNORE INTO data_sources
     (id, kind, name, original_name, format, mime, size_bytes, status, row_count,
      chunk_count, error, storage_path, meta_json, created_at, updated_at)
   VALUES (?, 'document', ?, ?, ?, ?, ?, 'READY', NULL, 0, NULL, ?, ?, ?, ?)`,
);
const updateMeta = db.prepare('UPDATE data_sources SET meta_json = ?, updated_at = ? WHERE id = ?');

for (const doc of targets) {
  const id = docSourceId(doc.id);
  const mime = doc.format === 'pdf'
    ? 'application/pdf'
    : doc.format === 'docx'
      ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      : 'text/plain';
  const meta = {
    docId: doc.id,
    dataset: doc.dataset,
    ingestMode: doc.ingestMode ?? 'pdf_text',
    pageCount: doc.pages?.length ?? 0,
    sections: doc.sections?.length ?? 0,
    ...(doc.ingestMode === 'ocr_unavailable'
      ? { note: 'PDF image-only tanpa text layer; OCR tidak tersedia. Tidak memakai teks GT — indeks hanya dari PDF.', needsReview: true }
      : {}),
  };
  insert.run(
    id,
    doc.title,
    doc.file,
    doc.format,
    mime,
    doc.sizeBytes ?? 0,
    doc.file,
    JSON.stringify(meta),
    now,
    now,
  );
  const row = db.prepare('SELECT meta_json FROM data_sources WHERE id = ?').get(id);
  const existing = row ? JSON.parse(row.meta_json || '{}') : {};
  updateMeta.run(JSON.stringify({ ...existing, ...meta }), now, id);
  console.log(`REGISTER ${id} dataset=${doc.dataset} ingestMode=${meta.ingestMode}`);
}

// 3. Reindex lewat pipeline produksi yang sama dengan `npm run reindex:docs`.
let failed = 0;
for (const doc of targets) {
  const id = docSourceId(doc.id);
  try {
    const result = await reindexSource(db, id);
    const row = db.prepare('SELECT chunk_count, status FROM data_sources WHERE id = ?').get(id);
    console.log(`OK   ${id} status=${row?.status} chunks=${row?.chunk_count} job=${result.job.status}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${id}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

db.close();
if (failed) {
  console.error(`SEED KB-SOP: FAIL (${failed} sumber gagal)`);
  process.exit(1);
}
console.log(`SEED KB-SOP: PASS (${targets.length} sumber terdaftar & terindeks)`);
