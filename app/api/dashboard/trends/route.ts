import { handleRoute, jsonResponse } from '@/lib/api/respond';
import { ensureWorkspaceReady } from '@/lib/db/migrate';
import { dashboardContext } from '@/lib/api/dashboard';
import { getTrends } from '@/lib/analytics/queries';
import { validationError } from '@/lib/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return handleRoute(() => {
    const db = ensureWorkspaceReady();
    const url = new URL(request.url);
    const { lang, scope, period, filters } = dashboardContext(db, url.searchParams);
    const grainParam = url.searchParams.get('grain');
    if (grainParam && grainParam !== 'day' && grainParam !== 'week' && grainParam !== 'month') {
      throw validationError('grain harus "day", "week", atau "month"');
    }
    return jsonResponse(getTrends(db, scope, period, filters, lang, grainParam as 'day' | 'week' | 'month' | null));
  });
}
