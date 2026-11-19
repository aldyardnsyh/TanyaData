import { handleRoute, jsonResponse, noContent } from '@/lib/api/respond';
import { ensureWorkspaceReady } from '@/lib/db/migrate';
import { conversationDetail, removeConversation } from '@/lib/chat/conversations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  return handleRoute(async () => {
    const db = ensureWorkspaceReady();
    const { id } = await ctx.params;
    return jsonResponse(conversationDetail(db, id));
  });
}

export async function DELETE(_request: Request, ctx: Ctx) {
  return handleRoute(async () => {
    const db = ensureWorkspaceReady();
    const { id } = await ctx.params;
    removeConversation(db, id);
    return noContent();
  });
}
