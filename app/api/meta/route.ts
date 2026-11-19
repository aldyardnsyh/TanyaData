import { handleRoute, jsonResponse } from '@/lib/api/respond';
import { ensureWorkspaceReady } from '@/lib/db/migrate';
import { getMeta } from '@/lib/meta';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return handleRoute(() => {
    const db = ensureWorkspaceReady();
    return jsonResponse(getMeta(db));
  });
}
