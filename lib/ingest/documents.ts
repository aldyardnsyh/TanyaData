import type { DB } from '@/lib/db/client';
import { nowJakartaIso } from '@/lib/date';
import { chunkSections } from '@/lib/ingest/chunker';
import { extractPages, sectionsFromPages } from '@/lib/ingest/extract';
import { updateSource, type SourceRow } from '@/lib/ingest/store';
import { unprocessable } from '@/lib/errors';
import { invalidateQueryCache } from '@/lib/core/cache';
import { ensureOcrColumns } from '@/lib/ingest/ocr';

export async function ingestDocument(db: DB, source: SourceRow, buffer: Buffer): Promise<{ chunkCount: number }> {
  const pages = await extractPages(source.format, buffer);
  const sections = sectionsFromPages(pages, source.format, source.name);
  const chunks = chunkSections(sections);
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
  invalidateQueryCache(db);

  return { chunkCount: chunks.length };
}
