import { handleRoute, jsonResponse } from '@/lib/api/respond';
import { ensureWorkspaceReady } from '@/lib/db/migrate';
import { assertAttachmentReady, getAttachment } from '@/lib/core/attachment-scope';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  return handleRoute(async () => {
    const db = ensureWorkspaceReady();
    const { id } = await ctx.params;
    const strict = new URL(_request.url).searchParams.get('strict') === 'true';
    const attachment = strict ? assertAttachmentReady(db, id) : getAttachment(db, id);
    return jsonResponse({ attachment });
  });
}
