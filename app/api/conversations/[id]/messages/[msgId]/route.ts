import { handleRoute, jsonResponse } from '@/lib/api/respond';
import { ensureWorkspaceReady } from '@/lib/db/migrate';
import { deleteUserMessage, getConversationRow, updateUserMessage } from '@/lib/chat/conversations';
import { messagePatchSchema } from '@/lib/api/schemas';
import { parseJsonBody } from '@/lib/api/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string; msgId: string }> };

/** Edit isi pertanyaan pengguna (konsep ChatGPT/Claude). */
export async function PATCH(request: Request, ctx: Ctx) {
  return handleRoute(async () => {
    const db = ensureWorkspaceReady();
    const { id, msgId } = await ctx.params;
    getConversationRow(db, id);
    const body = await parseJsonBody(request, messagePatchSchema);
    const message = updateUserMessage(db, id, msgId, body.content);
    return jsonResponse({ message });
  });
}

/** Hapus pasangan tanya-jawab (pertanyaan + jawaban setelahnya). */
export async function DELETE(_request: Request, ctx: Ctx) {
  return handleRoute(async () => {
    const db = ensureWorkspaceReady();
    const { id, msgId } = await ctx.params;
    deleteUserMessage(db, id, msgId);
    return jsonResponse({ deleted: true }, 200);
  });
}
