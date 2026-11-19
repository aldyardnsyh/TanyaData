import { handleRoute, jsonResponse } from '@/lib/api/respond';
import { ensureWorkspaceReady } from '@/lib/db/migrate';
import { sendMessage } from '@/lib/chat/messages';
import { messageCreateSchema } from '@/lib/api/schemas';
import { parseJsonBody } from '@/lib/api/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Ctx) {
  return handleRoute(async () => {
    const db = ensureWorkspaceReady();
    const { id } = await ctx.params;
    const body = await parseJsonBody(request, messageCreateSchema);
    const result = await sendMessage(db, id, body);
    return jsonResponse(result);
  });
}
