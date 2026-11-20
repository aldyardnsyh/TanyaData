import { z } from 'zod';
import { handleRoute, jsonResponse } from '@/lib/api/respond';
import { parseJsonBody, parsePagination } from '@/lib/api/validate';
import { ensureWorkspaceReady } from '@/lib/db/migrate';
import { createAttachment, listAttachments } from '@/lib/core/attachment-scope';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const attachmentCreateSchema = z.object({
  datasetId: z.string().trim().min(1, 'datasetId wajib diisi'),
  sourceId: z.string().trim().min(1).nullable().optional(),
  name: z.string().trim().max(120).nullable().optional(),
  activeInConversation: z.string().trim().min(1).nullable().optional(),
});

export async function GET(request: Request) {
  return handleRoute(() => {
    const db = ensureWorkspaceReady();
    const params = new URL(request.url).searchParams;
    const { limit, offset } = parsePagination(params, 50, 100);
    const status = params.get('status');
    return jsonResponse(
      listAttachments(db, {
        datasetId: params.get('datasetId') ?? undefined,
        status: status === 'UPLOADED' || status === 'PROCESSING' || status === 'READY' || status === 'FAILED'
          ? status
          : undefined,
        limit,
        offset,
      }),
    );
  });
}

export async function POST(request: Request) {
  return handleRoute(async () => {
    const db = ensureWorkspaceReady();
    const body = await parseJsonBody(request, attachmentCreateSchema);
    return jsonResponse({ attachment: createAttachment(db, body) }, 201);
  });
}
