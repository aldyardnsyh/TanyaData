import { handleRoute, jsonResponse } from '@/lib/api/respond';
import { ensureWorkspaceReady } from '@/lib/db/migrate';
import { createReportFromMessage } from '@/lib/reports/store';
import { reportCreateSchema } from '@/lib/api/schemas';
import { validationError } from '@/lib/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string; msgId: string }> };

export async function POST(request: Request, ctx: Ctx) {
  return handleRoute(async () => {
    const db = ensureWorkspaceReady();
    const { id, msgId } = await ctx.params;

    let title: string | undefined;
    const text = await request.text();
    if (text.trim()) {
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        throw validationError('Body harus berupa JSON yang valid');
      }
      const parsed = reportCreateSchema.safeParse(raw);
      if (!parsed.success) {
        throw validationError('Payload tidak valid', parsed.error.issues);
      }
      title = parsed.data.title;
    }

    return jsonResponse(createReportFromMessage(db, id, msgId, title), 201);
  });
}
