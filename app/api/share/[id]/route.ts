import { handleRoute, jsonResponse } from '@/lib/api/respond';
import { ensureWorkspaceReady } from '@/lib/db/migrate';
import { getShareSnapshot } from '@/lib/core/share';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/**
 * Publik, tanpa login, read-only. Bentuk respons sengaja FLAT
 * (`{id, createdAt, options, payload}`) agar cocok dengan normalizer
 * `lib/ui/share-contract.ts` yang dipakai halaman /share/[id].
 */
export async function GET(_request: Request, ctx: Ctx) {
  return handleRoute(async () => {
    const db = ensureWorkspaceReady();
    const { id } = await ctx.params;
    const snapshot = getShareSnapshot(db, id);
    return jsonResponse({
      id: snapshot.id,
      createdAt: snapshot.createdAt,
      options: snapshot.options,
      payload: snapshot.payload,
    });
  });
}
