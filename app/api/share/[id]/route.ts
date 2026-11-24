import { handleRoute, jsonResponse } from '@/lib/api/respond';
import { rateLimit } from '@/lib/api/rate-limit';
import { ensureWorkspaceReady } from '@/lib/db/migrate';
import { getShareSnapshot, revokeShareSnapshot } from '@/lib/core/share';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/**
 * Publik, tanpa login, read-only. Bentuk respons sengaja FLAT
 * (`{id, createdAt, options, payload}`) agar cocok dengan normalizer
 * `lib/ui/share-contract.ts` yang dipakai halaman /share/[id].
 *
 * P6-FIX / SEC-002: header X-Robots-Tag + expiry/revoke. Snapshot yang
 * expired/revoked ditolak oleh `getShareSnapshot` (404 seragam).
 */
export async function GET(request: Request, ctx: Ctx) {
  const limited = rateLimit(request, 'share');
  if (limited) return limited;
  return handleRoute(async () => {
    const db = ensureWorkspaceReady();
    const { id } = await ctx.params;
    const snapshot = getShareSnapshot(db, id);
    const response = jsonResponse({
      id: snapshot.id,
      createdAt: snapshot.createdAt,
      expiresAt: snapshot.expiresAt,
      options: snapshot.options,
      payload: snapshot.payload,
    });
    response.headers.set('x-robots-tag', 'noindex, nofollow');
    return response;
  });
}

/** P6-FIX / SEC-002: cabut link. Idempoten. */
export async function DELETE(request: Request, ctx: Ctx) {
  const limited = rateLimit(request, 'share');
  if (limited) return limited;
  return handleRoute(async () => {
    const db = ensureWorkspaceReady();
    const { id } = await ctx.params;
    const snapshot = revokeShareSnapshot(db, id);
    return jsonResponse({
      share: {
        id: snapshot.id,
        revokedAt: snapshot.revokedAt,
        revokedReason: snapshot.revokedReason,
      },
    });
  });
}
