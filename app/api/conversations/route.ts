import { handleRoute, jsonResponse } from '@/lib/api/respond';
import { ensureWorkspaceReady } from '@/lib/db/migrate';
import { createConversation, listConversations } from '@/lib/chat/conversations';
import { conversationCreateSchema } from '@/lib/api/schemas';
import { parseJsonBody, parsePagination } from '@/lib/api/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return handleRoute(() => {
    const db = ensureWorkspaceReady();
    const url = new URL(request.url);
    const { limit, offset } = parsePagination(url.searchParams, 50, 100);
    return jsonResponse(listConversations(db, limit, offset, url.searchParams.get('q')));
  });
}

export async function POST(request: Request) {
  return handleRoute(async () => {
    const db = ensureWorkspaceReady();
    const body = await parseJsonBody(request, conversationCreateSchema);
    return jsonResponse({ conversation: createConversation(db, body) }, 201);
  });
}
