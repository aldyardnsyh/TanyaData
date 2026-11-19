import { handleRoute, jsonResponse } from '@/lib/api/respond';
import { ensureWorkspaceReady } from '@/lib/db/migrate';
import { previewSource } from '@/lib/ingest/sources';
import { validationError } from '@/lib/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Ctx) {
  return handleRoute(async () => {
    const db = ensureWorkspaceReady();
    const { id } = await ctx.params;
    const url = new URL(request.url);
    const limitRaw = url.searchParams.get('limit');
    const limit = limitRaw ? Number(limitRaw) : 5;
    if (!Number.isFinite(limit) || limit < 1 || limit > 50) {
      throw validationError('limit harus 1..50');
    }
    return jsonResponse(previewSource(db, id, Math.trunc(limit)));
  });
}
