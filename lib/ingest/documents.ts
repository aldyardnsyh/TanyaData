import type { DB } from '@/lib/db/client';
import { nowJakartaIso } from '@/lib/date';
import {
  chunkDocument,
  detectGenericSections,
  stableHash,
  type ChunkDocumentResult,
  type LegalChunkInput,
} from '@/lib/ingest/chunker';
import { extractPages } from '@/lib/ingest/extract';
import { updateSource, type SourceRow } from '@/lib/ingest/store';
import { unprocessable } from '@/lib/errors';
import { invalidateQueryCache } from '@/lib/core/cache';
import { ensureOcrColumns } from '@/lib/ingest/ocr';
import { enqueueUpserts } from '@/lib/qdrant/sync';
import type { EvidenceUnit, LayoutInfo } from '@/lib/ingest/types';
import {
  classifySource,
  cleanSections,
  legalSectionsFromPages,
  sectionsFromPages as coreSectionsFromPages,
} from '@/lib/core/ingest';
import type { DocType, SourceType } from '@/lib/core/contracts';

export type MirrorChunk = {
  /** Kunci stabil chunk (legal id atau `<doc>:c:<index>`). */
  key: string;
  /** Kunci induk untuk chunk legal; null untuk chunk datar. */
  parentKey: string | null;
  level: 'parent' | 'child';
  section: string | null;
  page: number | null;
  pageSpan: [number, number] | null;
  content: string;
  charCount: number;
  tokenCount: number;
  cleanFlags: string[];
  contentHash: string | null;
  ocrStatus?: string | null;
  confidence?: number | null;
  /** Fase 2A. */
  sectionId: string | null;
  sectionHash: string | null;
  units: EvidenceUnit[];
  charStart: number | null;
  charEnd: number | null;
  readingOrder: string[] | null;
  layout: LayoutInfo | null;
  embedText: string | null;
};

export type MirrorSource = {
  id: string;
  name: string;
  format: string;
  storagePath?: string | null;
  sizeBytes?: number | null;
  docType?: DocType;
  pages?: number;
  sectionsJson?: string;
};

export type ReplaceResult = {
  insertedIds: number[];
  removedIds: number[];
  unchanged: number;
};

/**
 * Tulis/cerminkan chunk ke tabel inti secara SELEKTIF (Fase 2A).
 *
 * Idempotensi: `section_hash` dihitung dari teks bagian. Bagian yang tidak
 * berubah dipertahankan (id chunk tidak berubah → point Qdrant tidak churn).
 * Hanya bagian yang berubah yang dihapus lalu ditulis ulang. Upload ulang PDF
 * yang sama tidak menghasilkan duplikat; mengubah satu bagian hanya
 * meng-re-index bagian itu.
 */
