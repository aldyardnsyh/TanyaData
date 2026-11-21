import type { DB } from '@/lib/db/client';
import { nowJakartaIso } from '@/lib/date';
import { chunkDocument } from '@/lib/ingest/chunker';
import { extractPages, sectionsFromPages } from '@/lib/ingest/extract';
import { updateSource, type SourceRow } from '@/lib/ingest/store';
import { unprocessable } from '@/lib/errors';
import { invalidateQueryCache } from '@/lib/core/cache';
import { ensureOcrColumns } from '@/lib/ingest/ocr';

export type MirrorChunk = {
  section: string | null;
  page: number | null;
  content: string;
  charCount: number;
  ocrStatus?: string | null;
  confidence?: number | null;
};

/**
 * C2 — unifikasi chunk store: cermin dokumen workspace ke tabel inti
 * (core_datasets + core_documents + core_chunks) supaya attachment FR-C,
 * scoping per dokumen, dan retrieval chat membaca SATU sumber yang sama
 * dengan jalur eval. Idempoten: indeks ulang menimpa cermin lama.
 */
export function mirrorDocumentChunksToCore(
  db: DB,
  source: { id: string; name: string; format: string; storagePath?: string | null; sizeBytes?: number | null },
  chunks: MirrorChunk[],
): void {
  const now = nowJakartaIso();
  const docId = `doc_${source.id}`;
  const mirror = db.transaction(() => {
    db.prepare(
      `INSERT INTO core_datasets(id, name, kind, source_type, doc_type, status, schema_json, row_count, quality_report, storage_path, size_bytes, is_demo, created_at, updated_at)
       VALUES (?, ?, 'document', ?, 'general', 'READY', '{}', 0, '{}', ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET status = 'READY', name = excluded.name, updated_at = excluded.updated_at`,
    ).run(source.id, source.name, source.format, source.storagePath ?? null, source.sizeBytes ?? 0, 0, now, now);
    db.prepare(
      `INSERT INTO core_documents(id, dataset_id, doc_type, mime, pages, sections_json, source_path, created_at)
       VALUES (?, ?, 'general', NULL, ?, '[]', ?, ?)
       ON CONFLICT(id) DO UPDATE SET dataset_id = excluded.dataset_id, pages = excluded.pages`,
    ).run(docId, source.id, Math.max(1, ...chunks.map((c) => c.page ?? 1), 1), source.storagePath ?? null, now);
    db.prepare('DELETE FROM core_chunks WHERE dataset_id = ?').run(source.id);
    const insert = db.prepare(
      `INSERT INTO core_chunks
         (document_id, dataset_id, section_path, page, text, token_count, char_count, level, parent_id, embedding_json,
          content_hash, page_span, clean_version, clean_flags, ocr_status, confidence)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'child', NULL, NULL, NULL, NULL, 1, '[]', ?, ?)`,
    );
    for (const chunk of chunks) {
      insert.run(
        docId,
        source.id,
        chunk.section ?? '',
        chunk.page,
        chunk.content,
        Math.max(1, Math.ceil(chunk.charCount / 4)),
        chunk.charCount,
        chunk.ocrStatus ?? 'ok',
        chunk.confidence ?? 1,
      );
    }
  });
  mirror();
}

export async function ingestDocument(db: DB, source: SourceRow, buffer: Buffer): Promise<{ chunkCount: number }> {
  const pages = await extractPages(source.format, buffer);
  const sections = sectionsFromPages(pages, source.format, source.name);
  // ADR-OF-13: satu entry point. Sumber legacy tidak punya metadata doc_type
  // → 'general' (bukan regex ad-hoc).
  const chunks = chunkDocument({ sections, docType: 'general' });
  if (!chunks.length) {
    throw unprocessable('Dokumen tidak menghasilkan chunk yang dapat diindeks', { reason: 'NO_TEXT_LAYER' });
  }

  const now = nowJakartaIso();
  ensureOcrColumns(db);
  const skippedPages = [...new Set(pages.filter((p) => p.ocr?.skipped).map((p) => p.page))];
  const ocrUsed = pages.some((p) => p.ocr?.used === true);
  const minConfidence = chunks.reduce((min, c) => Math.min(min, c.confidence ?? 1), 1);

  const write = db.transaction(() => {
    db.prepare('DELETE FROM document_chunks WHERE source_id = ?').run(source.id);
    const stmt = db.prepare(
      `INSERT INTO document_chunks
         (source_id, doc_title, section_no, section, page, chunk_index, content, char_count, ocr_status, confidence)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const chunk of chunks) {
      const skipped = chunk.ocrSkipped === true;
      stmt.run(
        source.id,
        source.name,
        chunk.sectionNo,
        chunk.section,
        chunk.page,
        chunk.chunkIndex,
        skipped ? `[ocr_skipped] ${chunk.content}` : chunk.content,
        chunk.charCount,
        skipped ? 'ocr_skipped' : 'ok',
        chunk.confidence ?? 1,
      );
    }
    updateSource(db, source.id, {
      status: 'READY',
      chunk_count: chunks.length,
      error: null,
      meta_json: JSON.stringify({
        pageCount: pages.length,
        sections: sections.length,
        indexedAt: now,
        chunks: chunks.length,
        ocrUsed,
        ocrSkippedPages: skippedPages,
        ocrConfidence: minConfidence,
        issues: skippedPages.length ? [`${skippedPages.length} halaman tidak terbaca (ocr_skipped)`] : [],
      }),
    });
  });
  write();

  // C2: cermin ke tabel inti supaya attachment FR-C dan retrieval chat
  // membaca store yang sama dengan jalur eval.
  mirrorDocumentChunksToCore(
    db,
    {
      id: source.id,
      name: source.name,
      format: source.format,
      storagePath: source.storage_path,
      sizeBytes: source.size_bytes,
    },
    chunks.map((chunk) => ({
      section: chunk.section,
      page: chunk.page ?? null,
      content: chunk.content,
      charCount: chunk.charCount,
      ocrStatus: chunk.ocrSkipped === true ? 'ocr_skipped' : 'ok',
      confidence: chunk.confidence ?? 1,
    })),
  );
  invalidateQueryCache(db);

  return { chunkCount: chunks.length };
}
