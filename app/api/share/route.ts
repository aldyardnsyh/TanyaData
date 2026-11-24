import { z } from 'zod';
import { handleRoute, jsonResponse } from '@/lib/api/respond';
import { rateLimit } from '@/lib/api/rate-limit';
import { parseJsonBody, parsePagination } from '@/lib/api/validate';
import { ensureWorkspaceReady } from '@/lib/db/migrate';
import { createShareSnapshot, listShareSnapshots } from '@/lib/core/share';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const shareCreateSchema = z.object({
  conversationId: z.string().trim().min(1, 'conversationId wajib diisi'),
  confirmed: z.literal(true, { error: 'Konfirmasi wajib sebelum membagikan percakapan' }),
  options: z
    .object({
      includeCitations: z.boolean().optional(),
      includeIdentity: z.boolean().optional(),
    })
    .optional(),
});

export async function GET(request: Request) {
  const limited = rateLimit(request, 'share');
  if (limited) return limited;
  return handleRoute(() => {
    const db = ensureWorkspaceReady();
    const { limit, offset } = parsePagination(new URL(request.url).searchParams, 20, 100);
    return jsonResponse(listShareSnapshots(db, { limit, offset }));
  });
}

export async function POST(request: Request) {
  const limited = rateLimit(request, 'share');
  if (limited) return limited;
  return handleRoute(async () => {
    const db = ensureWorkspaceReady();
    const body = await parseJsonBody(request, shareCreateSchema);
    const snapshot = createShareSnapshot(db, body);
    return jsonResponse(
      {
        share: {
          id: snapshot.id,
          url: `/share/${snapshot.id}`,
          byteSize: snapshot.byteSize,
          messageCount: snapshot.payload.messages.length,
          createdAt: snapshot.createdAt,
          expiresAt: snapshot.expiresAt,
        },
      },
      201,
    );
  });
}
