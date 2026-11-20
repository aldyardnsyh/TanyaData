import { handleRoute, jsonResponse, noContent } from '@/lib/api/respond';
import { ensureWorkspaceReady } from '@/lib/db/migrate';
import { deleteDataset, getDataset, listSteps } from '@/lib/core/registry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  return handleRoute(async () => {
    const db = ensureWorkspaceReady();
    const { id } = await ctx.params;
    return jsonResponse({ dataset: getDataset(db, id), steps: listSteps(db, id) });
  });
}

export async function DELETE(_request: Request, ctx: Ctx) {
  return handleRoute(async () => {
    const db = ensureWorkspaceReady();
    const { id } = await ctx.params;
    deleteDataset(db, id);
    return noContent();
  });
}
