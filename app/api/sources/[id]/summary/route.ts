import { handleRoute, jsonResponse } from '@/lib/api/respond';
import { ensureWorkspaceReady } from '@/lib/db/migrate';
import { findSourceRow } from '@/lib/ingest/store';
import { notFound } from '@/lib/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

type SummarySection = { title: string; page: number | null; chunkCount: number; excerpt: string };

/**
 * Ringkasan dokumen — deterministik, tanpa LLM (konsisten dengan filosofi
 * kutipan deterministik ADR-OF-11): dikelompokkan per bagian dari chunk yang
 * tersimpan, kutipan = kalimat pembuka tiap bagian. Ini gambaran struktur
 * dokumen, bukan parafrasa.
 */
function firstSentence(text: string, max = 280): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  const sentences = clean.split(/(?<=[.!?])\s+/);
  let out = sentences[0] ?? clean;
  for (const s of sentences.slice(1)) {
    if (out.length >= 120) break;
    out += ` ${s}`;
  }
  return out.length > max ? `${out.slice(0, max - 1).trimEnd()}…` : out;
}

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
      .all(id) as Array<{ section: string | null; page: number | null; content: string; ocr_status: string }>;

    const groups = new Map<string, { page: number | null; chunkCount: number; content: string }>();
    for (const chunk of chunks) {
      const title = (chunk.section ?? '').trim() || 'Tanpa judul bagian';
      const existing = groups.get(title);
      if (existing) {
        existing.chunkCount += 1;
        if (existing.page === null && chunk.page !== null) existing.page = chunk.page;
        if (existing.content.length < 600) existing.content += ` ${chunk.content}`;
      } else {
        groups.set(title, { page: chunk.page, chunkCount: 1, content: chunk.content });
      }
    }

    const sections: SummarySection[] = Array.from(groups.entries()).map(([title, group]) => ({
      title,
      page: group.page,
      chunkCount: group.chunkCount,
      excerpt: firstSentence(group.content),
    }));

    const ocrSkipped = chunks.filter((c) => c.ocr_status === 'ocr_skipped').length;

    return jsonResponse({
      source: { id: source.id, name: source.name, format: source.format, pageCount: source.chunk_count },
      totals: { chunks: chunks.length, sections: sections.length, ocrSkipped },
      sections,
      generatedAt: new Date().toISOString(),
      note: 'Ringkasan struktur deterministik dari chunk terindeks, bukan parafrasa model.',
    });
  });
}
