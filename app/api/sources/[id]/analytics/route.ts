import { handleRoute, jsonResponse } from '@/lib/api/respond';
import { ensureWorkspaceReady } from '@/lib/db/migrate';
import { findSourceRow } from '@/lib/ingest/store';
import { notFound } from '@/lib/errors';
import { buildDocumentAnalytics, type DocAnalyticsChunk } from '@/lib/core/doc-analytics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/**
 * Analytics per dokumen — deterministik dari chunk terindeks (tanpa LLM).
 * Tersedia otomatis begitu dokumen selesai diindeks: klasifikasi tipe +
 * metrik sesuai tipe + insight. Ini yang membuat halaman detail dokumen
 * siap demo/presentasi tanpa membuka chat.
 */
export async function GET(_request: Request, ctx: Ctx) {
  return handleRoute(async () => {
    const db = ensureWorkspaceReady();
    const { id } = await ctx.params;
    const source = findSourceRow(db, id);
    if (!source) throw notFound('Sumber data tidak ditemukan');

    const chunks = db
      .prepare(
        `SELECT section, page, content, ocr_status
           FROM document_chunks WHERE source_id = ? ORDER BY chunk_index`,
      )
      .all(id) as Array<DocAnalyticsChunk & { ocr_status: string }>;

    const analytics = buildDocumentAnalytics(chunks, source.name);
    return jsonResponse({
      source: { id: source.id, name: source.name, format: source.format },
      ...analytics,
      generatedAt: new Date().toISOString(),
      note: 'Analytics deterministik dari chunk terindeks — angka dapat ditelusuri kembali ke dokumen.',
    });
  });
}
