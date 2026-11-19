import { handleRoute, jsonResponse } from '@/lib/api/respond';
import { ensureWorkspaceReady } from '@/lib/db/migrate';
import { listInvestigations } from '@/lib/investigation/engine';
import { parsePagination } from '@/lib/api/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return handleRoute(() => {
    const db = ensureWorkspaceReady();
    const { limit, offset } = parsePagination(new URL(request.url).searchParams, 20, 100);
    return jsonResponse(listInvestigations(db, limit, offset));
  });
}
