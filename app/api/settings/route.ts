import { handleRoute, jsonResponse } from '@/lib/api/respond';
import { ensureWorkspaceReady } from '@/lib/db/migrate';
import { getSettings, updateSettings } from '@/lib/settings';
import { settingsPatchSchema } from '@/lib/api/schemas';
import { parseJsonBody } from '@/lib/api/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return handleRoute(() => {
    const db = ensureWorkspaceReady();
    return jsonResponse(getSettings(db));
  });
}

export async function PUT(request: Request) {
  return handleRoute(async () => {
    const db = ensureWorkspaceReady();
    const body = await parseJsonBody(request, settingsPatchSchema);
    return jsonResponse(updateSettings(db, body));
  });
}
