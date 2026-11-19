import { handleRoute, jsonResponse } from '@/lib/api/respond';
import { ensureWorkspaceReady } from '@/lib/db/migrate';
import { dashboardContext } from '@/lib/api/dashboard';
import { getCategoryPerformance } from '@/lib/analytics/queries';
import { validationError } from '@/lib/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return handleRoute(() => {
    const db = ensureWorkspaceReady();
    const url = new URL(request.url);
    const { scope, period, filters } = dashboardContext(db, url.searchParams);
    const limitRaw = url.searchParams.get('limit');
    const limit = limitRaw ? Number(limitRaw) : 15;
    if (!Number.isFinite(limit) || limit < 1 || limit > 50) {
      throw validationError('limit harus 1..50');
    }
    return jsonResponse(getCategoryPerformance(db, scope, period, filters, Math.trunc(limit)));
  });
}
