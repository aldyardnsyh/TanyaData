import { handleRoute, jsonResponse } from '@/lib/api/respond';
import { ensureWorkspaceReady } from '@/lib/db/migrate';
import { dashboardContext } from '@/lib/api/dashboard';
import { getInsights } from '@/lib/analytics/insights';
import { validationError } from '@/lib/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return handleRoute(() => {
    const db = ensureWorkspaceReady();
    const url = new URL(request.url);
    const { lang, scope, period, filters } = dashboardContext(db, url.searchParams);
    const limitRaw = url.searchParams.get('limit');
    const limit = limitRaw ? Number(limitRaw) : 3;
    if (!Number.isFinite(limit) || limit < 1 || limit > 10) {
      throw validationError('limit harus 1..10');
    }
    return jsonResponse(getInsights(db, scope, period, filters, lang, Math.trunc(limit)));
  });
}
