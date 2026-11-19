import { handleRoute, jsonResponse, noContent } from '@/lib/api/respond';
import { ensureWorkspaceReady } from '@/lib/db/migrate';
import { removeSource, sourceDetail } from '@/lib/ingest/sources';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  return handleRoute(async () => {
    const db = ensureWorkspaceReady();
    const { id } = await ctx.params;
    return jsonResponse(sourceDetail(db, id));
  });
}

export async function DELETE(_request: Request, ctx: Ctx) {
  return handleRoute(async () => {
    const db = ensureWorkspaceReady();
    const { id } = await ctx.params;
    removeSource(db, id);
    return noContent();
  });
}
