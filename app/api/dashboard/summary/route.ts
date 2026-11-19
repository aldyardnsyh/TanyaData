import { handleRoute, jsonResponse } from '@/lib/api/respond';
import { ensureWorkspaceReady } from '@/lib/db/migrate';
import { dashboardContext } from '@/lib/api/dashboard';
import { getSummary } from '@/lib/analytics/queries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return handleRoute(() => {
    const db = ensureWorkspaceReady();
    const { lang, scope, period, filters } = dashboardContext(db, new URL(request.url).searchParams);
    return jsonResponse(getSummary(db, scope, period, filters, lang));
  });
}
