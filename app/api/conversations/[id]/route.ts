import { handleRoute, jsonResponse, noContent } from '@/lib/api/respond';
import { ensureWorkspaceReady } from '@/lib/db/migrate';
import { conversationDetail, removeConversation, updateConversation } from '@/lib/chat/conversations';
import { parseJsonBody } from '@/lib/api/validate';
import { conversationPatchSchema } from '@/lib/api/schemas';

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

export async function PATCH(request: Request, ctx: Ctx) {
  return handleRoute(async () => {
    const db = ensureWorkspaceReady();
    const { id } = await ctx.params;
    const body = await parseJsonBody(request, conversationPatchSchema);
    return jsonResponse({ conversation: updateConversation(db, id, body) });
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
