import { handleRoute, jsonResponse } from '@/lib/api/respond';
import { ensureWorkspaceReady } from '@/lib/db/migrate';
import { notFound, validationError } from '@/lib/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

type ChunkRow = {
  id: number;
  section_path: string;
  page: number | null;
  text: string;
  char_count: number;
};

/**
 * Ambil satu chunk dokumen sebagai bukti sitasi (deep-link dari chat).
 * Sumber kebenaran: core_chunks (store terpadu C2) — citation.chunkId adalah
 * id di tabel ini, dan document_id = id sumber data dokumen. Pencocokan
 * berlapis, fail-closed: id chunk persis (wajib milik dokumen ini), lalu
 * fallback bagian+halaman, lalu bagian, lalu halaman.
 */
export async function GET(request: Request, ctx: Ctx) {
  return handleRoute(async () => {
    const db = ensureWorkspaceReady();
    const { id } = await ctx.params;
    const url = new URL(request.url);
    const chunkRaw = url.searchParams.get('chunk');
    const pageRaw = url.searchParams.get('page');
    const section = url.searchParams.get('section')?.trim() || null;
    const chunkId = chunkRaw ? Number(chunkRaw) : null;
    const page = pageRaw ? Number(pageRaw) : null;
    if (chunkId === null && page === null && !section) {
      throw validationError('Minimal satu parameter: chunk, page, atau section');
    }

    let row: ChunkRow | undefined;
    if (chunkId != null && Number.isInteger(chunkId)) {
      row = db
        .prepare('SELECT id, section_path, page, text, char_count FROM core_chunks WHERE id = ? AND document_id = ?')
        .get(chunkId, id) as ChunkRow | undefined;
    }
    if (!row && section && page != null && Number.isInteger(page)) {
      row = db
        .prepare('SELECT id, section_path, page, text, char_count FROM core_chunks WHERE document_id = ? AND section_path = ? AND page = ? ORDER BY id LIMIT 1')
        .get(id, section, page) as ChunkRow | undefined;
    }
    if (!row && section) {
      row = db
        .prepare('SELECT id, section_path, page, text, char_count FROM core_chunks WHERE document_id = ? AND section_path = ? ORDER BY id LIMIT 1')
        .get(id, section) as ChunkRow | undefined;
    }
    if (!row && page != null && Number.isInteger(page)) {
      row = db
        .prepare('SELECT id, section_path, page, text, char_count FROM core_chunks WHERE document_id = ? AND page = ? ORDER BY id LIMIT 1')
        .get(id, page) as ChunkRow | undefined;
    }
    if (!row) throw notFound('Potongan sitasi tidak ditemukan pada dokumen ini');

    return jsonResponse({
      source: { id },
      chunk: {
        id: row.id,
        section: row.section_path,
        page: row.page,
        content: row.text,
        charCount: row.char_count,
      },
    });
  });
}
