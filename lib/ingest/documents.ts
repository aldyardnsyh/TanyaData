import type { DB } from '@/lib/db/client';
import { nowJakartaIso } from '@/lib/date';
import { chunkSections } from '@/lib/ingest/chunker';
import { extractPages, sectionsFromPages } from '@/lib/ingest/extract';
import { updateSource, type SourceRow } from '@/lib/ingest/store';
import { unprocessable } from '@/lib/errors';

export async function ingestDocument(db: DB, source: SourceRow, buffer: Buffer): Promise<{ chunkCount: number }> {
  const pages = await extractPages(source.format, buffer);
  const sections = sectionsFromPages(pages, source.format, source.name);
  const chunks = chunkSections(sections);
  if (!chunks.length) {
    throw unprocessable('Dokumen tidak menghasilkan chunk yang dapat diindeks', { reason: 'NO_TEXT_LAYER' });
  }

  const now = nowJakartaIso();
  const write = db.transaction(() => {
    db.prepare('DELETE FROM document_chunks WHERE source_id = ?').run(source.id);
    const stmt = db.prepare(
      `INSERT INTO document_chunks
         (source_id, doc_title, section_no, section, page, chunk_index, content, char_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const chunk of chunks) {
      stmt.run(
        source.id,
        source.name,
        chunk.sectionNo,
        chunk.section,
        chunk.page,
        chunk.chunkIndex,
        chunk.content,
        chunk.charCount,
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
      }),
    });
  });
  write();

  return { chunkCount: chunks.length };
}
