import { handleRoute, jsonResponse } from '@/lib/api/respond';
import { ensureWorkspaceReady } from '@/lib/db/migrate';
import { dashboardContext } from '@/lib/api/dashboard';
import { getChannelPerformance } from '@/lib/analytics/queries';
import { validationError } from '@/lib/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return handleRoute(() => {
    const db = ensureWorkspaceReady();
    const url = new URL(request.url);
    const { scope, period, filters } = dashboardContext(db, url.searchParams);
    const metricParam = url.searchParams.get('metric') ?? 'volume';
    if (metricParam !== 'volume' && metricParam !== 'failure_rate') {
      throw validationError('metric harus "volume" atau "failure_rate"');
    }
    const limitRaw = url.searchParams.get('limit');
    const limit = limitRaw ? Number(limitRaw) : 10;
    if (!Number.isFinite(limit) || limit < 1 || limit > 50) {
      throw validationError('limit harus 1..50');
    }
    return jsonResponse(getChannelPerformance(db, scope, period, filters, metricParam, Math.trunc(limit)));
  });
}