export function replaceIndexedChunks(
  db: DB,
  documentId: string,
  datasetId: string,
  chunks: MirrorChunk[],
): ReplaceResult {
  const insertedIds: number[] = [];
  const removedIds: number[] = [];
  let unchanged = 0;

  const desiredByHash = new Map<string, MirrorChunk[]>();
  for (const chunk of chunks) {
    const hash = chunk.sectionHash ?? chunk.contentHash ?? stableHash(chunk.content);
    const group = desiredByHash.get(hash) ?? [];
    group.push(chunk);
    desiredByHash.set(hash, group);
  }

  db.transaction(() => {
    const existing = db
      .prepare('SELECT id, section_hash FROM core_chunks WHERE document_id = ?')
      .all(documentId) as Array<{ id: number; section_hash: string | null }>;
    const keep = new Set(desiredByHash.keys());
    const stale = existing
      .filter((row) => !row.section_hash || !keep.has(row.section_hash))
      .map((row) => row.id);
    if (stale.length) {
      const placeholders = stale.map(() => '?').join(',');
      db.prepare(`DELETE FROM core_chunks WHERE id IN (${placeholders})`).run(...stale);
      removedIds.push(...stale);
    }
    const present = new Set(
      existing
        .filter((row) => row.section_hash && keep.has(row.section_hash))
        .map((row) => row.section_hash as string),
    );

    const insert = db.prepare(
      `INSERT INTO core_chunks
         (document_id, dataset_id, section_path, page, text, token_count, char_count, level, parent_id,
          embedding_json, content_hash, page_span, clean_version, clean_flags, ocr_status, confidence,
          char_start, char_end, unit_id, section_id, section_hash, units_json, reading_order, layout_json, embed_text)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const parentIds = new Map<string, number>();

    const write = (chunk: MirrorChunk, parentId: number | null): number => {
      const result = insert.run(
        documentId,
        datasetId,
        chunk.section ?? '',
        chunk.page,
        chunk.content,
        chunk.tokenCount,
        chunk.charCount,
        chunk.level,
        parentId,
        chunk.contentHash,
        chunk.pageSpan ? JSON.stringify(chunk.pageSpan) : null,
        chunk.cleanFlags.length ? 2 : 0,
        JSON.stringify(chunk.cleanFlags),
        chunk.ocrStatus ?? 'ok',
        chunk.confidence ?? 1,
        chunk.charStart,
        chunk.charEnd,
        chunk.units[0]?.id ?? null,
        chunk.sectionId,
        chunk.sectionHash,
        JSON.stringify(chunk.units),
        chunk.readingOrder ? JSON.stringify(chunk.readingOrder) : null,
        chunk.layout ? JSON.stringify(chunk.layout) : null,
        chunk.embedText,
      );
      return Number(result.lastInsertRowid);
    };

    for (const [hash, group] of desiredByHash) {
      if (present.has(hash)) {
        unchanged += group.length;
        continue;
      }
      for (const chunk of group) {
        if (chunk.level !== 'parent') continue;
        const id = write(chunk, null);
        parentIds.set(chunk.key, id);
        insertedIds.push(id);
      }
      for (const chunk of group) {
        if (chunk.level !== 'child') continue;
        const id = write(chunk, chunk.parentKey ? parentIds.get(chunk.parentKey) ?? null : null);
        insertedIds.push(id);
      }
    }
  })();

  if (insertedIds.length) enqueueUpserts(db, insertedIds, datasetId, documentId);
  return { insertedIds, removedIds, unchanged };
}

/**
 * C2 — unifikasi chunk store: cermin dokumen workspace ke tabel inti
 * (core_datasets + core_documents + core_chunks). Idempoten per bagian.
 */
export function mirrorDocumentChunksToCore(
  db: DB,
  source: MirrorSource,
  chunks: MirrorChunk[],
): ReplaceResult {
  const now = nowJakartaIso();
  const docType: DocType = source.docType ?? 'general';
  const pageCount = Math.max(1, source.pages ?? 0, ...chunks.map((c) => c.page ?? 1), 1);
  const sectionsJson = source.sectionsJson ?? '[]';

  db.transaction(() => {
    db.prepare(
      `INSERT INTO core_datasets(id, name, kind, source_type, doc_type, status, schema_json, row_count, quality_report, storage_path, size_bytes, is_demo, created_at, updated_at)
       VALUES (?, ?, 'document', ?, ?, 'READY', '{"version":1,"tables":[],"relations":[],"enums":{}}', 0, '{}', ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         status = 'READY', name = excluded.name, doc_type = excluded.doc_type,
         storage_path = excluded.storage_path, size_bytes = excluded.size_bytes, updated_at = excluded.updated_at`,
    ).run(source.id, source.name, source.format, docType, source.storagePath ?? null, source.sizeBytes ?? 0, 0, now, now);
    db.prepare(
      `INSERT INTO core_documents(id, dataset_id, doc_type, mime, pages, sections_json, source_path, created_at)
       VALUES (?, ?, ?, NULL, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         dataset_id = excluded.dataset_id, doc_type = excluded.doc_type, pages = excluded.pages,
         sections_json = excluded.sections_json, source_path = excluded.source_path`,
    ).run(source.id, source.id, docType, pageCount, sectionsJson, source.storagePath ?? null, now);
  })();

  return replaceIndexedChunks(db, source.id, source.id, chunks);
}

/** Prefix kontekstual untuk embedding: `[Nama Dokumen | Bagian n: Judul]`. */
export function contextualEmbedText(docName: string, section: string | null, text: string): string {
  const label = section?.trim() || 'Bagian 1';
  return `[${docName.trim() || 'Dokumen'} | ${label}] ${text}`;
}

function mirrorChunks(sourceId: string, sourceName: string, chunks: ChunkDocumentResult[]): MirrorChunk[] {
  const parentKeys = new Set(
    chunks.filter((c) => c.legal_id && !c.parent_id).map((c) => c.legal_id as string),
  );
  const referencedParents = new Set(
    chunks.map((c) => c.parent_id).filter((id): id is string => Boolean(id && parentKeys.has(id))),
  );
  return chunks.map((chunk, index) => {
    const isParent = Boolean(chunk.legal_id && referencedParents.has(chunk.legal_id));
    const span = chunk.pageSpan ?? (chunk.page != null ? ([chunk.page, chunk.page] as [number, number]) : null);
    return {
      key: chunk.legal_id ?? `${sourceId}:c:${index}`,
      parentKey: chunk.parent_id ?? null,
      level: isParent ? 'parent' : 'child',
      section: chunk.section,
      page: chunk.page ?? null,
      pageSpan: span,
      content: chunk.content,
      charCount: chunk.charCount,
      tokenCount: Math.max(1, Math.ceil(chunk.charCount / 4)),
      cleanFlags: chunk.clean_flags ?? [],
      contentHash: chunk.content_hash ?? null,
      ocrStatus: chunk.ocrSkipped ? 'ocr_skipped' : (chunk.ocrStatus ?? 'ok'),
      confidence: chunk.confidence ?? 1,
      sectionId: chunk.sectionId ?? null,
      sectionHash: chunk.sectionHash ?? null,
      units: chunk.units ?? [],
      charStart: chunk.charStart ?? null,
      charEnd: chunk.charEnd ?? null,
      readingOrder: chunk.readingOrder ?? null,
      layout: chunk.layout ?? null,
      embedText: contextualEmbedText(sourceName, chunk.section, chunk.content),
    };
  });
}

/**
 * Ingest dokumen workspace — pipeline yang SAMA dengan core: klasifikasi dari
 * teks hasil ekstraksi → sectioning → cleaning → `chunkDocument`.
 */
export async function ingestDocument(
  db: DB,
  source: SourceRow,
  buffer: Buffer,
): Promise<{ chunkCount: number; replaced?: ReplaceResult }> {
  const pages = await extractPages(source.format, buffer);
  const parsedPages = pages.map((p) => ({
    page: p.page,
    text: p.text,
    unreadable: p.ocr?.skipped === true,
    ocrStatus: p.ocr?.skipped ? ('ocr_skipped' as const) : undefined,
    ocrConfidence: p.ocr?.confidence,
    readingOrder: p.readingOrder,
    layout: p.layout,
  }));

  const classification = classifySource({
    format: source.format as SourceType,
    name: source.name,
    sampleText: pages.map((p) => p.text).join('\n').slice(0, 20_000),
    hasHeader: false,
  });

  const isLegal = classification.doc_type === 'legal';
  const firstPage = parsedPages[0]?.page ?? 1;
  let sections = isLegal
    ? legalSectionsFromPages(parsedPages, source.name)
    : cleanSections(coreSectionsFromPages(parsedPages, source.name));
  if (!isLegal && sections.length < 2) {
    // Fallback generik: struktur tidak konsisten → kelompokkan paragraf
    // berdasarkan jeda/indentasi, jangan jadikan satu blok besar.
    const generic = detectGenericSections(pages.map((p) => p.text).join('\n'), source.id);
    if (generic.length > sections.length) {
      sections = cleanSections(generic.map((section) => ({
        section_path: section.title,
        page: firstPage,
        char_count: section.text.length,
        text: section.text,
        pageSpan: [firstPage, firstPage] as [number, number],
      })));
    }
  }
  const legalInputs: LegalChunkInput[] | undefined = isLegal
    ? sections.map((section) => ({
        id: section.section_path === 'pembukaan'
          ? 'pembukaan'
          : section.section_path === 'penutup'
            ? 'penutup'
            : section.section_path.toLowerCase().replace(/\s+/g, '-'),
        text: section.text,
        pageStart: section.page ?? firstPage,
        pageEnd: section.pageSpan?.[1] ?? section.page ?? firstPage,
        heading: section.section_path,
        segments: pages.map((p) => ({ page: p.page, text: p.text })),
        children: section.legalChildren,
      }))
    : undefined;
  const chunks = chunkDocument({
    sections,
    docType: classification.doc_type,
    documentId: source.id,
    ...(legalInputs ? { legalInputs } : {}),
  });
  if (!chunks.length) {
    throw unprocessable('Dokumen tidak menghasilkan chunk yang dapat diindeks', { reason: 'NO_TEXT_LAYER' });
  }

  const now = nowJakartaIso();
  ensureOcrColumns(db);
  const skippedPages = [...new Set(pages.filter((p) => p.ocr?.skipped).map((p) => p.page))];
  const ocrUsed = pages.some((p) => p.ocr?.used === true);
  const minConfidence = chunks.reduce((min, c) => Math.min(min, c.confidence ?? 1), 1);
  const layouts = pages.map((p) => p.layout).filter(Boolean);
  const twoColumnPages = layouts.filter((l) => l && l.columns === 2).length;

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
        docType: classification.doc_type,
        docTypeConfidence: Number(classification.confidence.toFixed(2)),
        indexedAt: now,
        chunks: chunks.length,
        ocrUsed,
        ocrSkippedPages: skippedPages,
        ocrConfidence: minConfidence,
        twoColumnPages,
        readingOrder: 'column_then_linear',
        issues: skippedPages.length ? [`${skippedPages.length} halaman tidak terbaca (ocr_skipped)`] : [],
      }),
    });
  });
  write();

  const replaced = mirrorDocumentChunksToCore(
    db,
    {
      id: source.id,
      name: source.name,
      format: source.format,
      storagePath: source.storage_path,
      sizeBytes: source.size_bytes,
      docType: classification.doc_type,
      pages: pages.length,
      sectionsJson: JSON.stringify(
        sections.map((s) => ({
          section_path: s.section_path,
          page: s.page,
          char_count: s.char_count,
          reading_order: s.readingOrder ?? null,
          layout: s.layout ?? null,
        })),
      ),
    },
    mirrorChunks(source.id, source.name, chunks),
  );
  invalidateQueryCache(db);

  return { chunkCount: chunks.length, replaced };
}
